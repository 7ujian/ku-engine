import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { loadTiledMap, findTilesetForGid, gidToRect, buildTileLookup } from '../src/persistence/tiled-loader.js';
import { GID_MASK, GID_FLIP_H, GID_FLIP_V } from '../src/persistence/tiled-types.js';

const FIXTURES = resolve(__dirname, 'fixtures/tiled');

describe('loadTiledMap', () => {
	it('loads simple map with external tileset', async () => {
		const map = await loadTiledMap(resolve(FIXTURES, 'simple-map.json'));
		expect(map.width).toBe(4);
		expect(map.height).toBe(3);
		expect(map.tilewidth).toBe(16);
		expect(map.tileheight).toBe(16);
		expect(map.orientation).toBe('orthogonal');
		expect(map.tilesets).toHaveLength(1);
		expect(map.layers).toHaveLength(1);

		const ts = map.tilesets[0];
		expect(ts.name).toBe('outdoor');
		expect(ts.firstgid).toBe(1);
		expect(ts.tilecount).toBe(6);
		expect(ts.columns).toBe(3);
		expect(ts.tilewidth).toBe(16);
		expect(ts.tileheight).toBe(16);
		expect(ts.image).toMatch(/tiles\.png$/);
		expect(ts.terrains).toHaveLength(2);
		expect(ts.tiles).toHaveLength(6);
	});

	it('loads map with embedded tileset', async () => {
		const map = await loadTiledMap(resolve(FIXTURES, 'multi-tileset-map.json'));
		expect(map.tilesets).toHaveLength(2);
		expect(map.tilesets[1].name).toBe('decor');
		expect(map.tilesets[1].firstgid).toBe(7);
		expect(map.tilesets[1].tilecount).toBe(2);
		expect(map.tilesets[1].columns).toBe(2);
	});

	it('loads map with object layers', async () => {
		const map = await loadTiledMap(resolve(FIXTURES, 'objects-map.json'));
		expect(map.layers).toHaveLength(2);
		expect(map.layers[0].type).toBe('tilelayer');
		expect(map.layers[1].type).toBe('objectgroup');
	});

	it('throws on invalid input', async () => {
		await expect(loadTiledMap(resolve(FIXTURES, 'nonexistent.json'))).rejects.toThrow();
	});
});

describe('findTilesetForGid', () => {
	const tilesets = [
		{ firstgid: 1, tilecount: 6, name: 'a' } as any,
		{ firstgid: 7, tilecount: 2, name: 'b' } as any,
	];

	it('finds tileset for GID in first range', () => {
		expect(findTilesetForGid(1, tilesets)?.name).toBe('a');
		expect(findTilesetForGid(6, tilesets)?.name).toBe('a');
	});

	it('finds tileset for GID in second range', () => {
		expect(findTilesetForGid(7, tilesets)?.name).toBe('b');
		expect(findTilesetForGid(8, tilesets)?.name).toBe('b');
	});

	it('returns null for out-of-range GID', () => {
		expect(findTilesetForGid(0, tilesets)).toBeNull();
		expect(findTilesetForGid(9, tilesets)).toBeNull();
	});
});

describe('gidToRect', () => {
	const ts = { firstgid: 1, columns: 3, tilewidth: 16, tileheight: 16 } as any;

	it('computes rect for first tile', () => {
		expect(gidToRect(1, ts)).toEqual({ x: 0, y: 0, w: 16, h: 16 });
	});

	it('computes rect for tile in second row', () => {
		expect(gidToRect(4, ts)).toEqual({ x: 0, y: 16, w: 16, h: 16 });
	});

	it('computes rect for last tile in first row', () => {
		expect(gidToRect(3, ts)).toEqual({ x: 32, y: 0, w: 16, h: 16 });
	});

	it('handles margin and spacing', () => {
		const tsWithSpacing = { firstgid: 1, columns: 2, tilewidth: 16, tileheight: 16, margin: 2, spacing: 1 } as any;
		expect(gidToRect(1, tsWithSpacing)).toEqual({ x: 2, y: 2, w: 16, h: 16 });
		// col 1: margin + (1 * (16 + 1)) = 2 + 17 = 19
		expect(gidToRect(2, tsWithSpacing)).toEqual({ x: 19, y: 2, w: 16, h: 16 });
	});
});

describe('GID constants', () => {
	it('masks out flip bits', () => {
		const rawGid = 5 | GID_FLIP_H;
		expect(rawGid & GID_MASK).toBe(5);
	});

	it('detects horizontal flip', () => {
		const rawGid = 5 | GID_FLIP_H;
		expect(!!(rawGid & GID_FLIP_H)).toBe(true);
		expect(!!(rawGid & GID_FLIP_V)).toBe(false);
	});

	it('detects both flips', () => {
		const rawGid = 5 | GID_FLIP_H | GID_FLIP_V;
		expect(!!(rawGid & GID_FLIP_H)).toBe(true);
		expect(!!(rawGid & GID_FLIP_V)).toBe(true);
		expect(rawGid & GID_MASK).toBe(5);
	});
});

describe('buildTileLookup', () => {
	it('builds map from tiles array', () => {
		const tiles = [
			{ id: 0, terrain: [0, 0, 0, 0] },
			{ id: 3, terrain: [0, 0, 1, 0] },
		];
		const lookup = buildTileLookup(tiles as any);
		expect(lookup.has(0)).toBe(true);
		expect(lookup.has(3)).toBe(true);
		expect(lookup.has(1)).toBe(false);
		expect(lookup.get(0)?.terrain).toEqual([0, 0, 0, 0]);
	});

	it('returns empty map for undefined', () => {
		expect(buildTileLookup(undefined).size).toBe(0);
	});
});
