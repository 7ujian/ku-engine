import type { TilesetDef, TilesetTileDef, TilesetRegion } from './types.js';

export interface TerrainDef {
  atlas: string;
  mode: '3x3' | 'fill';
  prefix?: string;
  compatible?: number[];
}

/** Resolved cell with embedded rect — no region name lookup needed at render time */
export interface ResolvedCell {
  texturePath: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Legacy resolved cell for terrain_map path (uses atlas + region name) */
export interface LegacyResolvedCell {
  atlasPath: string;
  regionName: string;
}

// Legacy 4-bit cardinal bitmask → suffix (kept for terrain_map legacy path)
export const BITMASK_TO_SUFFIX: string[] = [
  'top_left',       // 0000: isolated
  'center_left',    // 0001: only R same
  'center_right',   // 0010: only L same
  'center',         // 0011: L+R same
  'bottom_mid',     // 0100: only U same
  'bottom_left',    // 0101: U+R same
  'bottom_right',   // 0110: U+L same
  'bottom_mid',     // 0111: U+L+R same
  'top_mid',        // 1000: only D same
  'top_left',       // 1001: D+R same
  'top_right',      // 1010: D+L same
  'top_mid',        // 1011: D+L+R same
  'center',         // 1100: U+D same
  'center_left',    // 1101: U+D+R same
  'center_right',   // 1110: U+D+L same
  'center',         // 1111: all neighbors same
];

// ABCD quadrant corner → suffix (kept for transition overlay fallback)
export const ABCD_TO_SUFFIX: string[] = [
  '',                    // 0000: pure surround — skip
  'top_left',            // 0001: D only
  'top_right',           // 0010: C only
  'top_mid',             // 0011: C+D
  'bottom_left',         // 0100: B only
  'center_left',         // 0101: B+D
  'center',              // 0110: B+C diagonal
  'pond_bottom_right',   // 0111: B+C+D
  'bottom_right',        // 1000: A only
  'center',              // 1001: A+D diagonal
  'center_right',        // 1010: A+C
  'pond_bottom_left',    // 1011: A+C+D
  'bottom_mid',          // 1100: A+B
  'pond_top_right',      // 1101: A+B+D
  'pond_top_left',       // 1110: A+B+C
  'center',              // 1111: all quadrants
];

/** Compute 4-bit ABCD code for a cell from a binary grid */
export function computeAbcd(
  binaryGrid: Uint8Array,
  columns: number,
  rows: number,
  row: number,
  col: number,
): number {
  const get = (r: number, c: number): number =>
    (r >= 0 && r < rows && c >= 0 && c < columns) ? binaryGrid[r * columns + c] : 0;
  const center = get(row, col);
  const A = center | get(row - 1, col) | get(row, col - 1) | get(row - 1, col - 1);
  const B = center | get(row - 1, col) | get(row, col + 1) | get(row - 1, col + 1);
  const C = center | get(row + 1, col) | get(row, col - 1) | get(row + 1, col - 1);
  const D = center | get(row + 1, col) | get(row, col + 1) | get(row + 1, col + 1);
  return (A << 3) | (B << 2) | (C << 1) | D;
}

/** ABCD without self-contribution — for detecting inner boundary of 3x3 tiles */
export function computeAbcdNeighborOnly(
  binaryGrid: Uint8Array,
  columns: number,
  rows: number,
  row: number,
  col: number,
  outOfBounds = 0,
): number {
  const get = (r: number, c: number): number =>
    (r >= 0 && r < rows && c >= 0 && c < columns) ? binaryGrid[r * columns + c] : outOfBounds;
  const A = get(row - 1, col) | get(row, col - 1) | get(row - 1, col - 1);
  const B = get(row - 1, col) | get(row, col + 1) | get(row - 1, col + 1);
  const C = get(row + 1, col) | get(row, col - 1) | get(row + 1, col - 1);
  const D = get(row + 1, col) | get(row, col + 1) | get(row + 1, col + 1);
  return (A << 3) | (B << 2) | (C << 1) | D;
}

export function parseTerrainMap(raw: unknown): Map<number, TerrainDef> {
  const map = new Map<number, TerrainDef>();
  if (!raw || typeof raw !== 'object') return map;
  const data = raw as Record<string, unknown>;
  for (const [key, val] of Object.entries(data)) {
    const id = parseInt(key, 10);
    if (isNaN(id) || id === 0) continue;
    if (!val || typeof val !== 'object') continue;
    const entry = val as Record<string, unknown>;
    const atlas = typeof entry.atlas === 'string' ? entry.atlas : '';
    const mode = entry.mode === 'fill' ? 'fill' : '3x3';
    if (!atlas) continue;
    map.set(id, {
      atlas,
      mode,
      prefix: typeof entry.prefix === 'string' ? entry.prefix : undefined,
      compatible: Array.isArray(entry.compatible) ? entry.compatible as number[] : undefined,
    });
  }
  return map;
}

/** Legacy autotile resolver for terrain_map nodes */
export function resolveAutotile(
  data: number[],
  columns: number,
  rows: number,
  terrainMap: Map<number, TerrainDef>,
  prefixes: Map<number, string>,
): (LegacyResolvedCell | null)[] {
  const result: (LegacyResolvedCell | null)[] = new Array(data.length).fill(null);

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < columns; col++) {
      const idx = row * columns + col;
      const terrainId = data[idx];
      if (terrainId === 0) continue;

      const def = terrainMap.get(terrainId);
      if (!def) continue;

      const prefix = prefixes.get(terrainId);
      if (!prefix) continue;

      if (def.mode === 'fill') {
        result[idx] = { atlasPath: def.atlas, regionName: prefix };
        continue;
      }

      const compat = new Set(def.compatible);
      compat.add(terrainId);
      const isSame = (neighborId: number) => compat.has(neighborId);

      const up = row > 0 && isSame(data[(row - 1) * columns + col]) ? 1 : 0;
      const down = row < rows - 1 && isSame(data[(row + 1) * columns + col]) ? 1 : 0;
      const left = col > 0 && isSame(data[row * columns + (col - 1)]) ? 1 : 0;
      const right = col < columns - 1 && isSame(data[row * columns + (col + 1)]) ? 1 : 0;

      const mask = right + left * 2 + up * 4 + down * 8;
      const suffix = BITMASK_TO_SUFFIX[mask];
      result[idx] = { atlasPath: def.atlas, regionName: `${prefix}_${suffix}` };
    }
  }

  return result;
}

