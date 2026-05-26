import { resolve, dirname } from 'node:path';
import { readFile } from 'node:fs/promises';
import type { TilesetDef, TilesetTileDef, TilesetTransitionDef, TilesetRegion } from '../engine/types.js';

function parseRegions(raw: unknown): TilesetRegion[] | undefined {
	if (!Array.isArray(raw)) return undefined;
	const regions: TilesetRegion[] = [];
	for (const r of raw) {
		if (!r || typeof r !== 'object') continue;
		const obj = r as Record<string, unknown>;
		const name = typeof obj.name === 'string' ? obj.name : '';
		const x = typeof obj.x === 'number' ? obj.x : 0;
		const y = typeof obj.y === 'number' ? obj.y : 0;
		const w = typeof obj.w === 'number' && obj.w > 0 ? obj.w : (typeof obj.width === 'number' && obj.width > 0 ? obj.width : 0);
		const h = typeof obj.h === 'number' && obj.h > 0 ? obj.h : (typeof obj.height === 'number' && obj.height > 0 ? obj.height : 0);
		if (!name || w === 0 || h === 0) continue;
		regions.push({ name, x, y, w, h });
	}
	return regions.length > 0 ? regions : undefined;
}

function parseMasks(raw: unknown): Record<number, string> | undefined {
	if (!raw || typeof raw !== 'object') return undefined;
	const obj = raw as Record<string, unknown>;
	const masks: Record<number, string> = {};
	for (const [k, v] of Object.entries(obj)) {
		if (typeof v === 'string') {
			const n = parseInt(k, 10);
			if (!isNaN(n)) masks[n] = v;
		}
	}
	return Object.keys(masks).length > 0 ? masks : undefined;
}

export async function loadTileset(jsonPath: string): Promise<TilesetDef> {
	const content = await readFile(jsonPath, 'utf-8');
	const raw = JSON.parse(content);
	const tileset = parseTileset(raw);
	const baseDir = dirname(jsonPath);

	for (const tile of tileset.tiles) {
		if (tile.texture) {
			tile.texture = resolve(baseDir, tile.texture);
		} else if (tile.atlas) {
			tile.atlas = resolve(baseDir, tile.atlas);
		}
	}

	if (tileset.transitions) {
		for (const trans of Object.values(tileset.transitions)) {
			if (trans.texture) {
				trans.texture = resolve(baseDir, trans.texture);
			} else if (trans.atlas) {
				trans.atlas = resolve(baseDir, trans.atlas);
			}
		}
	}

	return tileset;
}

export function parseTileset(raw: unknown): TilesetDef {
	if (!raw || typeof raw !== 'object') throw new Error('Invalid tileset: expected object');
	const data = raw as Record<string, unknown>;

	if (typeof data.cell_size !== 'number' || data.cell_size <= 0) {
		throw new Error('Invalid tileset: cell_size must be a positive number');
	}

	if (!Array.isArray(data.tiles) || data.tiles.length === 0) {
		throw new Error('Invalid tileset: tiles must be a non-empty array');
	}

	const tiles: TilesetTileDef[] = data.tiles.map((t: unknown, i: number) => {
		if (!t || typeof t !== 'object') throw new Error(`Invalid tile at index ${i}`);
		const tile = t as Record<string, unknown>;
		const name = typeof tile.name === 'string' ? tile.name : `tile_${i + 1}`;

		const texture = typeof tile.texture === 'string' ? tile.texture : undefined;
		const atlas = typeof tile.atlas === 'string' ? tile.atlas : undefined;
		const regions = parseRegions(tile.regions);
		const region = typeof tile.region === 'string' ? tile.region : undefined;
		const prefix = typeof tile.prefix === 'string' ? tile.prefix : undefined;
		const mode = tile.mode === '3x3' || tile.mode === 'fill' ? tile.mode : undefined;

		if (!texture && !atlas) {
			throw new Error(`Tile "${name}" missing texture or atlas`);
		}

		if (!mode && !region && !regions?.length) {
			throw new Error(`Tile "${name}" must have mode, region, or regions`);
		}

		const compatible = Array.isArray(tile.compatible)
			? (tile.compatible as number[])
			: undefined;

		const surround = typeof tile.surround === 'number' ? tile.surround : undefined;
		const masks = parseMasks(tile.masks);

		return { name, atlas, region, prefix, texture, regions, mode, surround, compatible, masks };
	});

	let transitions: Record<string, TilesetTransitionDef> | undefined;
	if (data.transitions && typeof data.transitions === 'object') {
		transitions = {};
		const transRaw = data.transitions as Record<string, unknown>;
		for (const [key, val] of Object.entries(transRaw)) {
			if (!val || typeof val !== 'object') continue;
			const t = val as Record<string, unknown>;
			const texture = typeof t.texture === 'string' ? t.texture : undefined;
			const atlas = typeof t.atlas === 'string' ? t.atlas : undefined;
			const prefix = typeof t.prefix === 'string' ? t.prefix : undefined;
			const regions = parseRegions(t.regions);
			const mode = t.mode === 'fill' ? 'fill' : '3x3';
			if ((!texture && !atlas) || !prefix) continue;
			transitions[key] = { atlas, prefix, texture, regions, mode };
		}
	}

	return { cell_size: data.cell_size, tiles, transitions };
}
