import { describe, it, expect } from 'vitest';
import { parseTerrainMap, detectPrefix, resolveAutotile, resolveTilesetGrid, BITMASK_TO_SUFFIX } from '../src/engine/autotile.js';
import type { TilesetDef } from '../src/engine/types.js';

describe('BITMASK_TO_SUFFIX', () => {
  it('has 16 entries', () => {
    expect(BITMASK_TO_SUFFIX).toHaveLength(16);
  });

  it('maps fully surrounded (15) to center', () => {
    expect(BITMASK_TO_SUFFIX[15]).toBe('center');
  });

  it('maps isolated (0) to top_left', () => {
    expect(BITMASK_TO_SUFFIX[0]).toBe('top_left');
  });
});

describe('parseTerrainMap', () => {
  it('parses valid terrain map', () => {
    const map = parseTerrainMap({
      '1': { atlas: 'Water_Tile.atlas.json', mode: '3x3' },
      '2': { atlas: 'Grass_Middle.atlas.json', mode: 'fill' },
    });
    expect(map.get(1)).toEqual({ atlas: 'Water_Tile.atlas.json', mode: '3x3', prefix: undefined });
    expect(map.get(2)).toEqual({ atlas: 'Grass_Middle.atlas.json', mode: 'fill', prefix: undefined });
  });

  it('skips id 0', () => {
    const map = parseTerrainMap({ '0': { atlas: 'x.json', mode: 'fill' } });
    expect(map.has(0)).toBe(false);
  });

  it('skips invalid entries', () => {
    const map = parseTerrainMap({ '1': 'not an object' });
    expect(map.has(1)).toBe(false);
  });

  it('returns empty map for null/undefined', () => {
    expect(parseTerrainMap(null).size).toBe(0);
    expect(parseTerrainMap(undefined).size).toBe(0);
  });

  it('accepts explicit prefix', () => {
    const map = parseTerrainMap({ '1': { atlas: 'a.json', mode: '3x3', prefix: 'custom' } });
    expect(map.get(1)!.prefix).toBe('custom');
  });
});

describe('detectPrefix', () => {
  it('detects water prefix', () => {
    expect(detectPrefix(['water_top_left', 'water_center', 'water_bottom_right'])).toBe('water');
  });

  it('detects cliff prefix', () => {
    expect(detectPrefix(['cliff_top_left', 'cliff_center'])).toBe('cliff');
  });

  it('returns null for no match', () => {
    expect(detectPrefix(['grass_fill'])).toBeNull();
    expect(detectPrefix([])).toBeNull();
  });

  it('detects from mixed names', () => {
    expect(detectPrefix(['decor', 'path_top_mid', 'other'])).toBe('path');
  });
});

describe('resolveAutotile', () => {
  const terrainMap = new Map<number, { atlas: string; mode: '3x3' | 'fill'; prefix?: string }>();
  terrainMap.set(1, { atlas: 'water.json', mode: '3x3' });
  terrainMap.set(2, { atlas: 'grass.json', mode: 'fill' });

  const prefixes = new Map<number, string>();
  prefixes.set(1, 'water');
  prefixes.set(2, 'grass_fill');

  it('resolves fill terrain', () => {
    const data = [2, 2, 2, 2];
    const result = resolveAutotile(data, 2, 2, terrainMap, prefixes);
    expect(result.every(c => c !== null && c.regionName === 'grass_fill')).toBe(true);
  });

  it('resolves isolated cell to top_left', () => {
    const data = [0, 0, 0, 1, 0, 0, 0, 0, 0];
    const result = resolveAutotile(data, 3, 3, terrainMap, prefixes);
    expect(result[3]).toEqual({ atlasPath: 'water.json', regionName: 'water_top_left' });
  });

  it('resolves fully surrounded cell to center', () => {
    const data = [1, 1, 1, 1, 1, 1, 1, 1, 1];
    const result = resolveAutotile(data, 3, 3, terrainMap, prefixes);
    expect(result[4]).toEqual({ atlasPath: 'water.json', regionName: 'water_center' });
  });

  it('resolves edge cell', () => {
    // 3x3 grid: top row is water, rest empty → top-center has left+right neighbors
    const data = [1, 1, 1, 0, 0, 0, 0, 0, 0];
    const result = resolveAutotile(data, 3, 3, terrainMap, prefixes);
    // top_mid (idx 1): left=1, right=1, up=0, down=0 → mask = 1+2 = 3 → center
    expect(result[1]).toEqual({ atlasPath: 'water.json', regionName: 'water_center' });
  });

  it('returns null for empty cells', () => {
    const data = [0, 0, 0];
    const result = resolveAutotile(data, 3, 1, terrainMap, prefixes);
    expect(result.every(c => c === null)).toBe(true);
  });

  it('handles mixed terrain types', () => {
    const data = [2, 1, 2, 1, 1, 1, 2, 1, 2];
    const result = resolveAutotile(data, 3, 3, terrainMap, prefixes);
    // center (idx 4) = terrain 1, surrounded by 1 on all sides → center
    expect(result[4]).toEqual({ atlasPath: 'water.json', regionName: 'water_center' });
    // corners (idx 0,2,6,8) = terrain 2 (fill) → grass_fill
    expect(result[0]!.regionName).toBe('grass_fill');
  });
});

