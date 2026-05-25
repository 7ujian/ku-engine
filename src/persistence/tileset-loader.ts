import { resolve, dirname } from 'node:path';
import { readFile } from 'node:fs/promises';
import type { TilesetDef, TilesetTileDef, TilesetTransitionDef } from '../engine/types.js';

export async function loadTileset(jsonPath: string): Promise<TilesetDef> {
	const content = await readFile(jsonPath, 'utf-8');
	const raw = JSON.parse(content);
	const tileset = parseTileset(raw);
	const baseDir = dirname(jsonPath);
	for (const tile of tileset.tiles) {
		tile.atlas = resolve(baseDir, tile.atlas);
	}
	if (tileset.transitions) {
		for (const trans of Object.values(tileset.transitions)) {
			trans.atlas = resolve(baseDir, trans.atlas);
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
		const atlas = typeof tile.atlas === 'string' ? tile.atlas : '';
		if (!atlas) throw new Error(`Tile "${name}" missing atlas`);

		const mode = tile.mode === '3x3' || tile.mode === 'fill' ? tile.mode : undefined;
		const region = typeof tile.region === 'string' ? tile.region : undefined;
		const prefix = typeof tile.prefix === 'string' ? tile.prefix : undefined;

		if (!mode && !region) {
			throw new Error(`Tile "${name}" must have either mode or region`);
		}

		const compatible = Array.isArray(tile.compatible)
			? (tile.compatible as number[])
			: undefined;

		const surround = typeof tile.surround === 'number' ? tile.surround : undefined;

		return { name, atlas, region, mode, prefix, surround, compatible };
	});

	let transitions: Record<string, TilesetTransitionDef> | undefined;
	if (data.transitions && typeof data.transitions === 'object') {
		transitions = {};
		const transRaw = data.transitions as Record<string, unknown>;
		for (const [key, val] of Object.entries(transRaw)) {
			if (!val || typeof val !== 'object') continue;
			const t = val as Record<string, unknown>;
			const atlas = typeof t.atlas === 'string' ? t.atlas : '';
			const prefix = typeof t.prefix === 'string' ? t.prefix : '';
			const mode = t.mode === 'fill' ? 'fill' : '3x3';
			if (!atlas || !prefix) continue;
			transitions[key] = { atlas, prefix, mode };
		}
	}

	return { cell_size: data.cell_size, tiles, transitions };
}
