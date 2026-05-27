import { type Canvas, loadImage, type Image } from '@napi-rs/canvas';
import { resolve } from 'node:path';
import { Node } from '../engine/node.js';
import type { AtlasDef } from '../engine/atlas.js';
import { regionByName } from '../engine/atlas.js';
import { loadAtlas } from '../persistence/atlas-loader.js';
import { loadTileset } from '../persistence/tileset-loader.js';
import type { TilesetDef, TiledLayerData } from '../engine/types.js';
import {
	type TerrainDef,
	type ResolvedCell,
	type LegacyResolvedCell,
	type ResolvedGrid,
	parseTerrainMap,
	resolveAutotile,
	resolveTilesetGrid,
} from '../engine/autotile.js';
import { GID_FLIP_H, GID_FLIP_V, GID_FLIP_D, GID_MASK } from '../persistence/tiled-types.js';

type Ctx = ReturnType<Canvas['getContext']>;

export class TilemapRenderer {
	ctx: Ctx;
	private projectDir = '.';
	private tilesetCache = new Map<string, { img: Image; tileWidth: number; tileHeight: number }>();
	private tileAtlasCache = new Map<string, { atlas: AtlasDef; img: Image }>();
	private textureCache = new Map<string, Image>();
	private tilesetDefCache = new Map<string, TilesetDef>();
	private autotileCache = new Map<string, ResolvedGrid | (LegacyResolvedCell | null)[]>();
	private autotileDataHash = new Map<string, string>();

	constructor(ctx: Ctx) {
		this.ctx = ctx;
	}

	setProjectDir(dir: string): void {
		this.projectDir = resolve(dir);
	}

	drawTilemap(node: Node, x: number, y: number): void {
		// Tiled format path
		const tiledLayers = node.getProperty('tiled_layers');
		if (Array.isArray(tiledLayers) && tiledLayers.length > 0) {
			this.drawTiledLayer(tiledLayers as TiledLayerData[], x, y);
			return;
		}

		const tilesetProp = (node.getProperty('tileset') as string) ?? '';

		// New path: .tileset.json
		if (tilesetProp.endsWith('.tileset.json')) {
			this.drawFromTileset(node, x, y);
			return;
		}

		// Legacy path: terrain_map
		const terrainMapRaw = node.getProperty('terrain_map');
		if (terrainMapRaw && typeof terrainMapRaw === 'object') {
			const entries = Object.keys(terrainMapRaw as Record<string, unknown>);
			if (entries.length > 0) {
				this.drawAutotile(node, x, y);
				return;
			}
		}

		this.drawLegacy(node, x, y);
	}

	private drawTiledLayer(layers: TiledLayerData[], baseX: number, baseY: number): void {
		const ctx = this.ctx;
		ctx.imageSmoothingEnabled = false;

		for (const layer of layers) {
			const prevAlpha = ctx.globalAlpha;
			if (layer.opacity !== undefined && layer.opacity < 1) {
				ctx.globalAlpha = layer.opacity;
			}

			const tw = layer.tilewidth;
			const th = layer.tileheight;
			const imgKey = layer.image.startsWith('/') ? layer.image : resolve(this.projectDir, layer.image);
			const isCollection = !layer.image || layer.columns === 0;
			const spritesheetImg = !isCollection ? this.textureCache.get(imgKey) : null;

			for (let row = 0; row < layer.height; row++) {
				for (let col = 0; col < layer.width; col++) {
					const rawGid = layer.data[row * layer.width + col];
					if (rawGid === 0) continue;

					const flipH = !!(rawGid & GID_FLIP_H);
					const flipV = !!(rawGid & GID_FLIP_V);
					const flipD = !!(rawGid & GID_FLIP_D);
					const gid = rawGid & GID_MASK;

					if (gid === 0) continue;
					if (gid < layer.firstgid) continue;

					const localId = gid - layer.firstgid;
					const dx = baseX + col * tw;
					const dy = baseY + row * th;

					if (isCollection) {
						// Image collection: each tile has its own image
						const tileInfo = layer.tile_images?.[localId];
						if (!tileInfo) continue;
						const tileImgKey = tileInfo.image.startsWith('/') ? tileInfo.image : resolve(this.projectDir, tileInfo.image);
							const tileImg = this.textureCache.get(tileImgKey);
						if (!tileImg) continue;
						ctx.drawImage(tileImg, 0, 0, tileInfo.w, tileInfo.h, dx, dy + th - tileInfo.h, tileInfo.w, tileInfo.h);
					} else if (spritesheetImg) {
						const srcCol = localId % layer.columns;
						const srcRow = Math.floor(localId / layer.columns);
						const sx = srcCol * tw;
						const sy = srcRow * th;

						if (flipH || flipV || flipD) {
							ctx.save();
							ctx.translate(dx + tw / 2, dy + th / 2);
							if (flipD) {
								ctx.rotate(Math.PI / 2);
								ctx.scale(1, -1);
							}
							if (flipH) ctx.scale(-1, 1);
							if (flipV) ctx.scale(1, -1);
							ctx.drawImage(spritesheetImg, sx, sy, tw, th, -tw / 2, -th / 2, tw, th);
							ctx.restore();
						} else {
							ctx.drawImage(spritesheetImg, sx, sy, tw, th, dx, dy, tw, th);
						}
					}
				}
			}

			if (layer.opacity !== undefined && layer.opacity < 1) {
				ctx.globalAlpha = prevAlpha;
			}
		}
	}

