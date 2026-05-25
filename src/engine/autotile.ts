import type { TilesetDef, TilesetTileDef } from './types.js';

export interface TerrainDef {
  atlas: string;
  mode: '3x3' | 'fill';
  prefix?: string;
  compatible?: number[];
}

export interface ResolvedCell {
  atlasPath: string;
  regionName: string;
}

// 4-bit bitmask → suffix from the 3×3 autotile grid
// mask = Right + Left*2 + Up*4 + Down*8
// bit=1 means same terrain neighbor (no border on that side)
// tile name describes where the border IS, not where same terrain is
export const BITMASK_TO_SUFFIX: string[] = [
  'top_left',       // 0000: isolated (no same neighbors)
  'center_left',    // 0001: only R same → border on L
  'center_right',   // 0010: only L same → border on R
  'center',         // 0011: L+R same → horizontal strip
  'bottom_mid',     // 0100: only U same → border on D
  'bottom_left',    // 0101: U+R same → border on D,L
  'bottom_right',   // 0110: U+L same → border on D,R
  'bottom_mid',     // 0111: U+L+R same → border on D
  'top_mid',        // 1000: only D same → border on U
  'top_left',       // 1001: D+R same → border on U,L
  'top_right',      // 1010: D+L same → border on U,R
  'top_mid',        // 1011: D+L+R same → border on U
  'center',         // 1100: U+D same → vertical strip
  'center_left',    // 1101: U+D+R same → border on L
  'center_right',   // 1110: U+D+L same → border on R
  'center',         // 1111: all neighbors same
];

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

export function detectPrefix(regionNames: string[]): string | null {
  const suffixes = ['top_left', 'top_mid', 'top_right', 'center_left', 'center', 'center_right', 'bottom_left', 'bottom_mid', 'bottom_right'];
  for (const name of regionNames) {
    for (const suffix of suffixes) {
      if (name.endsWith('_' + suffix)) {
        return name.slice(0, name.length - suffix.length - 1);
      }
    }
  }
  return null;
}

export function resolveAutotile(
  data: number[],
  columns: number,
  rows: number,
  terrainMap: Map<number, TerrainDef>,
  prefixes: Map<number, string>,
): (ResolvedCell | null)[] {
  const result: (ResolvedCell | null)[] = new Array(data.length).fill(null);

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

      // 4-bit neighbor mask — compatible terrains count as "same"
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

export function resolveTilesetGrid(
  data: number[],
  columns: number,
  rows: number,
  tilesetDef: TilesetDef,
  prefixes: Map<number, string>,
): (ResolvedCell | null)[] {
  const result: (ResolvedCell | null)[] = new Array(data.length).fill(null);
  const { tiles, transitions } = tilesetDef;
  const transMap = transitions ?? {};

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < columns; col++) {
      const idx = row * columns + col;
      const value = data[idx];
      if (value === 0) continue;

      // 1-based index into tiles[]
      const tileIdx = value - 1;
      if (tileIdx < 0 || tileIdx >= tiles.length) continue;
      const tile = tiles[tileIdx];

      // Static tile: direct region lookup
      if (!tile.mode) {
        if (tile.region) {
          result[idx] = { atlasPath: tile.atlas, regionName: tile.region };
        }
        continue;
      }

      // Fill mode: single region
      if (tile.mode === 'fill') {
        const prefix = prefixes.get(value) ?? tile.prefix ?? tile.region;
        if (prefix) {
          result[idx] = { atlasPath: tile.atlas, regionName: prefix };
        }
        continue;
      }

      // 3x3 autotile
      const prefix = prefixes.get(value) ?? tile.prefix;
      if (!prefix) continue;

      const compat = new Set(tile.compatible ?? []);
      compat.add(value);

      // Check for transitions: find dominant non-compatible neighbor
      // surround = tile ID that this atlas's edge art blends to.
      // If neighbor IS the surround, default atlas is correct (no transition needed).
      // If neighbor is something else, look for an explicit transition.
      const surround = tile.surround;
      let dominantNeighbor: number | null = null;
      let useTransition: { atlas: string; prefix: string } | null = null;

      const directions: Array<() => number> = [
        () => row > 0 ? data[(row - 1) * columns + col] : 0,           // up
        () => row < rows - 1 ? data[(row + 1) * columns + col] : 0,    // down
        () => col > 0 ? data[row * columns + (col - 1)] : 0,           // left
        () => col < columns - 1 ? data[row * columns + (col + 1)] : 0, // right
      ];

      for (const getNeighbor of directions) {
        const neighborVal = getNeighbor();
        if (neighborVal === 0 || compat.has(neighborVal)) continue;
        // Default atlas already handles surround correctly
        if (surround !== undefined && neighborVal === surround) continue;

        const transitionKey = `${value}_${neighborVal}`;
        const trans = transMap[transitionKey];
        if (trans) {
          if (dominantNeighbor === null) {
            dominantNeighbor = neighborVal;
            useTransition = trans;
          } else if (dominantNeighbor !== neighborVal) {
            // Multiple different neighbor terrains — fall back
            useTransition = null;
            break;
          }
        }
      }

      // Compute bitmask
      const isSame = (n: number) => compat.has(n);
      const up = row > 0 && isSame(data[(row - 1) * columns + col]) ? 1 : 0;
      const down = row < rows - 1 && isSame(data[(row + 1) * columns + col]) ? 1 : 0;
      const left = col > 0 && isSame(data[row * columns + (col - 1)]) ? 1 : 0;
      const right = col < columns - 1 && isSame(data[row * columns + (col + 1)]) ? 1 : 0;

      const mask = right + left * 2 + up * 4 + down * 8;
      const suffix = BITMASK_TO_SUFFIX[mask];

      if (useTransition) {
        result[idx] = { atlasPath: useTransition.atlas, regionName: `${useTransition.prefix}_${suffix}` };
      } else {
        result[idx] = { atlasPath: tile.atlas, regionName: `${prefix}_${suffix}` };
      }
    }
  }

  return result;
}
