import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { SceneTree } from '../engine/scene-tree.js';
import { Node } from '../engine/node.js';
import { ScriptEngine } from '../engine/script-engine.js';
import { JsScriptEngine } from '../engine/js-script-engine.js';
import { PhysicsWorld } from '../engine/physics.js';
import { GameLoop } from '../engine/game-loop.js';
import { Renderer } from '../renderer/renderer.js';
import { InputManager } from '../server/input-manager.js';
import { loadScene, sceneFilePath } from '../engine/scene-file.js';

const projectDir = resolve(process.argv[2] ?? '.');

async function main(): Promise<void> {
  const config = JSON.parse(await readFile(resolve(projectDir, 'project.json'), 'utf-8'));
  const entryScene = config.entry ?? 'main';

  const scenePath = sceneFilePath(resolve(projectDir), entryScene);
  const tree = await loadScene(scenePath);

  const scripts = new ScriptEngine(tree);
  scripts.registerTree();

  const jsScripts = new JsScriptEngine({ tree, projectDir });
  await jsScripts.registerTree();

  const physics = new PhysicsWorld(tree);
  physics.syncFromTree();

  const input = new InputManager(scripts, jsScripts);

  const renderer = new Renderer(config.window?.width ?? 640, config.window?.height ?? 480, projectDir, config.debug_physics ?? false);
  renderer.setKeyHandler((key, down) => {
    if (down) input.keyDown(key);
    else input.keyUp(key);
  });
  renderer.setTouchHandler((phase, x, y, pointerId) => {
    if (phase === 'start') input.touchStart(x, y, pointerId);
    else if (phase === 'move') input.touchMove(x, y, pointerId);
    else if (phase === 'end') input.touchEnd(x, y, pointerId);
  });
  await renderer.open(config.name ?? 'ku');

  const loop = new GameLoop(tree, scripts, physics, renderer, 60, true, jsScripts);
  loop.setOnExit(cleanup);
  loop.start();

  async function cleanup(): Promise<void> {
    loop.stop();
    process.exit(0);
  }

  process.on('SIGTERM', cleanup);
  process.on('SIGINT', cleanup);
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