	hasTexture(path: string): boolean {
		return this.textureCache.has(path);
	}

	cacheTexture(path: string, img: Image): void {
		this.textureCache.set(path, img);
	}

	private drawFromTileset(node: Node, x: number, y: number): void {
		const tilesetProp = (node.getProperty('tileset') as string) ?? '';
		const columns = (node.getProperty('columns') as number) ?? 0;
		const rows = (node.getProperty('rows') as number) ?? 0;

		if (!tilesetProp || columns === 0 || rows === 0) return;

		const absPath = resolve(this.projectDir, tilesetProp);
		const tilesetDef = this.tilesetDefCache.get(absPath);
		if (!tilesetDef) return;

		const cellSize = tilesetDef.cell_size;
		const grid = this.getOrResolveTilesetGrid(node, absPath, tilesetDef);
		if (!grid) return;

		const ctx = this.ctx;
		ctx.imageSmoothingEnabled = false;

		const drawCell = (cell: ResolvedCell, row: number, col: number) => {
			const img = this.textureCache.get(cell.texturePath);
			if (!img) return;
			ctx.drawImage(img, cell.x, cell.y, cell.w, cell.h, x + col * cellSize, y + row * cellSize, cellSize, cellSize);
		};

		// Layer 1 (base): fill, static, and 3x3 center tiles
		const base = grid.base;
		for (let row = 0; row < rows; row++) {
			for (let col = 0; col < columns; col++) {
				const idx = row * columns + col;
				if (base[idx]) drawCell(base[idx]!, row, col);
			}
		}

		// Layer 2 (overlay): ABCD transition tiles on non-3x3 cells
		const overlays = grid.overlays;
		for (let row = 0; row < rows; row++) {
			for (let col = 0; col < columns; col++) {
				const idx = row * columns + col;
				if (overlays[idx]) drawCell(overlays[idx]!, row, col);
			}
		}
	}

	private getOrResolveTilesetGrid(node: Node, absPath: string, tilesetDef: TilesetDef): ResolvedGrid | null {
		const data = (node.getProperty('data') as string) ?? '';
		const columns = (node.getProperty('columns') as number) ?? 0;
		const rows = (node.getProperty('rows') as number) ?? 0;

		const hash = `${data}|${columns}|${rows}|${absPath}`;
		const cached = this.autotileCache.get(node.id);
		if (cached && this.autotileDataHash.get(node.id) === hash) {
			return 'base' in cached ? cached : null;
		}

		const terrainData = data.split(',').map(s => parseInt(s.trim(), 10));
		const grid = resolveTilesetGrid(terrainData, columns, rows, tilesetDef);
		this.autotileCache.set(node.id, grid);
		this.autotileDataHash.set(node.id, hash);
		return grid;
	}

	private drawLegacy(node: Node, x: number, y: number): void {
		const tileset = (node.getProperty('tileset') as string) ?? '';
		const cellSize = (node.getProperty('cell_size') as number) ?? 16;
		const columns = (node.getProperty('columns') as number) ?? 0;
		const rows = (node.getProperty('rows') as number) ?? 0;
		const data = (node.getProperty('data') as string) ?? '';

		if (!tileset || columns === 0 || rows === 0 || !data) return;

		const cached = this.tilesetCache.get(tileset);
		if (!cached) return;

		const { img, tileWidth, tileHeight } = cached;
		const tilesPerRow = Math.floor(img.width / tileWidth);
		const ctx = this.ctx;
		ctx.imageSmoothingEnabled = false;

		const tileIndices = data.split(',').map(s => parseInt(s.trim(), 10));

		for (let row = 0; row < rows; row++) {
			for (let col = 0; col < columns; col++) {
				const idx = tileIndices[row * columns + col];
				if (idx === undefined || idx < 0) continue;

				const srcCol = idx % tilesPerRow;
				const srcRow = Math.floor(idx / tilesPerRow);
				const sx = srcCol * tileWidth;
				const sy = srcRow * tileHeight;
				const dx = x + col * cellSize;
				const dy = y + row * cellSize;

				ctx.drawImage(img, sx, sy, tileWidth, tileHeight, dx, dy, cellSize, cellSize);
			}
		}
	}

