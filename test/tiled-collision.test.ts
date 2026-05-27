import { describe, it, expect } from 'vitest';
import { extractTileCollisions, mergeAdjacentRects, buildMergedCollisions } from '../src/engine/tiled-collision.js';
import type { TileCollisionMap } from '../src/engine/types.js';
import type { TiledTileDef } from '../src/persistence/tiled-types.js';
import { PhysicsWorld } from '../src/engine/physics.js';
import { SceneTree } from '../src/engine/scene-tree.js';
import { createNodeByType } from '../src/engine/node-types.js';

describe('extractTileCollisions', () => {
  it('extracts rect collision from tile objectgroup', () => {
    const tiles: TiledTileDef[] = [
      {
        id: 0,
        objectgroup: {
          type: 'objectgroup',
          name: '',
          objects: [
            { id: 1, x: 0, y: 0, width: 16, height: 16 },
          ],
        },
      } as any,
    ];
    const result = extractTileCollisions(tiles);
    expect(result[0]).toHaveLength(1);
    expect(result[0][0]).toEqual({
      type: 'rect',
      x: 0,
      y: 0,
      width: 16,
      height: 16,
    });
  });

  it('extracts polygon collision from tile objectgroup', () => {
    const tiles: TiledTileDef[] = [
      {
        id: 5,
        objectgroup: {
          type: 'objectgroup',
          name: '',
          objects: [
            {
              id: 1,
              x: 8,
              y: 8,
              polygon: [
                { x: 0, y: -8 },
                { x: 8, y: 0 },
                { x: 0, y: 8 },
              ],
            },
          ],
        },
      } as any,
    ];
    const result = extractTileCollisions(tiles);
    expect(result[5]).toHaveLength(1);
    expect(result[5][0].type).toBe('polygon');
    expect(result[5][0].points).toEqual([
      { x: 8, y: 0 },
      { x: 16, y: 8 },
      { x: 8, y: 16 },
    ]);
  });

  it('extracts ellipse collision (near-square)', () => {
    const tiles: TiledTileDef[] = [
      {
        id: 3,
        objectgroup: {
          type: 'objectgroup',
          name: '',
          objects: [
            { id: 1, x: 0, y: 0, width: 16, height: 16, ellipse: true },
          ],
        },
      } as any,
    ];
    const result = extractTileCollisions(tiles);
    expect(result[3]).toHaveLength(1);
    expect(result[3][0].type).toBe('ellipse');
  });

  it('extracts ellipse collision (non-square)', () => {
    const tiles: TiledTileDef[] = [
      {
        id: 4,
        objectgroup: {
          type: 'objectgroup',
          name: '',
          objects: [
            { id: 1, x: 2, y: 2, width: 12, height: 8, ellipse: true },
          ],
        },
      } as any,
    ];
    const result = extractTileCollisions(tiles);
    expect(result[4]).toHaveLength(1);
    expect(result[4][0].type).toBe('ellipse');
    expect(result[4][0].width).toBe(12);
    expect(result[4][0].height).toBe(8);
  });

  it('skips point and polyline objects', () => {
    const tiles: TiledTileDef[] = [
      {
        id: 0,
        objectgroup: {
          type: 'objectgroup',
          name: '',
          objects: [
            { id: 1, x: 5, y: 5, point: true },
            { id: 2, x: 0, y: 0, polyline: [{ x: 0, y: 0 }, { x: 16, y: 0 }] },
          ],
        },
      } as any,
    ];
    const result = extractTileCollisions(tiles);
    expect(result[0]).toBeUndefined();
  });

  it('skips tiles with no objectgroup', () => {
    const tiles: TiledTileDef[] = [
      { id: 0 },
      { id: 1, objectgroup: { type: 'objectgroup', name: '', objects: [] } },
    ];
    const result = extractTileCollisions(tiles);
    expect(Object.keys(result)).toHaveLength(0);
  });

  it('extracts multiple shapes from a single tile', () => {
    const tiles: TiledTileDef[] = [
      {
        id: 0,
        objectgroup: {
          type: 'objectgroup',
          name: '',
          objects: [
            { id: 1, x: 0, y: 0, width: 8, height: 16 },
            { id: 2, x: 8, y: 0, width: 8, height: 16 },
          ],
        },
      } as any,
    ];
    const result = extractTileCollisions(tiles);
    expect(result[0]).toHaveLength(2);
  });
});

