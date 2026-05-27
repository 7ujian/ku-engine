# Tiled Collision Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Read collision shapes from Tiled tileset `objectgroup` data and create collision geometry both at import time (CollisionShape nodes) and at runtime (internal Matter.js bodies).

**Architecture:** Two-phase pipeline — a new `src/engine/tiled-collision.ts` module extracts and merges collision shapes from tile data, shared by both the importer (creating scene nodes) and the runtime loader (creating physics bodies). The `CollisionShape` node type gains polygon support. Physics.ts gains polygon body creation.

**Tech Stack:** TypeScript, Matter.js, vitest

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `src/engine/tiled-collision.ts` | Extract + merge tile collision shapes |
| Create | `test/tiled-collision.test.ts` | Tests for extraction and merging |
| Modify | `src/engine/types.ts:102-116` | Add `TileCollisionShape`, `TileCollisionMap`, `MergedCollision` types; extend `TiledLayerData` |
| Modify | `src/engine/node-types.ts:67-73` | Add `polygon` to `CollisionShape` defaults, add `points` property |
| Modify | `src/engine/physics.ts:251-265` | Handle `shape: 'polygon'` in `syncShape()` |
| Modify | `src/persistence/tiled-importer.ts:132-216` | Generate CollisionShape children from tile collision data in `importTileLayer` |
| Modify | `src/persistence/tiled-importer.ts:60-113` | Add `tile_collisions` to `buildTiledLayerData` |
| Modify | `src/engine/physics.ts` | Add `addTileCollisions()` / `removeTileCollisions()` methods |

---

### Task 1: Add collision types to `src/engine/types.ts`

**Files:**
- Modify: `src/engine/types.ts`

- [ ] **Step 1: Write the types**

Add before the `TiledLayerData` interface (around line 100):

```typescript
/** A collision shape extracted from a Tiled tile's objectgroup */
export interface TileCollisionShape {
  type: 'rect' | 'polygon' | 'ellipse';
  x: number;
  y: number;
  width?: number;
  height?: number;
  points?: Array<{ x: number; y: number }>;
}

/** Maps tile local IDs to their collision shapes */
export type TileCollisionMap = Record<number, TileCollisionShape[]>;

/** A merged collision shape in world space */
export interface MergedCollision {
  type: 'rect' | 'polygon' | 'circle';
  x: number;
  y: number;
  width?: number;
  height?: number;
  radius?: number;
  points?: Array<{ x: number; y: number }>;
}
```

Add to the `TiledLayerData` interface:

```typescript
  /** Tile collision shapes extracted from tileset objectgroups (local tile ID → shapes) */
  tile_collisions?: TileCollisionMap;
```

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit`
Expected: PASS (types only, no consumers yet)

- [ ] **Step 3: Commit**

```bash
git add src/engine/types.ts
git commit -m "feat: add TileCollisionShape, TileCollisionMap, MergedCollision types"
```

---

### Task 2: Extend CollisionShape + TileMap node types

**Files:**
- Modify: `src/engine/node-types.ts:67-73` (CollisionShape)
- Modify: `src/engine/node-types.ts:147-155` (TileMap)

- [ ] **Step 1: Add `points` to CollisionShape factory and `tile_collisions_enabled` to TileMap**

Change the `createCollisionShape` factory (line 67) to:

```typescript
export const createCollisionShape = factory('CollisionShape', {
  shape: 'rect',
  width: 32,
  height: 32,
  radius: 0,
  points: [],
  color: '#33cc33',
});
```

Change the `createTileMap` factory (line 147) to add the collision gate:

```typescript
export const createTileMap = factory('TileMap', {
  tileset: '',
  cell_size: 16,
  columns: 0,
  rows: 0,
  data: '',
  terrain_map: {},
  tiled_map: '',
  tile_collisions_enabled: false,
});
```

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Run existing tests**

Run: `npx vitest run`
Expected: All existing tests PASS

- [ ] **Step 4: Commit**

```bash
git add src/engine/node-types.ts
git commit -m "feat: add polygon support to CollisionShape node type"
```

---

### Task 3: Create `src/engine/tiled-collision.ts` — extraction + merging

**Files:**
- Create: `src/engine/tiled-collision.ts`
- Create: `test/tiled-collision.test.ts`

- [ ] **Step 1: Write failing tests**

Create `test/tiled-collision.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { extractTileCollisions, mergeAdjacentRects, buildMergedCollisions } from '../src/engine/tiled-collision.js';
import type { TileCollisionMap } from '../src/engine/types.js';
import type { TiledTileDef } from '../src/persistence/tiled-types.js';

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

  it('extracts ellipse collision (near-square → circle)', () => {
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
    expect(result[0]).toHaveLength(0);
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
    // 3x1 grid: tiles at [0] and [1] are collidable
    const collisions: TileCollisionMap = {
      0: [{ type: 'rect', x: 0, y: 0, width: 16, height: 16 }],
    };
    const data = [1, 1, 0]; // GID 1 = tile local 0 (firstgid=1)
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
    const data = [1, 1, 1, 1]; // 2x2 grid, all collidable
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
    const data = [1, 1]; // 2x1 grid
    const result = mergeAdjacentRects(data, 2, 1, collisions, 1, 16, 16);
    // Not full-tile, so not merged — returned as individual shapes
    expect(result).toHaveLength(2);
  });

  it('does not merge polygon tiles', () => {
    const collisions: TileCollisionMap = {
      0: [{ type: 'polygon', x: 0, y: 0, points: [{ x: 0, y: 0 }, { x: 16, y: 0 }, { x: 8, y: 16 }] }],
    };
    const data = [1, 1]; // 2x1 grid
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
    const data = [1, 0, 1]; // 3x1, gap in middle
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
    const data = [1]; // 1x1 grid
    const result = buildMergedCollisions(data, 1, 1, collisions, 1, 16, 16);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('circle');
    expect(result[0].radius).toBe(8);
  });

  it('converts non-square ellipse to polygon in output', () => {
    const collisions: TileCollisionMap = {
      0: [{ type: 'ellipse', x: 2, y: 2, width: 12, height: 8 }],
    };
    const data = [1]; // 1x1 grid
    const result = buildMergedCollisions(data, 1, 1, collisions, 1, 16, 16);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('polygon');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/tiled-collision.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

Create `src/engine/tiled-collision.ts`:

```typescript
import type { TileCollisionShape, TileCollisionMap, MergedCollision } from './types.js';
import type { TiledTileDef } from '../persistence/tiled-types.js';
import { GID_MASK } from '../persistence/tiled-types.js';

/** Extract collision shapes from Tiled tile definitions */
export function extractTileCollisions(tiles: TiledTileDef[] | undefined): TileCollisionMap {
  const result: TileCollisionMap = {};
  if (!tiles) return result;

  for (const tile of tiles) {
    if (!tile.objectgroup?.objects?.length) continue;
    const shapes: TileCollisionShape[] = [];
    for (const obj of tile.objectgroup.objects) {
      if (obj.point || obj.polyline) continue;

      if (obj.ellipse) {
        shapes.push({
          type: 'ellipse',
          x: obj.x,
          y: obj.y,
          width: obj.width,
          height: obj.height,
        });
      } else if (obj.polygon) {
        // Polygon points are relative to the object's x, y
        const points = obj.polygon.map(p => ({
          x: obj.x + p.x,
          y: obj.y + p.y,
        }));
        shapes.push({
          type: 'polygon',
          x: obj.x,
          y: obj.y,
          points,
        });
      } else {
        // Rectangle
        shapes.push({
          type: 'rect',
          x: obj.x,
          y: obj.y,
          width: obj.width ?? 0,
          height: obj.height ?? 0,
        });
      }
    }
    if (shapes.length > 0) {
      result[tile.id] = shapes;
    }
  }

  return result;
}

/**
 * Check if a collision shape is a full-tile rectangle eligible for merging.
 * Full-tile means x=0, y=0, width=tilewidth, height=tileheight.
 */
function isFullTileRect(shape: TileCollisionShape, tilewidth: number, tileheight: number): boolean {
  return shape.type === 'rect' && shape.x === 0 && shape.y === 0 &&
    shape.width === tilewidth && shape.height === tileheight;
}

/**
 * Merge adjacent full-tile collision rects into larger rectangles.
 * Returns world-space MergedCollision array.
 * Non-mergeable shapes pass through individually.
 */
export function mergeAdjacentRects(
  data: number[],
  width: number,
  height: number,
  collisions: TileCollisionMap,
  firstgid: number,
  tilewidth: number,
  tileheight: number,
): MergedCollision[] {
  if (!collisions || Object.keys(collisions).length === 0) return [];

  // Build grid: which cells are mergeable full-tile rects, and which have non-mergeable shapes
  const mergeable = new Uint8Array(data.length); // 1 = mergeable
  const nonMergeable: Array<{ col: number; row: number; shapes: TileCollisionShape[] }> = [];

  for (let i = 0; i < data.length; i++) {
    const gid = data[i] & GID_MASK;
    if (gid === 0) continue;
    const localId = gid - firstgid;
    const shapes = collisions[localId];
    if (!shapes) continue;

    // Only merge tiles with a single full-tile rect
    if (shapes.length === 1 && isFullTileRect(shapes[0], tilewidth, tileheight)) {
      mergeable[i] = 1;
    } else {
      const col = i % width;
      const row = Math.floor(i / width);
      nonMergeable.push({ col, row, shapes });
    }
  }

  const results: MergedCollision[] = [];

  // Horizontal run-length merging
  const visited = new Uint8Array(data.length);
  for (let row = 0; row < height; row++) {
    let col = 0;
    while (col < width) {
      const idx = row * width + col;
      if (!mergeable[idx] || visited[idx]) {
        col++;
        continue;
      }
      // Start a horizontal run
      let runEnd = col + 1;
      while (runEnd < width && mergeable[row * width + runEnd]) {
        runEnd++;
      }
      // Mark run as visited
      for (let c = col; c < runEnd; c++) {
        visited[row * width + c] = 1;
      }
      // Try vertical extension
      let runWidth = runEnd - col;
      let runRow = row + 1;
      while (runRow < height) {
        let allMatch = true;
        for (let c = col; c < runEnd; c++) {
          if (!mergeable[runRow * width + c] || visited[runRow * width + c]) {
            allMatch = false;
            break;
          }
        }
        if (!allMatch) break;
        for (let c = col; c < runEnd; c++) {
          visited[runRow * width + c] = 1;
        }
        runRow++;
      }

      results.push({
        type: 'rect',
        x: col * tilewidth,
        y: row * tileheight,
        width: runWidth * tilewidth,
        height: (runRow - row) * tileheight,
      });

      col = runEnd;
    }
  }

  // Add non-mergeable shapes
  for (const { col, row, shapes } of nonMergeable) {
    for (const shape of shapes) {
      const worldX = col * tilewidth + (shape.x ?? 0);
      const worldY = row * tileheight + (shape.y ?? 0);
      results.push({
        type: shape.type,
        x: worldX,
        y: worldY,
        width: shape.width,
        height: shape.height,
        points: shape.points?.map(p => ({
          x: col * tilewidth + p.x,
          y: row * tileheight + p.y,
        })),
      });
    }
  }

  return results;
}

/**
 * Build merged collisions, converting ellipses to circles or polygons.
 */
export function buildMergedCollisions(
  data: number[],
  width: number,
  height: number,
  collisions: TileCollisionMap,
  firstgid: number,
  tilewidth: number,
  tileheight: number,
): MergedCollision[] {
  const raw = mergeAdjacentRects(data, width, height, collisions, firstgid, tilewidth, tileheight);
  return raw.map(c => {
    if (c.type === 'ellipse') {
      const w = c.width ?? 0;
      const h = c.height ?? 0;
      // Near-square ellipse → circle
      if (Math.abs(w - h) < Math.max(w, h) * 0.1) {
        const r = Math.min(w, h) / 2;
        return {
          type: 'circle' as const,
          x: (c.x ?? 0) + w / 2,
          y: (c.y ?? 0) + h / 2,
          radius: r,
        };
      }
      // Non-square ellipse → approximate as polygon (16 vertices)
      const cx = (c.x ?? 0) + w / 2;
      const cy = (c.y ?? 0) + h / 2;
      const rx = w / 2;
      const ry = h / 2;
      const steps = 16;
      const points: Array<{ x: number; y: number }> = [];
      for (let i = 0; i < steps; i++) {
        const angle = (2 * Math.PI * i) / steps;
        points.push({
          x: cx + rx * Math.cos(angle),
          y: cy + ry * Math.sin(angle),
        });
      }
      return { type: 'polygon' as const, x: cx, y: cy, points };
    }
    return c;
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/tiled-collision.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/engine/tiled-collision.ts test/tiled-collision.test.ts
git commit -m "feat: add tile collision extraction and merging"
```

---

### Task 4: Add polygon body creation to PhysicsWorld

**Files:**
- Modify: `src/engine/physics.ts:251-265` (the `syncShape` method)

- [ ] **Step 1: Write failing test**

Add to `test/tiled-collision.test.ts` (new describe block at the end):

```typescript
import { PhysicsWorld } from '../src/engine/physics.js';
import { SceneTree } from '../src/engine/scene-tree.js';
import { createNodeByType } from '../src/engine/node-types.js';

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
    tree.add(tree.root, shape);
    physics.syncFromTree();
    // Step physics to verify body was created without error
    physics.step(16);
    physics.destroy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/tiled-collision.test.ts`
Expected: FAIL — polygon shape falls through to rect body creation (no `shape === 'polygon'` branch)

- [ ] **Step 3: Add polygon branch to `syncShape`**

In `src/engine/physics.ts`, in the `syncShape` method, replace the body creation block (around lines 251-265):

Find:
```typescript
    let body: Matter.Body;
    const collisionFilter = {
      category: (node.getProperty('collision_layer') as number) ?? 0x0001,
      mask: (node.getProperty('collision_mask') as number) ?? 0xFFFF,
    };
    if (shape === 'circle') {
      const radius = (node.getProperty('radius') as number) ?? 16;
      body = Matter.Bodies.circle(wx, wy, radius, { label: node.id, isStatic, collisionFilter });
    } else {
      body = Matter.Bodies.rectangle(wx, wy, width, height, { label: node.id, isStatic, collisionFilter });
    }
```

Replace with:
```typescript
    let body: Matter.Body;
    const collisionFilter = {
      category: (node.getProperty('collision_layer') as number) ?? 0x0001,
      mask: (node.getProperty('collision_mask') as number) ?? 0xFFFF,
    };
    if (shape === 'circle') {
      const radius = (node.getProperty('radius') as number) ?? 16;
      body = Matter.Bodies.circle(wx, wy, radius, { label: node.id, isStatic, collisionFilter });
    } else if (shape === 'polygon') {
      const rawPoints = (node.getProperty('points') as Array<{ x: number; y: number }>) ?? [];
      if (rawPoints.length >= 3) {
        body = Matter.Bodies.fromVertices(wx, wy, rawPoints as Matter.Vector[], { label: node.id, isStatic, collisionFilter });
        if (!body) {
          // fromVertices can return undefined for degenerate polygons — fall back to rect
          body = Matter.Bodies.rectangle(wx, wy, width, height, { label: node.id, isStatic, collisionFilter });
        }
      } else {
        body = Matter.Bodies.rectangle(wx, wy, width, height, { label: node.id, isStatic, collisionFilter });
      }
    } else {
      body = Matter.Bodies.rectangle(wx, wy, width, height, { label: node.id, isStatic, collisionFilter });
    }
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run test/tiled-collision.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Run full test suite**

Run: `npx vitest run`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/engine/physics.ts test/tiled-collision.test.ts
git commit -m "feat: add polygon collision body support in PhysicsWorld"
```

---

### Task 5: Integrate collision extraction into tiled-importer (import path)

**Files:**
- Modify: `src/persistence/tiled-importer.ts:132-216`

- [ ] **Step 1: Add collision child generation to `importTileLayer`**

At the top of `src/persistence/tiled-importer.ts`, add the import:

```typescript
import { extractTileCollisions, buildMergedCollisions } from '../engine/tiled-collision.js';
```

In the `importTileLayer` function, after the TileMap node is created in both the single-tileset and multi-tileset branches, add collision children. For the single-tileset case (around line 162), after the `return [...]`:

Find the single-tileset return block:
```typescript
		return [node(sanitizeId(layer.name), 'TileMap', {
			x: layer.offsetx ?? 0,
			y: layer.offsety ?? 0,
			tiled_layers: [{
				image: relImage,
				columns: ts.columns,
				tilewidth: ts.tilewidth,
				tileheight: ts.tileheight,
				firstgid: ts.firstgid,
				data,
				width: layer.width,
				height: layer.height,
				opacity: layer.opacity,
				name: layer.name,
				tile_images: buildTileImages(ts, projectDir),
			}],
		})];
```

Replace with:
```typescript
		const collisionChildren = buildCollisionChildren(ts, data, layer.width, layer.height);

		return [node(sanitizeId(layer.name), 'TileMap', {
			x: layer.offsetx ?? 0,
			y: layer.offsety ?? 0,
			tiled_layers: [{
				image: relImage,
				columns: ts.columns,
				tilewidth: ts.tilewidth,
				tileheight: ts.tileheight,
				firstgid: ts.firstgid,
				data,
				width: layer.width,
				height: layer.height,
				opacity: layer.opacity,
				name: layer.name,
				tile_images: buildTileImages(ts, projectDir),
			}],
		}, collisionChildren)];
```

For the multi-tileset case (around line 196), find:
```typescript
			nodes.push(node(sanitizeId(`${layer.name}_${ts.name}`), 'TileMap', {
				x: layer.offsetx ?? 0,
				y: layer.offsety ?? 0,
				tiled_layers: [{
```

Replace with:
```typescript
			const collisionChildren = buildCollisionChildren(ts, filteredData, layer.width, layer.height);

			nodes.push(node(sanitizeId(`${layer.name}_${ts.name}`), 'TileMap', {
				x: layer.offsetx ?? 0,
				y: layer.offsety ?? 0,
				tiled_layers: [{
```

And update the closing of that node() call to include collisionChildren:
```typescript
				}, collisionChildren));
```

Add the helper function at the bottom of the file (before `sanitizeId`):

```typescript
/** Build CollisionShape child nodes from tile collision data */
function buildCollisionChildren(
	ts: TiledTilesetFull,
	data: number[],
	layerWidth: number,
	layerHeight: number,
): NodeData[] {
	const collisions = extractTileCollisions(ts.tiles);
	if (Object.keys(collisions).length === 0) return [];

	const merged = buildMergedCollisions(
		data, layerWidth, layerHeight, collisions, ts.firstgid, ts.tilewidth, ts.tileheight,
	);

	return merged.map((col, i) => {
		const props: PropertyMap = {
			x: col.x,
			y: col.y,
			shape: col.type,
			color: '#33cc3388',
		};
		if (col.type === 'rect') {
			props.width = col.width ?? 32;
			props.height = col.height ?? 32;
		} else if (col.type === 'circle') {
			props.radius = col.radius ?? 8;
		} else if (col.type === 'polygon') {
			props.points = col.points ?? [];
		}
		return node(`collision_${i}`, 'CollisionShape', props);
	});
}
```

- [ ] **Step 2: Add `tile_collisions` to `buildTiledLayerData`**

In the `buildTiledLayerData` function, inside the `results.push(...)` call (around line 97), add after `tile_images`:

```typescript
				tile_collisions: extractTileCollisions(ts.tiles),
```

- [ ] **Step 3: Run full test suite**

Run: `npx vitest run`
Expected: All tests PASS (existing tests should still pass — no collision tiles in their fixtures)

- [ ] **Step 4: Commit**

```bash
git add src/persistence/tiled-importer.ts
git commit -m "feat: generate CollisionShape children from Tiled tile collision data"
```

---

### Task 6: Add `addTileCollisions` / `removeTileCollisions` to PhysicsWorld (runtime path)

**Files:**
- Modify: `src/engine/physics.ts`

- [ ] **Step 1: Add tile collision methods to PhysicsWorld**

Add these methods to the `PhysicsWorld` class (after the `removeBody` method):

```typescript
  /** Create physics bodies from tile collision data (runtime path) */
  addTileCollisions(
    nodeId: string,
    merged: Array<{ type: string; x: number; y: number; width?: number; height?: number; radius?: number; points?: Array<{ x: number; y: number }> }>,
  ): void {
    const bodies: Matter.Body[] = [];
    for (let i = 0; i < merged.length; i++) {
      const col = merged[i];
      let body: Matter.Body;
      const label = `${nodeId}_tile_${i}`;
      if (col.type === 'circle') {
        body = Matter.Bodies.circle(col.x, col.y, col.radius ?? 8, {
          label,
          isStatic: true,
          collisionFilter: { category: 0x0001, mask: 0xFFFF },
        });
      } else if (col.type === 'polygon' && col.points && col.points.length >= 3) {
        body = Matter.Bodies.fromVertices(col.x, col.y, col.points as Matter.Vector[], {
          label,
          isStatic: true,
          collisionFilter: { category: 0x0001, mask: 0xFFFF },
        });
        if (!body) continue; // degenerate polygon
      } else {
        const w = col.width ?? 16;
        const h = col.height ?? 16;
        body = Matter.Bodies.rectangle(col.x + w / 2, col.y + h / 2, w, h, {
          label,
          isStatic: true,
          collisionFilter: { category: 0x0001, mask: 0xFFFF },
        });
      }
      bodies.push(body);
    }
    for (const body of bodies) {
      Matter.Composite.add(this.engine.world, body);
      this.bodyMap.set(body.label, body);
    }
  }

  /** Remove tile collision bodies created by addTileCollisions */
  removeTileCollisions(nodeId: string): void {
    const prefix = `${nodeId}_tile_`;
    for (const [key, body] of this.bodyMap) {
      if (key.startsWith(prefix)) {
        Matter.Composite.remove(this.engine.world, body);
        this.bodyMap.delete(key);
      }
    }
  }
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run`
Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add src/engine/physics.ts
git commit -m "feat: add addTileCollisions/removeTileCollisions to PhysicsWorld"
```

---

### Task 7: Integration test — import a Tiled map with collision tiles

**Files:**
- Modify: `test/tiled-collision.test.ts`

- [ ] **Step 1: Write integration test**

Add to `test/tiled-collision.test.ts`:

```typescript
import { importTiledMap } from '../src/persistence/tiled-importer.js';
import type { TiledMapResolved } from '../src/persistence/tiled-loader.js';

describe('Tiled collision integration', () => {
  it('imports collision shapes as CollisionShape children of TileMap', () => {
    // Build a minimal Tiled map with a tile that has collision
    const tiledMap: TiledMapResolved = {
      width: 2,
      height: 1,
      tilewidth: 16,
      tileheight: 16,
      orientation: 'orthogonal',
      renderorder: 'right-down',
      infinite: false,
      mapDir: '/test',
      mapPath: '/test/map.tmj',
      layers: [
        {
          type: 'tilelayer',
          name: 'ground',
          width: 2,
          height: 1,
          data: [1, 1],
        } as any,
      ],
      tilesets: [
        {
          firstgid: 1,
          name: 'terrain',
          image: '/test/tiles.png',
          imagewidth: 32,
          imageheight: 16,
          tilewidth: 16,
          tileheight: 16,
          tilecount: 2,
          columns: 2,
          tiles: [
            {
              id: 0,
              objectgroup: {
                type: 'objectgroup',
                name: '',
                objects: [
                  { id: 1, x: 0, y: 0, width: 16, height: 16 },
                ],
              },
            },
          ],
        } as any,
      ],
    };

    const scene = importTiledMap(tiledMap, '/test');
    const tilemap = scene.children?.[0];
    expect(tilemap).toBeDefined();
    expect(tilemap!.type).toBe('TileMap');
    expect(tilemap!.children).toBeDefined();
    expect(tilemap!.children!.length).toBeGreaterThanOrEqual(1);
    // Should have one merged collision rect covering both tiles
    const collisionChild = tilemap!.children!.find(c => c.type === 'CollisionShape');
    expect(collisionChild).toBeDefined();
    expect(collisionChild!.properties.shape).toBe('rect');
    expect(collisionChild!.properties.width).toBe(32);
    expect(collisionChild!.properties.height).toBe(16);
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run test/tiled-collision.test.ts`
Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add test/tiled-collision.test.ts
git commit -m "test: add integration test for Tiled collision import"
```

---

### Task 8: Run full test suite and verify

- [ ] **Step 1: Run all tests**

Run: `npx vitest run`
Expected: All tests PASS

- [ ] **Step 2: Run type check**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: address test/type issues from Tiled collision integration"
```
