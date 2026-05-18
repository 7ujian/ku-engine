import { resolve, dirname } from 'node:path';
import { readFile } from 'node:fs/promises';

export interface AtlasRegion {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AtlasDef {
  texture: string;
  regions: AtlasRegion[];
}

export function parseAtlas(raw: unknown): AtlasDef {
  if (!raw || typeof raw !== 'object') throw new Error('atlas must be an object');
  const data = raw as Record<string, unknown>;
  if (typeof data.texture !== 'string' || !data.texture) throw new Error('atlas.texture must be a non-empty string');
  if (!Array.isArray(data.regions)) throw new Error('atlas.regions must be an array');

  const regions: AtlasRegion[] = data.regions.map((r: unknown, i: number) => {
    if (!r || typeof r !== 'object') throw new Error(`region[${i}] must be an object`);
    const reg = r as Record<string, unknown>;
    if (typeof reg.name !== 'string') throw new Error(`region[${i}].name must be a string`);
    if (typeof reg.x !== 'number') throw new Error(`region[${i}].x must be a number`);
    if (typeof reg.y !== 'number') throw new Error(`region[${i}].y must be a number`);
    if (typeof reg.width !== 'number' || reg.width <= 0) throw new Error(`region[${i}].width must be a positive number`);
    if (typeof reg.height !== 'number' || reg.height <= 0) throw new Error(`region[${i}].height must be a positive number`);
    return { name: reg.name, x: reg.x, y: reg.y, width: reg.width, height: reg.height };
  });

  return { texture: data.texture, regions };
}

export async function loadAtlas(jsonPath: string): Promise<AtlasDef> {
  const content = await readFile(jsonPath, 'utf-8');
  const raw = JSON.parse(content);
  const atlas = parseAtlas(raw);
  // Resolve texture path relative to atlas JSON location
  atlas.texture = resolve(dirname(jsonPath), atlas.texture);
  return atlas;
}

export function regionByName(atlas: AtlasDef, name: string): AtlasRegion | null {
  return atlas.regions.find(r => r.name === name) ?? null;
}
