import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cpSync, mkdirSync, writeFileSync, existsSync, chmodSync as fsChmodSync } from 'node:fs';
import { discoverAssets } from '../asset-discovery.js';

// ku repo root: this file is at dist/cli/commands/build.js → 3 levels up
const __filename = fileURLToPath(import.meta.url);
const engineRoot = resolve(dirname(__filename), '..', '..', '..');

export async function buildCommand(projectDir: string, outputDir: string): Promise<void> {
  const absOutput = resolve(outputDir);
  const projectJsonPath = resolve(projectDir, 'project.json');

  if (!existsSync(projectJsonPath)) {
    throw new Error(`project.json not found in ${projectDir}`);
  }

  // 1. Discover assets
  const assets = await discoverAssets(projectDir);

  // 2. Create output structure
  const runtimeDir = resolve(absOutput, 'runtime');
  const gameDir = resolve(absOutput, 'game');

  // Clean and create dirs
  mkdirSync(resolve(runtimeDir, 'dist'), { recursive: true });
  mkdirSync(resolve(runtimeDir, 'node_modules'), { recursive: true });
  mkdirSync(gameDir, { recursive: true });

  // 3. Copy compiled runtime (dist/)
  const distDir = resolve(engineRoot, 'dist');
  if (existsSync(distDir)) {
    for (const subdir of ['engine', 'renderer', 'player', 'server']) {
      const src = resolve(distDir, subdir);
      const dst = resolve(runtimeDir, 'dist', subdir);
      if (existsSync(src)) {
        cpSync(src, dst, { recursive: true });
      }
    }
  }

  // 4. Copy production node_modules
  const nodeModulesDir = resolve(engineRoot, 'node_modules');
  const prodDeps = ['@kmamal/sdl', '@napi-rs/canvas', 'matter-js', 'ws'];
  for (const dep of prodDeps) {
    const src = resolve(nodeModulesDir, dep);
    const dst = resolve(runtimeDir, 'node_modules', dep);
    if (existsSync(src)) {
      cpSync(src, dst, { recursive: true });
    }
  }

  // 5. Copy game assets
  const dirsToCopy = ['scenes', 'assets', 'scripts'];
  for (const dir of dirsToCopy) {
    const src = resolve(projectDir, dir);
    const dst = resolve(gameDir, dir);
    if (existsSync(src)) {
      cpSync(src, dst, { recursive: true });
    }
  }

  // Copy project.json
  cpSync(projectJsonPath, resolve(gameDir, 'project.json'));

  // 6. Generate runtime package.json
  writeFileSync(resolve(runtimeDir, 'package.json'), JSON.stringify({
    name: 'ku-player',
    version: '1.0.0',
    type: 'module',
  }, null, 2) + '\n');

  // 7. Generate launcher scripts
  writeFileSync(resolve(absOutput, 'run.sh'), `#!/bin/bash
DIR="$(cd "$(dirname "$0")" && pwd)"
node "$DIR/runtime/dist/player/main.js" "$DIR/game" "$@"
`);
  chmodSync(resolve(absOutput, 'run.sh'), 0o755);

  writeFileSync(resolve(absOutput, 'run.bat'), `@echo off
set DIR=%~dp0
node "%DIR%runtime\\dist\\player\\main.js" "%DIR%game" %*
`);

  // 8. Print summary
  const assetCount = assets.textures.length + assets.atlases.length +
    assets.scripts.length + assets.tilesets.length + assets.audio.length;

  console.log(JSON.stringify({
    ok: true,
    output: absOutput,
    scenes: assets.scenes.length,
    assets: assetCount,
    message: `Build complete: ${assetCount} assets, ${assets.scenes.length} scenes`,
  }));
}

function chmodSync(path: string, mode: number): void {
  try {
    fsChmodSync(path, mode);
  } catch {
    // Windows: ignore
  }
}