describe('mergeAdjacentRects', () => {
  it('merges two horizontally adjacent full-tile rects', () => {
    const collisions: TileCollisionMap = {
      0: [{ type: 'rect', x: 0, y: 0, width: 16, height: 16 }],
    };
    const data = [1, 1, 0];
    const result = mergeAdjacentRects(data, 3, 1, collisions, 1, 16, 16);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      type: 'rect',
      x: 0,
      y: 0,
      width: 32,
      height: 16,
    });
  });

  it('merges 2x2 block of adjacent rects', () => {
    const collisions: TileCollisionMap = {
      0: [{ type: 'rect', x: 0, y: 0, width: 16, height: 16 }],
    };
    const data = [1, 1, 1, 1];
    const result = mergeAdjacentRects(data, 2, 2, collisions, 1, 16, 16);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      type: 'rect',
      x: 0,
      y: 0,
      width: 32,
      height: 32,
    });
  });

  it('does not merge partial-tile rects', () => {
    const collisions: TileCollisionMap = {
      0: [{ type: 'rect', x: 2, y: 2, width: 12, height: 12 }],
    };
    const data = [1, 1];
    const result = mergeAdjacentRects(data, 2, 1, collisions, 1, 16, 16);
    expect(result).toHaveLength(2);
  });

  it('does not merge polygon tiles', () => {
    const collisions: TileCollisionMap = {
      0: [{ type: 'polygon', x: 0, y: 0, points: [{ x: 0, y: 0 }, { x: 16, y: 0 }, { x: 8, y: 16 }] }],
    };
    const data = [1, 1];
    const result = mergeAdjacentRects(data, 2, 1, collisions, 1, 16, 16);
    expect(result).toHaveLength(2);
    expect(result[0].type).toBe('polygon');
  });

  it('handles empty collision map', () => {
    const result = mergeAdjacentRects([0, 0, 0], 3, 1, {}, 1, 16, 16);
    expect(result).toHaveLength(0);
  });

  it('handles gaps in collidable tiles', () => {
    const collisions: TileCollisionMap = {
      0: [{ type: 'rect', x: 0, y: 0, width: 16, height: 16 }],
    };
    const data = [1, 0, 1];
    const result = mergeAdjacentRects(data, 3, 1, collisions, 1, 16, 16);
    expect(result).toHaveLength(2);
    expect(result[0].width).toBe(16);
    expect(result[1].width).toBe(16);
    expect(result[1].x).toBe(32);
  });
});

describe('buildMergedCollisions', () => {
  it('converts ellipse (near-square) to circle in output', () => {
    const collisions: TileCollisionMap = {
      0: [{ type: 'ellipse', x: 0, y: 0, width: 16, height: 16 }],
    };
    const data = [1];
    const result = buildMergedCollisions(data, 1, 1, collisions, 1, 16, 16);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('circle');
    expect(result[0].radius).toBe(8);
  });

  it('converts non-square ellipse to polygon in output', () => {
    const collisions: TileCollisionMap = {
      0: [{ type: 'ellipse', x: 2, y: 2, width: 12, height: 8 }],
    };
    const data = [1];
    const result = buildMergedCollisions(data, 1, 1, collisions, 1, 16, 16);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('polygon');
  });
});

describe('PhysicsWorld polygon collision', () => {
  it('creates a Matter.js body for polygon CollisionShape', () => {
    const tree = new SceneTree();
    const physics = new PhysicsWorld(tree);
    const shape = createNodeByType('CollisionShape', 'poly_shape', {
      shape: 'polygon',
      x: 100,
      y: 100,
      points: [
        { x: 0, y: -20 },
        { x: 20, y: 0 },
        { x: 0, y: 20 },
        { x: -20, y: 0 },
      ],
    });
    tree.add('/', shape);
    physics.syncFromTree();
    physics.step(16);
    physics.destroy();
  });
});