describe('resolveTilesetGrid', () => {
  const tilesetDef: TilesetDef = {
    cell_size: 16,
    tiles: [
      { name: 'water', atlas: 'water.json', mode: '3x3', prefix: 'water', surround: 2 },
      { name: 'grass', atlas: 'grass.json', mode: 'fill', prefix: 'grass_fill' },
      { name: 'beach', atlas: 'beach.json', mode: '3x3', prefix: 'beach', surround: 1, compatible: [2] },
      { name: 'rock', atlas: 'decor.json', region: 'rock' },
      { name: 'flower', atlas: 'decor.json', region: 'flower' },
    ],
    transitions: {
      '1_4': { atlas: 'rock_edge.json', prefix: 'rock_edge', mode: '3x3' },
    },
  };

  const prefixes = new Map<number, string>();
  prefixes.set(1, 'water');
  prefixes.set(2, 'grass_fill');
  prefixes.set(3, 'beach');

  it('resolves static tile', () => {
    const data = [4, 0, 5];
    const result = resolveTilesetGrid(data, 3, 1, tilesetDef, prefixes);
    expect(result[0]).toEqual({ atlasPath: 'decor.json', regionName: 'rock' });
    expect(result[1]).toBeNull();
    expect(result[2]).toEqual({ atlasPath: 'decor.json', regionName: 'flower' });
  });

  it('resolves fill tile', () => {
    const data = [2, 2, 2, 2];
    const result = resolveTilesetGrid(data, 2, 2, tilesetDef, prefixes);
    expect(result.every(c => c !== null && c.regionName === 'grass_fill')).toBe(true);
  });

  it('resolves 3x3 autotile', () => {
    const data = [1, 1, 1, 1, 1, 1, 1, 1, 1];
    const result = resolveTilesetGrid(data, 3, 3, tilesetDef, prefixes);
    expect(result[4]).toEqual({ atlasPath: 'water.json', regionName: 'water_center' });
  });

  it('resolves isolated 3x3 tile', () => {
    const data = [0, 0, 0, 0, 1, 0, 0, 0, 0];
    const result = resolveTilesetGrid(data, 3, 3, tilesetDef, prefixes);
    expect(result[4]).toEqual({ atlasPath: 'water.json', regionName: 'water_top_left' });
  });

  it('resolves mixed grid with static and autotile', () => {
    const data = [4, 1, 1, 5, 1, 1, 0, 0, 0];
    const result = resolveTilesetGrid(data, 3, 3, tilesetDef, prefixes);
    expect(result[0]).toEqual({ atlasPath: 'decor.json', regionName: 'rock' });
    expect(result[3]).toEqual({ atlasPath: 'decor.json', regionName: 'flower' });
    // water cells in middle should resolve
    expect(result[4]).not.toBeNull();
    expect(result[4]!.regionName).toContain('water_');
  });

  it('uses transition when tile borders non-surround, non-compatible tile', () => {
    // Grid: water(1) bordered by rock(4) on left
    // water's surround=2 (grass), rock is neither surround nor compatible
    // Transition 1_4 exists → water cell next to rock uses rock_edge.json
    const data = [0, 1, 0, 4, 1, 0, 0, 1, 0];
    const result = resolveTilesetGrid(data, 3, 3, tilesetDef, prefixes);
    // center cell (idx 4): left neighbor is 4 (rock), not surround(2), not compatible
    // transition 1_4 exists → use rock_edge.json
    expect(result[4]).toEqual({ atlasPath: 'rock_edge.json', regionName: expect.stringContaining('rock_edge_') });
  });

  it('uses default atlas when neighbor is surround tile', () => {
    // water(1) has surround=2 (grass). Water bordered by grass → default atlas correct.
    // 0 1 0
    // 2 1 0
    // 0 1 0
    const data = [0, 1, 0, 2, 1, 0, 0, 1, 0];
    const result = resolveTilesetGrid(data, 3, 3, tilesetDef, prefixes);
    // center (4): left=2 (grass = surround), so default atlas is fine
    expect(result[4]).toEqual({ atlasPath: 'water.json', regionName: expect.stringContaining('water_') });
  });

  it('falls back to own atlas when no transition defined', () => {
    // water(1) bordered by rock(4) — no transition 1_4 defined
    const data = [0, 4, 0, 1, 1, 0, 0, 0, 0];
    const result = resolveTilesetGrid(data, 3, 3, tilesetDef, prefixes);
    // idx 3: water, right neighbor is water(1), left=0, up=4(no transition), down=0
    expect(result[3]).toEqual({ atlasPath: 'water.json', regionName: expect.stringContaining('water_') });
  });

  it('compatible tiles count as same for bitmask', () => {
    // beach(3) has compatible: [2] (grass). So grass is treated as same.
    // 0 3 0
    // 2 3 0
    // 0 3 0
    const data = [0, 3, 0, 2, 3, 0, 0, 3, 0];
    const result = resolveTilesetGrid(data, 3, 3, tilesetDef, prefixes);
    // center(4) has left=2 (compatible), so treated as same → more neighbors
    expect(result[4]).not.toBeNull();
    expect(result[4]!.atlasPath).toBe('beach.json');
  });

  it('returns null for out-of-range tile IDs', () => {
    const data = [0, 99, 0];
    const result = resolveTilesetGrid(data, 3, 1, tilesetDef, prefixes);
    expect(result[0]).toBeNull();
    expect(result[1]).toBeNull();
    expect(result[2]).toBeNull();
  });
});