	private drawAutotile(node: Node, x: number, y: number): void {
		const cellSize = (node.getProperty('cell_size') as number) ?? 16;
		const columns = (node.getProperty('columns') as number) ?? 0;
		const rows = (node.getProperty('rows') as number) ?? 0;

		if (columns === 0 || rows === 0) return;

		const grid = this.getOrResolveGrid(node);
		if (!grid) {
			return;
		}

		const ctx = this.ctx;
		ctx.imageSmoothingEnabled = false;

		for (let row = 0; row < rows; row++) {
			for (let col = 0; col < columns; col++) {
				const cell = grid[row * columns + col];
				if (!cell) continue;

				const cached = this.tileAtlasCache.get(resolve(this.projectDir, cell.atlasPath));
				if (!cached) continue;

				const region = regionByName(cached.atlas, cell.regionName);
				if (!region) continue;

				const dx = x + col * cellSize;
				const dy = y + row * cellSize;
				ctx.drawImage(cached.img, region.x, region.y, region.width, region.height, dx, dy, cellSize, cellSize);
			}
		}
	}

	private getOrResolveGrid(node: Node): (LegacyResolvedCell | null)[] | null {
		const data = (node.getProperty('data') as string) ?? '';
		const columns = (node.getProperty('columns') as number) ?? 0;
		const rows = (node.getProperty('rows') as number) ?? 0;
		const terrainMapRaw = node.getProperty('terrain_map');

		const hash = `${data}|${columns}|${rows}|${JSON.stringify(terrainMapRaw)}`;
		const cached = this.autotileCache.get(node.id);
		if (cached && this.autotileDataHash.get(node.id) === hash) {
			if (Array.isArray(cached)) return cached;
			return null;
		}

		const terrainMap = parseTerrainMap(terrainMapRaw);
		if (terrainMap.size === 0) return null;

		// Detect prefixes from loaded atlases (legacy path)
		const prefixes = new Map<number, string>();
		for (const [id, def] of terrainMap) {
			if (def.prefix) {
				prefixes.set(id, def.prefix);
			} else {
				const absPath = resolve(this.projectDir, def.atlas);
				const cached = this.tileAtlasCache.get(absPath);
				if (cached) {
					const names = cached.atlas.regions.map(r => r.name);
					// Simple prefix detection for legacy path
					const suffixes = ['top_left', 'center', 'bottom_right'];
					for (const name of names) {
						for (const suffix of suffixes) {
							if (name.endsWith('_' + suffix)) {
								prefixes.set(id, name.slice(0, name.length - suffix.length - 1));
								break;
							}
						}
						if (prefixes.has(id)) break;
					}
				}
			}
		}

		const terrainData = data.split(',').map(s => parseInt(s.trim(), 10));
		const grid = resolveAutotile(terrainData, columns, rows, terrainMap, prefixes);
		this.autotileCache.set(node.id, grid);
		this.autotileDataHash.set(node.id, hash);
		return grid;
	}

	async loadTerrainAtlases(node: Node): Promise<void> {
		const terrainMapRaw = node.getProperty('terrain_map');
		const terrainMap = parseTerrainMap(terrainMapRaw);

		for (const [, def] of terrainMap) {
			const absPath = resolve(this.projectDir, def.atlas);
			if (this.tileAtlasCache.has(absPath)) continue;

			try {
				const atlas = await loadAtlas(absPath);
				const img = await loadImage(atlas.texture);
				this.tileAtlasCache.set(absPath, { atlas, img });
			} catch (err) {
			}
		}
	}

	async loadTilesetDef(tilesetPath: string): Promise<TilesetDef | null> {
		const absPath = resolve(this.projectDir, tilesetPath);
		if (this.tilesetDefCache.has(absPath)) {
			return this.tilesetDefCache.get(absPath)!;
		}
		try {
			const def = await loadTileset(absPath);
			this.tilesetDefCache.set(absPath, def);
			return def;
		} catch {
			return null;
		}
	}

	async loadTilesetTextures(tilesetDef: TilesetDef): Promise<void> {
		const texturePaths = new Set<string>();
		for (const tile of tilesetDef.tiles) {
			const path = tile.texture ?? tile.atlas;
			if (path) texturePaths.add(path);
		}
		if (tilesetDef.transitions) {
			for (const trans of Object.values(tilesetDef.transitions)) {
				const path = trans.texture ?? trans.atlas;
				if (path) texturePaths.add(path);
			}
		}
		for (const path of texturePaths) {
			if (this.textureCache.has(path)) continue;
			try {
				const img = await loadImage(path);
				this.textureCache.set(path, img);
			} catch {
				// skip
			}
		}
	}

	async loadTilesetImage(path: string, tileWidth: number, tileHeight: number): Promise<void> {
		if (this.tilesetCache.has(path)) return;
		try {
			const img = await loadImage(path);
			this.tilesetCache.set(path, { img, tileWidth, tileHeight });
		} catch {
			// ignore
		}
	}
}
