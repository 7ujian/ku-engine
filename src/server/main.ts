import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { SceneTree } from '../engine/scene-tree.js';
import { Node } from '../engine/node.js';
import { startInstance } from './instance.js';
import type { InstanceType } from './discovery.js';
import { ScriptEngine } from '../engine/script-engine.js';
import { JsScriptEngine } from '../engine/js-script-engine.js';
import { PhysicsWorld } from '../engine/physics.js';
import { GameLoop } from '../engine/game-loop.js';
import { Renderer } from '../renderer/renderer.js';
import { InputManager } from './input-manager.js';
import { SyncClient } from './sync-client.js';
import { setGameLoop, setInputManager } from './message-handler.js';
import { loadScene, sceneFilePath } from '../engine/scene-file.js';

const args = process.argv.slice(2);
let mode: InstanceType = 'edit';
let dir = process.cwd();
let port = 0;
let syncFrom = 0;
let hotReload = false;
let scene = '';

for (let i = 0; i < args.length; i++) {
  switch (args[i]) {
    case '--mode': mode = args[++i] as InstanceType; break;
    case '--dir': dir = resolve(args[++i]); break;
    case '--port': port = parseInt(args[++i], 10); break;
    case '--sync-from': syncFrom = parseInt(args[++i], 10); break;
    case '--hot-reload': hotReload = true; break;
    case '--scene': scene = args[++i]; break;
  }
}

async function main(): Promise<void> {
  let tree: SceneTree;

  // Load scene from disk if --scene is provided (editor mode)
  if (scene && mode === 'edit') {
    const path = sceneFilePath(resolve(dir, 'scenes'), scene);
    tree = await loadScene(path);
  } else {
    tree = new SceneTree(new Node('root', 'Node'));
  }

  const instance = await startInstance(mode, tree, dir, port);

  let syncClient: SyncClient | null = null;
  let loop: GameLoop | null = null;

  if (mode === 'play') {
    // Sync from editor if --sync-from is provided
    if (syncFrom > 0) {
      syncClient = new SyncClient(tree, syncFrom, hotReload);
      await syncClient.connect();
    }

    const scripts = new ScriptEngine(tree);
    scripts.registerTree();

    const jsScripts = new JsScriptEngine({ tree, projectDir: dir });
    await jsScripts.registerTree();

    const physics = new PhysicsWorld(tree);
    physics.syncFromTree();

    const input = new InputManager(scripts, jsScripts);
    setInputManager(input);

    const projectConfig = JSON.parse(await readFile(resolve(dir, 'project.json'), 'utf-8'));
    const renderer = new Renderer(
      projectConfig.window?.width ?? 640,
      projectConfig.window?.height ?? 480,
      dir,
      projectConfig.debug_physics ?? false,
    );
    renderer.setKeyHandler((key, down) => {
      if (down) input.keyDown(key);
      else input.keyUp(key);
    });
    renderer.setTouchHandler((phase, x, y, pointerId) => {
      if (phase === 'start') input.touchStart(x, y, pointerId);
      else if (phase === 'move') input.touchMove(x, y, pointerId);
      else if (phase === 'end') input.touchEnd(x, y, pointerId);
    });
    await renderer.open('ku');

    // Wire syncClient to scripts/physics for delta application
    if (syncClient) {
      syncClient.scripts = scripts;
      syncClient.jsScripts = jsScripts;
      syncClient.physics = physics;
    }

    loop = new GameLoop(tree, scripts, physics, renderer, 60, true, jsScripts);
    setGameLoop(loop);
    loop.start();
  }

  const cleanup = async () => {
    setGameLoop(null);
    setInputManager(null);
    if (syncClient) syncClient.disconnect();
    await instance.stop();
    process.exit(0);
  };

  if (loop) loop.setOnExit(cleanup);

  process.on('SIGTERM', cleanup);
  process.on('SIGINT', cleanup);
}

main().catch(err => {
  console.error(JSON.stringify({ ok: false, error: err.message }));
  process.exit(1);
});