export interface ResolvedGrid {
  base: (ResolvedCell | null)[];
  overlays: (ResolvedCell | null)[];
}

/** Build region name→TilesetRegion lookup map */
function buildRegionMap(regions: TilesetRegion[]): Map<string, TilesetRegion> {
  const map = new Map<string, TilesetRegion>();
  for (const r of regions) {
    map.set(r.name, r);
  }
  return map;
}

/** Resolve rect from region name, or return null */
function resolveRect(
  regionMap: Map<string, TilesetRegion>,
  texturePath: string,
  regionName: string,
): ResolvedCell | null {
  const r = regionMap.get(regionName);
  if (!r) return null;
  return { texturePath, x: r.x, y: r.y, w: r.w, h: r.h };
}

/** Resolve tileset grid using ABCD quadrant corner system with data-driven masks */
export function resolveTilesetGrid(
  data: number[],
  columns: number,
  rows: number,
  tilesetDef: TilesetDef,
): ResolvedGrid {
  const size = data.length;
  const base: (ResolvedCell | null)[] = new Array(size).fill(null);
  const overlays: (ResolvedCell | null)[] = new Array(size).fill(null);
  const { tiles, transitions } = tilesetDef;
  const transMap = transitions ?? {};

  // Step 1: Assign base layer
  for (let i = 0; i < size; i++) {
    const value = data[i];
    if (value === 0) continue;

    const tileIdx = value - 1;
    if (tileIdx < 0 || tileIdx >= tiles.length) continue;
    const tile = tiles[tileIdx];
    const texturePath = tile.texture ?? tile.atlas ?? '';
    if (!texturePath) continue;

    const regionMap = tile.regions ? buildRegionMap(tile.regions) : new Map<string, TilesetRegion>();

    // Static tile: direct region lookup
    if (!tile.mode || tile.mode === 'static') {
      const staticName = tile.region ?? tile.regions?.[0]?.name;
      if (staticName) {
        base[i] = resolveRect(regionMap, texturePath, staticName);
      }
      continue;
    }

    // Fill mode: single region (first region or region named in masks[15])
    if (tile.mode === 'fill') {
      const fillName = tile.masks?.[15] ?? tile.region ?? tile.regions?.[0]?.name;
      if (fillName) {
        base[i] = resolveRect(regionMap, texturePath, fillName);
      }
      continue;
    }

    // 3x3 autotile: placeholder center (updated in step 2)
    const centerName = tile.masks?.[15];
    if (centerName) {
      base[i] = resolveRect(regionMap, texturePath, centerName);
    }
  }

  // Step 2: Process each 3x3 tile type (inward variants + outward overlays)
  for (let tileIdx = 0; tileIdx < tiles.length; tileIdx++) {
    const tile = tiles[tileIdx];
    if (tile.mode !== '3x3') continue;

    const tileValue = tileIdx + 1;
    const masks = tile.masks;
    if (!masks || Object.keys(masks).length === 0) continue;

    const texturePath = tile.texture ?? tile.atlas ?? '';
    if (!texturePath) continue;

    const regionMap = tile.regions ? buildRegionMap(tile.regions) : new Map<string, TilesetRegion>();
    const compat = new Set(tile.compatible ?? []);
    compat.add(tileValue);
    const surround = tile.surround;

    // Build binary grid for this terrain type (for outward overlay)
    const binary = new Uint8Array(size);
    for (let i = 0; i < size; i++) {
      binary[i] = compat.has(data[i]) ? 1 : 0;
    }

    // Build inward binary: surround/empty treated as same (for inward variant)
    const inwardBinary = new Uint8Array(size);
    for (let i = 0; i < size; i++) {
      const v = data[i];
      inwardBinary[i] = (compat.has(v) || v === surround || v === 0) ? 1 : 0;
    }

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < columns; col++) {
        const i = row * columns + col;
        const isOwnTile = data[i] === tileValue;

        if (isOwnTile) {
          // Inward: 3x3 cell at inner boundary gets edge/corner variant
          const abcd = computeAbcdNeighborOnly(inwardBinary, columns, rows, row, col, 1);
          if (abcd < 15) {
            const regionName = masks[abcd] ?? masks[15];
            if (regionName) {
              base[i] = resolveRect(regionMap, texturePath, regionName);
            }
          }
        } else {
          // Outward: only overlay surround cells
          if (surround !== undefined && data[i] !== surround && data[i] !== 0) continue;

          const abcd = computeAbcd(binary, columns, rows, row, col);
          if (abcd === 0) continue;

          const regionName = masks[abcd];
          if (!regionName) continue;

          const overlay = resolveOverlay(
            tile, tileValue, texturePath, regionMap, regionName, abcd,
            data, columns, rows, row, col, transMap,
          );
          if (overlay) {
            overlays[i] = overlay;
          }
        }
      }
    }
  }

  return { base, overlays };
}

