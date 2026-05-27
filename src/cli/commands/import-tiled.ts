import { resolve, join, basename } from 'node:path';
import { writeFile, mkdir } from 'node:fs/promises';
import { loadTiledMap } from '../../persistence/tiled-loader.js';
import { importTiledMap } from '../../persistence/tiled-importer.js';
import type { SceneFile } from '../../engine/types.js';

export async function importTiledCommand(
	projectDir: string,
	file: string,
	sceneName?: string,
): Promise<void> {
	const mapPath = resolve(projectDir, file);
	const name = sceneName ?? basename(file, '.json');

	console.log(JSON.stringify({ action: 'import-tiled', file: mapPath, name }));

	const tiledMap = await loadTiledMap(mapPath);
	const root = importTiledMap(tiledMap, projectDir);

	const scene: SceneFile = { scene: name, root };
	const scenesDir = join(projectDir, 'scenes');
	await mkdir(scenesDir, { recursive: true });
	const outPath = join(scenesDir, `${name}.json`);
	await writeFile(outPath, JSON.stringify(scene, null, 2) + '\n', 'utf-8');

	console.log(JSON.stringify({ action: 'import-tiled', result: 'ok', output: outPath }));
}
