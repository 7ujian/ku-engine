import { describe, it, expect } from 'vitest';
import { parseTileset } from '../src/persistence/tileset-loader.js';

describe('parseTileset', () => {
  it('parses valid tileset with mixed tiles', () => {
    const raw = {
      cell_size: 16,
      tiles: [
        { name: 'water', atlas: 'water.json', mode: '3x3', prefix: 'water' },
        { name: 'rock', atlas: 'decor.json', region: 'rock' },
        { name: 'grass', atlas: 'grass.json', mode: 'fill', prefix: 'grass_fill' },
      ],
    };
    const def = parseTileset(raw);
    expect(def.cell_size).toBe(16);
    expect(def.tiles).toHaveLength(3);
    expect(def.tiles[0]).toEqual({ name: 'water', atlas: 'water.json', mode: '3x3', prefix: 'water', region: undefined, compatible: undefined });
    expect(def.tiles[1]).toEqual({ name: 'rock', atlas: 'decor.json', region: 'rock', mode: undefined, prefix: undefined, compatible: undefined });
    expect(def.tiles[2]).toEqual({ name: 'grass', atlas: 'grass.json', mode: 'fill', prefix: 'grass_fill', region: undefined, compatible: undefined });
  });

  it('parses transitions', () => {
    const raw = {
      cell_size: 32,
      tiles: [
        { name: 'water', atlas: 'w.json', mode: '3x3', prefix: 'w', surround: 2 },
        { name: 'sand', atlas: 's.json', mode: '3x3', prefix: 's', surround: 1 },
      ],
      transitions: {
        '1_2': { atlas: 's.json', prefix: 's', mode: '3x3' },
      },
    };
    const def = parseTileset(raw);
    expect(def.tiles[0].surround).toBe(2);
    expect(def.tiles[1].surround).toBe(1);
    expect(def.transitions).toBeDefined();
    expect(def.transitions!['1_2']).toEqual({ atlas: 's.json', prefix: 's', mode: '3x3' });
  });

  it('parses compatible array', () => {
    const raw = {
      cell_size: 16,
      tiles: [
        { name: 'beach', atlas: 'b.json', mode: '3x3', prefix: 'b', compatible: [2, 3] },
      ],
    };
    const def = parseTileset(raw);
    expect(def.tiles[0].compatible).toEqual([2, 3]);
  });

  it('throws on missing cell_size', () => {
    expect(() => parseTileset({ tiles: [{ name: 'a', atlas: 'a.json', region: 'r' }] }))
      .toThrow('cell_size');
  });

  it('throws on empty tiles', () => {
    expect(() => parseTileset({ cell_size: 16, tiles: [] }))
      .toThrow('tiles must be a non-empty array');
  });

  it('throws on tile missing atlas', () => {
    expect(() => parseTileset({ cell_size: 16, tiles: [{ name: 'bad', region: 'r' }] }))
      .toThrow('missing atlas');
  });

  it('throws on tile missing both mode and region', () => {
    expect(() => parseTileset({ cell_size: 16, tiles: [{ name: 'bad', atlas: 'a.json' }] }))
      .toThrow('must have either mode or region');
  });

  it('defaults name for unnamed tiles', () => {
    const raw = {
      cell_size: 16,
      tiles: [{ atlas: 'a.json', region: 'r' }],
    };
    const def = parseTileset(raw);
    expect(def.tiles[0].name).toBe('tile_1');
  });

  it('skips invalid transitions', () => {
    const raw = {
      cell_size: 16,
      tiles: [{ atlas: 'a.json', region: 'r' }],
      transitions: {
        '1_2': 'not an object',
        '2_3': {},
      },
    };
    const def = parseTileset(raw);
    expect(Object.keys(def.transitions ?? {})).toHaveLength(0);
  });

  it('throws on non-object input', () => {
    expect(() => parseTileset(null)).toThrow('expected object');
    expect(() => parseTileset('string')).toThrow('expected object');
  });
});
