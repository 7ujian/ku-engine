import { type Canvas, loadImage, type Image } from '@napi-rs/canvas';
import { resolve } from 'node:path';
import { Node } from '../engine/node.js';
import type { AtlasDef } from '../engine/atlas.js';
import { regionByName } from '../engine/atlas.js';
import { loadAtlas } from '../persistence/atlas-loader.js';
import { loadTileset } from '../persistence/tileset-loader.js';
import type { TilesetDef } from '../engine/types.js';
import {
	type TerrainDef,
	type ResolvedCell,
	parseTerrainMap,
	detectPrefix,
	resolveAutotile,
	resolveTilesetGrid,
} from '../engine/autotile.js';

type Ctx = ReturnType<Canvas['getContext']>;

export class TilemapRenderer {
	ctx: Ctx;
	private projectDir = '.';
	private tilesetCache = new Map<string, { img: Image; tileWidth: number; tileHeight: number }>();
	private tileAtlasCache = new Map<string, { atlas: AtlasDef; img: Image }>();
	private tilesetDefCache = new Map<string, TilesetDef>();
	private autotileCache = new Map<string, (ResolvedCell | null)[]>();
	private autotileDataHash = new Map<string, string>();

	constructor(ctx: Ctx) {
		this.ctx = ctx;
	}

	setProjectDir(dir: string): void {
		this.projectDir = resolve(dir);
	}

	drawTilemap(node: Node, x: number, y: number): void {
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

		for (let row = 0; row < rows; row++) {
			for (let col = 0; col < columns; col++) {
				const cell = grid[row * columns + col];
				if (!cell) continue;

				const cached = this.tileAtlasCache.get(cell.atlasPath);
				if (!cached) continue;

				const region = regionByName(cached.atlas, cell.regionName);
				if (!region) continue;

				const dx = x + col * cellSize;
				const dy = y + row * cellSize;
				ctx.drawImage(cached.img, region.x, region.y, region.width, region.height, dx, dy, cellSize, cellSize);
			}
		}
	}

	private getOrResolveTilesetGrid(node: Node, absPath: string, tilesetDef: TilesetDef): (ResolvedCell | null)[] | null {
		const data = (node.getProperty('data') as string) ?? '';
		const columns = (node.getProperty('columns') as number) ?? 0;
		const rows = (node.getProperty('rows') as number) ?? 0;

		const hash = `${data}|${columns}|${rows}|${absPath}`;
		const cached = this.autotileCache.get(node.id);
		if (cached && this.autotileDataHash.get(node.id) === hash) return cached;

		// Detect prefixes from loaded atlases
		const prefixes = new Map<number, string>();
		for (let i = 0; i < tilesetDef.tiles.length; i++) {
			const tile = tilesetDef.tiles[i];
			if (tile.prefix) {
				prefixes.set(i + 1, tile.prefix);
			} else if (tile.mode === '3x3' || tile.mode === 'fill') {
				const atlasCached = this.tileAtlasCache.get(tile.atlas);
				if (atlasCached) {
					const names = atlasCached.atlas.regions.map(r => r.name);
					const prefix = detectPrefix(names);
					if (prefix) {
						prefixes.set(i + 1, prefix);
					} else if (tile.mode === 'fill' && names.length === 1) {
						prefixes.set(i + 1, names[0]);
					}
				}
			}
		}

		const terrainData = data.split(',').map(s => parseInt(s.trim(), 10));
		const grid = resolveTilesetGrid(terrainData, columns, rows, tilesetDef, prefixes);
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

	private getOrResolveGrid(node: Node): (ResolvedCell | null)[] | null {
		const data = (node.getProperty('data') as string) ?? '';
		const columns = (node.getProperty('columns') as number) ?? 0;
		const rows = (node.getProperty('rows') as number) ?? 0;
		const terrainMapRaw = node.getProperty('terrain_map');

		const hash = `${data}|${columns}|${rows}|${JSON.stringify(terrainMapRaw)}`;
		const cached = this.autotileCache.get(node.id);
		if (cached && this.autotileDataHash.get(node.id) === hash) return cached;

		const terrainMap = parseTerrainMap(terrainMapRaw);
		if (terrainMap.size === 0) return null;

		// Detect prefixes from loaded atlases
		const prefixes = new Map<number, string>();
		for (const [id, def] of terrainMap) {
			if (def.prefix) {
				prefixes.set(id, def.prefix);
			} else {
				const absPath = resolve(this.projectDir, def.atlas);
			const cached = this.tileAtlasCache.get(absPath);
				if (cached) {
					const names = cached.atlas.regions.map(r => r.name);
					const prefix = detectPrefix(names);
					if (prefix) {
						prefixes.set(id, prefix);
					} else if (def.mode === 'fill' && names.length === 1) {
						prefixes.set(id, names[0]);
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

	async loadTilesetAtlases(tilesetDef: TilesetDef): Promise<void> {
		const atlasPaths = new Set<string>();
		for (const tile of tilesetDef.tiles) {
			atlasPaths.add(tile.atlas);
		}
		if (tilesetDef.transitions) {
			for (const trans of Object.values(tilesetDef.transitions)) {
				atlasPaths.add(trans.atlas);
			}
		}
		for (const atlasPath of atlasPaths) {
			if (this.tileAtlasCache.has(atlasPath)) continue;
			try {
				const atlas = await loadAtlas(atlasPath);
				const img = await loadImage(atlas.texture);
				this.tileAtlasCache.set(atlasPath, { atlas, img });
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
