import { describe, it, expect } from 'vitest';
import { parseTerrainMap, resolveAutotile, resolveTilesetGrid, computeAbcd, ABCD_TO_SUFFIX, BITMASK_TO_SUFFIX } from '../src/engine/autotile.js';
import type { TilesetDef, TilesetRegion } from '../src/engine/types.js';

describe('BITMASK_TO_SUFFIX (legacy)', () => {
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

describe('ABCD_TO_SUFFIX', () => {
  it('has 16 entries', () => {
    expect(ABCD_TO_SUFFIX).toHaveLength(16);
  });

  it('maps 0000 (0) to empty string (skip)', () => {
    expect(ABCD_TO_SUFFIX[0]).toBe('');
  });

  it('maps 1111 (15) to center', () => {
    expect(ABCD_TO_SUFFIX[15]).toBe('center');
  });

  it('maps corner codes', () => {
    expect(ABCD_TO_SUFFIX[1]).toBe('top_left');
    expect(ABCD_TO_SUFFIX[2]).toBe('top_right');
    expect(ABCD_TO_SUFFIX[4]).toBe('bottom_left');
    expect(ABCD_TO_SUFFIX[8]).toBe('bottom_right');
  });

  it('maps edge codes', () => {
    expect(ABCD_TO_SUFFIX[3]).toBe('top_mid');
    expect(ABCD_TO_SUFFIX[5]).toBe('center_left');
    expect(ABCD_TO_SUFFIX[10]).toBe('center_right');
    expect(ABCD_TO_SUFFIX[12]).toBe('bottom_mid');
  });

  it('maps pond codes', () => {
    expect(ABCD_TO_SUFFIX[7]).toBe('pond_bottom_right');
    expect(ABCD_TO_SUFFIX[11]).toBe('pond_bottom_left');
    expect(ABCD_TO_SUFFIX[13]).toBe('pond_top_right');
    expect(ABCD_TO_SUFFIX[14]).toBe('pond_top_left');
  });

  it('maps diagonal codes to center fallback', () => {
    expect(ABCD_TO_SUFFIX[6]).toBe('center');
    expect(ABCD_TO_SUFFIX[9]).toBe('center');
  });
});

describe('computeAbcd', () => {
  it('returns 0 for empty grid', () => {
    const grid = new Uint8Array([0, 0, 0, 0]);
    expect(computeAbcd(grid, 2, 2, 0, 0)).toBe(0);
  });

  it('returns 15 for center of solid block', () => {
    const grid = new Uint8Array([1, 1, 1, 1, 1, 1, 1, 1, 1]);
    expect(computeAbcd(grid, 3, 3, 1, 1)).toBe(15);
  });

  it('computes cross pattern correctly', () => {
    const grid = new Uint8Array([
      0, 0, 0, 0, 0,
      0, 0, 1, 0, 0,
      0, 1, 1, 1, 0,
      0, 0, 1, 0, 0,
      0, 0, 0, 0, 0,
    ]);

    const expected = [
      0,  1,  3,  2,  0,
      1,  7, 15, 11,  2,
      5, 15, 15, 15, 10,
      4, 13, 15, 14,  8,
      0,  4, 12,  8,  0,
    ];

    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < 5; c++) {
        const result = computeAbcd(grid, 5, 5, r, c);
        expect(result).toBe(expected[r * 5 + c]);
      }
    }
  });

  it('handles edge cells with out-of-bounds as 0', () => {
    const grid = new Uint8Array([1]);
    expect(computeAbcd(grid, 1, 1, 0, 0)).toBe(15);
  });

  it('computes single cell in larger grid', () => {
    const grid = new Uint8Array([0, 0, 0, 0, 1, 0, 0, 0, 0]);
    expect(computeAbcd(grid, 3, 3, 1, 1)).toBe(15);
    expect(computeAbcd(grid, 3, 3, 0, 1)).toBe(3);
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

// Helper: build region data for tests
function makeRegion(name: string, x: number, y: number): TilesetRegion {
  return { name, x, y, w: 16, h: 16 };
}

const BEACH_REGIONS: TilesetRegion[] = [
  makeRegion('beach_top_left', 0, 0),
  makeRegion('beach_top_mid', 16, 0),
  makeRegion('beach_top_right', 32, 0),
  makeRegion('beach_center_left', 0, 16),
  makeRegion('beach_center', 16, 16),
  makeRegion('beach_center_right', 32, 16),
  makeRegion('beach_bottom_left', 0, 32),
  makeRegion('beach_bottom_mid', 16, 32),
  makeRegion('beach_bottom_right', 32, 32),
  makeRegion('beach_pond_top_left', 48, 0),
  makeRegion('beach_pond_top_right', 64, 0),
  makeRegion('beach_pond_bottom_left', 48, 16),
  makeRegion('beach_pond_bottom_right', 64, 16),
];

const BEACH_MASKS: Record<number, string> = {
  1: 'beach_top_left', 2: 'beach_top_right', 3: 'beach_top_mid',
  4: 'beach_bottom_left', 5: 'beach_center_left', 8: 'beach_bottom_right',
  10: 'beach_center_right', 12: 'beach_bottom_mid', 15: 'beach_center',
  7: 'beach_pond_bottom_right', 11: 'beach_pond_bottom_left',
  13: 'beach_pond_top_right', 14: 'beach_pond_top_left',
};

const WATER_MASKS: Record<number, string> = {
  1: 'water_top_left', 2: 'water_top_right', 3: 'water_top_mid',
  4: 'water_bottom_left', 5: 'water_center_left', 8: 'water_bottom_right',
  10: 'water_center_right', 12: 'water_bottom_mid', 15: 'water_center',
  7: 'water_mound_bottom_right', 11: 'water_mound_bottom_left',
  13: 'water_mound_top_right', 14: 'water_mound_top_left',
};

const WATER_REGIONS: TilesetRegion[] = [
  makeRegion('water_top_left', 0, 0), makeRegion('water_top_mid', 16, 0), makeRegion('water_top_right', 32, 0),
  makeRegion('water_center_left', 0, 16), makeRegion('water_center', 16, 16), makeRegion('water_center_right', 32, 16),
  makeRegion('water_bottom_left', 0, 32), makeRegion('water_bottom_mid', 16, 32), makeRegion('water_bottom_right', 32, 32),
  makeRegion('water_mound_top_left', 0, 48), makeRegion('water_mound_top_right', 16, 48),
  makeRegion('water_mound_bottom_left', 0, 64), makeRegion('water_mound_bottom_right', 16, 64),
];

describe('resolveTilesetGrid', () => {
  const tilesetDef: TilesetDef = {
    cell_size: 16,
    tiles: [
      {
        name: 'water', texture: 'water.png', mode: '3x3', surround: 3,
        masks: WATER_MASKS, regions: WATER_REGIONS,
      },
      {
        name: 'beach', texture: 'beach.png', mode: '3x3', surround: 1,
        masks: BEACH_MASKS, regions: BEACH_REGIONS,
      },
      {
        name: 'grass', texture: 'grass.png', mode: 'fill',
        masks: { 15: 'grass_fill' },
        regions: [makeRegion('grass_fill', 0, 0)],
      },
    ],
  };

  it('resolves static tile in base layer', () => {
    const def: TilesetDef = {
      cell_size: 16,
      tiles: [
        {
          name: 'rock', texture: 'decor.png',
          regions: [makeRegion('rock', 32, 16)],
        },
      ],
    };
    const data = [1, 0];
    const result = resolveTilesetGrid(data, 2, 1, def);
    expect(result.base[0]).toEqual({ texturePath: 'decor.png', x: 32, y: 16, w: 16, h: 16 });
    expect(result.base[1]).toBeNull();
    expect(result.overlays.every(c => c === null)).toBe(true);
  });

  it('resolves fill tile in base layer', () => {
    const data = [3, 3, 3, 3];
    const result = resolveTilesetGrid(data, 2, 2, tilesetDef);
    expect(result.base.every(c => c !== null && c.texturePath === 'grass.png' && c.x === 0 && c.y === 0)).toBe(true);
    expect(result.overlays.every(c => c === null)).toBe(true);
  });

  it('resolves 3x3 tile center in base layer', () => {
    const data = [2, 2, 2, 2];
    const result = resolveTilesetGrid(data, 2, 2, tilesetDef);
    expect(result.base.every(c => c !== null && c.texturePath === 'beach.png' && c.x === 16 && c.y === 16)).toBe(true);
  });

  it('places overlay on water cell adjacent to beach', () => {
    const data = [1, 1, 1, 1, 2, 1, 1, 1, 1];
    const result = resolveTilesetGrid(data, 3, 3, tilesetDef);

    // Center beach cell → base = beach_center
    expect(result.base[4]).toEqual({ texturePath: 'beach.png', x: 16, y: 16, w: 16, h: 16 });

    // Adjacent water cells get beach overlays
    expect(result.overlays[1]).not.toBeNull();
    expect(result.overlays[1]!.texturePath).toBe('beach.png');

    expect(result.overlays[3]).not.toBeNull();
    expect(result.overlays[3]!.texturePath).toBe('beach.png');

    expect(result.overlays[0]).not.toBeNull();
  });

  it('no overlay on cells far from 3x3 terrain', () => {
    const data = [1, 1, 1, 1];
    const result = resolveTilesetGrid(data, 2, 2, tilesetDef);
    expect(result.overlays.every(c => c === null)).toBe(true);
  });

  it('cross pattern produces correct overlays', () => {
    const data = [
      1, 1, 1, 1, 1,
      1, 1, 2, 1, 1,
      1, 2, 2, 2, 1,
      1, 1, 2, 1, 1,
      1, 1, 1, 1, 1,
    ];
    const result = resolveTilesetGrid(data, 5, 5, tilesetDef);

    // [0][1] ABCD=0001 → beach_top_left
    expect(result.overlays[0 * 5 + 1]).toEqual({ texturePath: 'beach.png', x: 0, y: 0, w: 16, h: 16 });
    // [0][2] ABCD=0011 → beach_top_mid
    expect(result.overlays[0 * 5 + 2]).toEqual({ texturePath: 'beach.png', x: 16, y: 0, w: 16, h: 16 });
    // [1][1] ABCD=0111 → beach_pond_bottom_right
    expect(result.overlays[1 * 5 + 1]).toEqual({ texturePath: 'beach.png', x: 64, y: 16, w: 16, h: 16 });
    // [2][0] ABCD=0101 → beach_center_left
    expect(result.overlays[2 * 5 + 0]).toEqual({ texturePath: 'beach.png', x: 0, y: 16, w: 16, h: 16 });
    // [3][3] ABCD=1110 → beach_pond_top_left
    expect(result.overlays[3 * 5 + 3]).toEqual({ texturePath: 'beach.png', x: 48, y: 0, w: 16, h: 16 });
    // [4][2] ABCD=1100 → beach_bottom_mid
    expect(result.overlays[4 * 5 + 2]).toEqual({ texturePath: 'beach.png', x: 16, y: 32, w: 16, h: 16 });
    // [4][3] ABCD=1000 → beach_bottom_right
    expect(result.overlays[4 * 5 + 3]).toEqual({ texturePath: 'beach.png', x: 32, y: 32, w: 16, h: 16 });

    // Base: beach cells get beach_center, water cells get water_center
    expect(result.base[1 * 5 + 2]).toEqual({ texturePath: 'beach.png', x: 16, y: 16, w: 16, h: 16 });
    expect(result.base[2 * 5 + 2]).toEqual({ texturePath: 'beach.png', x: 16, y: 16, w: 16, h: 16 });
    expect(result.base[0 * 5 + 0]).toEqual({ texturePath: 'water.png', x: 16, y: 16, w: 16, h: 16 });

    // Corner water cells [0][0] and [4][4] should have no overlay (ABCD=0000)
    expect(result.overlays[0 * 5 + 0]).toBeNull();
    expect(result.overlays[4 * 5 + 4]).toBeNull();
  });

  it('compatible tiles count as same for ABCD', () => {
    const def: TilesetDef = {
      cell_size: 16,
      tiles: [
        {
          name: 'water', texture: 'water.png', mode: 'fill',
          masks: { 15: 'water_center' },
          regions: [makeRegion('water_center', 16, 16)],
        },
        {
          name: 'beach', texture: 'beach.png', mode: '3x3', surround: 1, compatible: [3],
          masks: BEACH_MASKS, regions: BEACH_REGIONS,
        },
        {
          name: 'grass', texture: 'grass.png', mode: 'fill',
          masks: { 15: 'grass_fill' },
          regions: [makeRegion('grass_fill', 0, 0)],
        },
      ],
    };

    const data = [
      1, 1, 1,
      1, 2, 3,
      1, 1, 1,
    ];
    const result = resolveTilesetGrid(data, 3, 3, def);

    // Cell [1][2] = grass(3), compatible with beach(2)
    expect(result.base[1 * 3 + 2]).toEqual({ texturePath: 'grass.png', x: 0, y: 0, w: 16, h: 16 });

    // Water cells adjacent to beach+grass block still get overlay
    expect(result.overlays[0 * 3 + 1]).not.toBeNull();
  });

  it('handles empty cells', () => {
    const data = [0, 0, 0, 0];
    const result = resolveTilesetGrid(data, 2, 2, tilesetDef);
    expect(result.base.every(c => c === null)).toBe(true);
    expect(result.overlays.every(c => c === null)).toBe(true);
  });

  it('returns null for out-of-range tile IDs', () => {
    const data = [0, 99, 0];
    const result = resolveTilesetGrid(data, 3, 1, tilesetDef);
    expect(result.base[0]).toBeNull();
    expect(result.base[1]).toBeNull();
    expect(result.base[2]).toBeNull();
  });
});
