import { describe, it, expect } from 'vitest';
import { parseAtlas, regionByName } from '../src/engine/atlas.js';

describe('parseAtlas', () => {
  it('parses a valid atlas', () => {
    const atlas = parseAtlas({
      texture: 'sheet.png',
      regions: [
        { name: 'idle', x: 0, y: 0, width: 32, height: 48 },
        { name: 'walk', x: 32, y: 0, width: 32, height: 48 },
      ],
    });
    expect(atlas.texture).toBe('sheet.png');
    expect(atlas.regions).toHaveLength(2);
    expect(atlas.regions[0]).toEqual({ name: 'idle', x: 0, y: 0, width: 32, height: 48 });
  });

  it('rejects non-object', () => {
    expect(() => parseAtlas(null)).toThrow('atlas must be an object');
    expect(() => parseAtlas('string')).toThrow('atlas must be an object');
  });

  it('rejects missing texture', () => {
    expect(() => parseAtlas({ regions: [] })).toThrow('atlas.texture must be a non-empty string');
  });

  it('rejects non-array regions', () => {
    expect(() => parseAtlas({ texture: 'a.png', regions: 'no' })).toThrow('atlas.regions must be an array');
  });

  it('rejects invalid region', () => {
    expect(() => parseAtlas({ texture: 'a.png', regions: [{ name: 5 }] }))
      .toThrow('region[0].name must be a string');
  });

  it('rejects zero/negative dimensions', () => {
    expect(() => parseAtlas({ texture: 'a.png', regions: [{ name: 'a', x: 0, y: 0, width: 0, height: 10 }] }))
      .toThrow('region[0].width must be a positive number');
  });
});

describe('regionByName', () => {
  const atlas = parseAtlas({
    texture: 'sheet.png',
    regions: [
      { name: 'idle', x: 0, y: 0, width: 32, height: 48 },
      { name: 'walk', x: 32, y: 0, width: 32, height: 48 },
    ],
  });

  it('finds a region by name', () => {
    expect(regionByName(atlas, 'walk')).toEqual({ name: 'walk', x: 32, y: 0, width: 32, height: 48 });
  });

  it('returns null for missing region', () => {
    expect(regionByName(atlas, 'jump')).toBeNull();
  });
});
