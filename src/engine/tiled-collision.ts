import type { TileCollisionShape, TileCollisionMap, MergedCollision } from './types.js';
import type { TiledTileDef } from '../persistence/tiled-types.js';
import { GID_MASK } from '../persistence/tiled-types.js';

/** Internal type for pre-conversion shapes (ellipse not yet converted to circle/polygon) */
type PreMergeCollision = Omit<MergedCollision, 'type'> & { type: 'rect' | 'polygon' | 'ellipse' };

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

function isFullTileRect(shape: TileCollisionShape, tilewidth: number, tileheight: number): boolean {
  return shape.type === 'rect' && shape.x === 0 && shape.y === 0 &&
    shape.width === tilewidth && shape.height === tileheight;
}

export function mergeAdjacentRects(
  data: number[],
  width: number,
  height: number,
  collisions: TileCollisionMap,
  firstgid: number,
  tilewidth: number,
  tileheight: number,
): PreMergeCollision[] {
  if (!collisions || Object.keys(collisions).length === 0) return [];

  const mergeable = new Uint8Array(data.length);
  const nonMergeable: Array<{ col: number; row: number; shapes: TileCollisionShape[] }> = [];

  for (let i = 0; i < data.length; i++) {
    const gid = data[i] & GID_MASK;
    if (gid === 0) continue;
    const localId = gid - firstgid;
    const shapes = collisions[localId];
    if (!shapes) continue;

    if (shapes.length === 1 && isFullTileRect(shapes[0], tilewidth, tileheight)) {
      mergeable[i] = 1;
    } else {
      const col = i % width;
      const row = Math.floor(i / width);
      nonMergeable.push({ col, row, shapes });
    }
  }

  const results: PreMergeCollision[] = [];

  const visited = new Uint8Array(data.length);
  for (let row = 0; row < height; row++) {
    let col = 0;
    while (col < width) {
      const idx = row * width + col;
      if (!mergeable[idx] || visited[idx]) {
        col++;
        continue;
      }
      let runEnd = col + 1;
      while (runEnd < width && mergeable[row * width + runEnd]) {
        runEnd++;
      }
      for (let c = col; c < runEnd; c++) {
        visited[row * width + c] = 1;
      }
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
  return raw.map((c): MergedCollision => {
    if (c.type === 'ellipse') {
      const w = c.width ?? 0;
      const h = c.height ?? 0;
      if (Math.abs(w - h) < Math.max(w, h) * 0.1) {
        const r = Math.min(w, h) / 2;
        return {
          type: 'circle' as const,
          x: (c.x ?? 0) + w / 2,
          y: (c.y ?? 0) + h / 2,
          radius: r,
        };
      }
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
    return c as MergedCollision;
  });
}