function resolveOverlay(
  tile: TilesetTileDef,
  tileValue: number,
  texturePath: string,
  regionMap: Map<string, TilesetRegion>,
  regionName: string,
  abcd: number,
  data: number[],
  columns: number,
  rows: number,
  row: number,
  col: number,
  transMap: Record<string, { atlas?: string; prefix?: string; texture?: string; regions?: TilesetRegion[]; mode: string }>,
): ResolvedCell | null {
  const surround = tile.surround;

  // Check cardinal neighbors for non-surround, non-compatible tiles
  const neighborValues = new Set<number>();
  const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  for (const [dr, dc] of dirs) {
    const nr = row + dr;
    const nc = col + dc;
    if (nr < 0 || nr >= rows || nc < 0 || nc >= columns) continue;
    const nv = data[nr * columns + nc];
    if (nv === 0 || nv === tileValue) continue;
    if (tile.compatible?.includes(nv)) continue;
    if (surround !== undefined && nv === surround) continue;
    neighborValues.add(nv);
  }

  // Single dominant neighbor → use transition if defined
  if (neighborValues.size === 1) {
    const neighborVal = [...neighborValues][0];
    const key = `${tileValue}_${neighborVal}`;
    const trans = transMap[key];
    if (trans) {
      const transTexture = trans.texture ?? trans.atlas ?? '';
      const transPrefix = trans.prefix ?? '';
      const transSuffix = ABCD_TO_SUFFIX[abcd] ?? '';
      if (transTexture && transPrefix && transSuffix) {
        const transRegionName = `${transPrefix}_${transSuffix}`;
        if (trans.regions) {
          const transRegionMap = buildRegionMap(trans.regions);
          const r = resolveRect(transRegionMap, transTexture, transRegionName);
          if (r) return r;
        }
      }
    }
  }

  return resolveRect(regionMap, texturePath, regionName);
}
