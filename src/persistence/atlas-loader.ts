import { resolve, dirname } from 'node:path';
import { readFile } from 'node:fs/promises';
import { parseAtlas, type AtlasDef } from '../engine/atlas.js';

export async function loadAtlas(jsonPath: string): Promise<AtlasDef> {
  const content = await readFile(jsonPath, 'utf-8');
  const raw = JSON.parse(content);
  const atlas = parseAtlas(raw);
  // Resolve texture path relative to atlas JSON location
  atlas.texture = resolve(dirname(jsonPath), atlas.texture);
  return atlas;
}
