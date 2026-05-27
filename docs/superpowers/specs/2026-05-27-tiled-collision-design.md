# Tiled Collision Support

## Goal

Read collision shapes from Tiled tileset `objectgroup` data and integrate them with ku's physics system — both at import time (editor, as CollisionShape nodes) and at runtime (play, as internal Matter.js bodies).

## Data Structures

### New types in `src/engine/types.ts`

```typescript
interface TileCollisionShape {
  type: 'rect' | 'polygon' | 'ellipse';
  x: number;       // local offset within tile
  y: number;
  width?: number;   // for rect and ellipse
  height?: number;  // for rect and ellipse
  points?: Array<{ x: number; y: number }>; // for polygon
}

type TileCollisionMap = Record<number, TileCollisionShape[]>; // local tile ID → shapes
```

### Extension to `TiledLayerData`

```typescript
interface TiledLayerData {
  // ... existing fields ...
  tile_collisions?: Record<number, TileCollisionShape[]>; // local tile ID → shapes
}
```

### CollisionShape node type

- Add `'polygon'` to the `shape` union: `'rect' | 'circle' | 'polygon'`
- Add optional `points: Array<{ x: number; y: number }>` property

## Collision Extraction + Merging

New file: `src/engine/tiled-collision.ts`

### `extractTileCollisions(tiles: TiledTileDef[]): TileCollisionMap`

Iterate tile definitions, read each tile's `objectgroup.objects`:

| Tiled object flags | Mapped shape |
|---|---|
| No special flags | Rectangle (`x, y, width, height`) |
| `ellipse: true` | Ellipse (or circle if width ≈ height) |
| `polygon: true` | Polygon (points offset by object `x, y`) |
| `point: true` | Skipped |
| `polyline: true` | Skipped (open path) |

### `mergeAdjacentRects(layerData, width, height, collisions, tilewidth, tileheight)`

Only applies to tiles whose collision is a single full-tile rectangle (x=0, y=0, w=tilewidth, h=tileheight).

- Scan rows, merge horizontally adjacent collidable tiles into runs
- Merge vertically adjacent runs of same width
- Non-mergeable shapes (polygons, partial rects, multi-shape tiles) pass through individually

Returns `MergedCollision[]` where:
```typescript
interface MergedCollision {
  type: 'rect' | 'polygon' | 'circle';
  x: number; y: number;           // world-space position
  width?: number; height?: number; // for rect
  radius?: number;                 // for circle
  points?: Array<{ x: number; y: number }>; // for polygon (world-space)
}
```

## Import-Time Integration (`src/persistence/tiled-importer.ts`)

When importing a tile layer with collision data:

1. Call `extractTileCollisions` on the tileset tiles, then `mergeAdjacentRects` on the layer data
2. Create `CollisionShape` child nodes under the TileMap:
   - Merged rects → `shape: 'rect'` with merged dimensions, `static: true`, `collision_layer: 1`
   - Polygons → `shape: 'polygon'` with `points` property
   - Circles (from near-square ellipses) → `shape: 'circle'` with `radius`
3. All positions are world-space relative to TileMap origin

## Runtime Integration (`src/persistence/tiled-loader.ts` + `src/engine/physics.ts`)

When a TileMap loads at play-time:

1. During tiled-loader layer processing, call `extractTileCollisions` + `mergeAdjacentRects`
2. Store collision info in `TiledLayerData.tile_collisions`
3. New method `PhysicsWorld.addTileCollisions(tilemap)`:
   - Creates Matter.js bodies directly (rectangle / fromVertices / circle) — no scene nodes
   - All bodies: `isStatic: true`, `collision_layer: 1`
   - Bodies are tracked for cleanup via `PhysicsWorld.removeTileCollisions(tilemap)`
4. TileMap node gets optional `tile_collisions_enabled: true` property to gate behavior
5. Bodies participate in existing collision event system so `on_collision` / `on_area_enter` scripts work

## Physics Changes (`src/engine/physics.ts`)

- Handle `shape: 'polygon'` → create body via `Matter.Bodies.fromVertices()`
- Ellipses where width ≠ height → approximate as polygon
- Matter.js's built-in decomposition handles concave polygons

## Edge Cases

- Tiles with no `objectgroup` or empty `objects` → skip
- Tile GIDs with no matching tileset tile → skip gracefully
- `Bodies.fromVertices()` concave decomposition relies on Matter.js built-in
- All collision shapes are static terrain by default

## Testing (`test/tiled-collision.test.ts`)

1. Extraction — verify rect, polygon, ellipse, mixed objectgroups produce correct `TileCollisionShape` output
2. Merging — verify horizontal run merging, vertical merging, exclusion of non-mergeable shapes
3. World positions — verify grid → world coordinate math with tile and shape offsets
4. Import integration — import a Tiled map with collision tiles, verify CollisionShape children
5. Physics polygon — verify `shape: 'polygon'` creates valid Matter.js body
