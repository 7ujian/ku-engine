import { describe, it, expect } from 'vitest';
import { parseTileset } from '../src/persistence/tileset-loader.js';

describe('parseTileset', () => {
  it('parses new format with texture + regions', () => {
    const raw = {
      cell_size: 16,
      tiles: [
        {
          name: 'water',
          texture: 'water.png',
          mode: 'fill',
          masks: { '15': 'water_center' },
          regions: [
            { name: 'water_center', x: 16, y: 16, w: 16, h: 16 },
          ],
        },
        {
          name: 'beach',
          texture: 'beach.png',
          mode: '3x3',
          surround: 1,
          masks: { '1': 'beach_top_left', '15': 'beach_center' },
          regions: [
            { name: 'beach_top_left', x: 0, y: 0, w: 16, h: 16 },
            { name: 'beach_center', x: 16, y: 16, w: 16, h: 16 },
          ],
        },
      ],
    };
    const def = parseTileset(raw);
    expect(def.cell_size).toBe(16);
    expect(def.tiles).toHaveLength(2);
    expect(def.tiles[0].texture).toBe('water.png');
    expect(def.tiles[0].regions).toHaveLength(1);
    expect(def.tiles[0].regions![0]).toEqual({ name: 'water_center', x: 16, y: 16, w: 16, h: 16 });
    expect(def.tiles[0].masks).toEqual({ 15: 'water_center' });
    expect(def.tiles[1].masks).toEqual({ 1: 'beach_top_left', 15: 'beach_center' });
    expect(def.tiles[1].surround).toBe(1);
  });

  it('parses old format with atlas field', () => {
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
    expect(def.tiles[0].atlas).toBe('water.json');
    expect(def.tiles[0].mode).toBe('3x3');
    expect(def.tiles[0].texture).toBeUndefined();
    expect(def.tiles[1].region).toBe('rock');
    expect(def.tiles[2].mode).toBe('fill');
  });

  it('parses transitions', () => {
    const raw = {
      cell_size: 32,
      tiles: [
        { name: 'water', texture: 'w.png', mode: '3x3', regions: [{ name: 'w_center', x: 0, y: 0, w: 16, h: 16 }], surround: 2, masks: { '15': 'w_center' } },
        { name: 'sand', texture: 's.png', mode: '3x3', regions: [{ name: 's_center', x: 0, y: 0, w: 16, h: 16 }], surround: 1, masks: { '15': 's_center' } },
      ],
      transitions: {
        '1_2': { texture: 's.png', prefix: 's', mode: '3x3', regions: [{ name: 's_top_left', x: 0, y: 0, w: 16, h: 16 }] },
      },
    };
    const def = parseTileset(raw);
    expect(def.tiles[0].surround).toBe(2);
    expect(def.tiles[1].surround).toBe(1);
    expect(def.transitions).toBeDefined();
    expect(def.transitions!['1_2'].texture).toBe('s.png');
    expect(def.transitions!['1_2'].regions).toHaveLength(1);
  });

  it('parses compatible array', () => {
    const raw = {
      cell_size: 16,
      tiles: [
        { name: 'beach', texture: 'b.png', mode: '3x3', compatible: [2, 3], regions: [{ name: 'b_center', x: 0, y: 0, w: 16, h: 16 }], masks: { '15': 'b_center' } },
      ],
    };
    const def = parseTileset(raw);
    expect(def.tiles[0].compatible).toEqual([2, 3]);
  });

  it('parses masks field', () => {
    const raw = {
      cell_size: 16,
      tiles: [
        {
          name: 'beach', texture: 'b.png', mode: '3x3', surround: 1,
          masks: {
            '1': 'beach_top_left', '15': 'beach_center', '7': 'beach_pond_bottom_right',
          },
          regions: [
            { name: 'beach_top_left', x: 0, y: 0, w: 16, h: 16 },
            { name: 'beach_center', x: 16, y: 16, w: 16, h: 16 },
            { name: 'beach_pond_bottom_right', x: 64, y: 16, w: 16, h: 16 },
          ],
        },
      ],
    };
    const def = parseTileset(raw);
    expect(def.tiles[0].masks).toEqual({ 1: 'beach_top_left', 15: 'beach_center', 7: 'beach_pond_bottom_right' });
  });

  it('ignores invalid mask entries', () => {
    const raw = {
      cell_size: 16,
      tiles: [
        {
          name: 'cliff', texture: 'c.png', mode: '3x3',
          masks: { 'abc': 'bad', '5': 123 },
          regions: [{ name: 'c_center', x: 0, y: 0, w: 16, h: 16 }],
        },
      ],
    };
    const def = parseTileset(raw);
    expect(def.tiles[0].masks).toBeUndefined();
  });

  it('accepts regions with width/height fields', () => {
    const raw = {
      cell_size: 16,
      tiles: [
        {
          name: 'rock', texture: 'decor.png',
          regions: [{ name: 'rock', x: 0, y: 0, width: 16, height: 16 }],
        },
      ],
    };
    const def = parseTileset(raw);
    expect(def.tiles[0].regions![0]).toEqual({ name: 'rock', x: 0, y: 0, w: 16, h: 16 });
  });

  it('throws on missing cell_size', () => {
    expect(() => parseTileset({ tiles: [{ name: 'a', texture: 'a.png', regions: [{ name: 'r', x: 0, y: 0, w: 16, h: 16 }] }] }))
      .toThrow('cell_size');
  });

  it('throws on empty tiles', () => {
    expect(() => parseTileset({ cell_size: 16, tiles: [] }))
      .toThrow('tiles must be a non-empty array');
  });

  it('throws on tile missing both texture and atlas', () => {
    expect(() => parseTileset({ cell_size: 16, tiles: [{ name: 'bad', mode: 'fill' }] }))
      .toThrow('missing texture or atlas');
  });

  it('throws on tile missing mode, region, and regions', () => {
    expect(() => parseTileset({ cell_size: 16, tiles: [{ name: 'bad', texture: 'a.png' }] }))
      .toThrow('must have mode, region, or regions');
  });

  it('defaults name for unnamed tiles', () => {
    const raw = {
      cell_size: 16,
      tiles: [{ texture: 'a.png', regions: [{ name: 'r', x: 0, y: 0, w: 16, h: 16 }] }],
    };
    const def = parseTileset(raw);
    expect(def.tiles[0].name).toBe('tile_1');
  });

  it('skips invalid transitions', () => {
    const raw = {
      cell_size: 16,
      tiles: [{ texture: 'a.png', regions: [{ name: 'r', x: 0, y: 0, w: 16, h: 16 }] }],
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
