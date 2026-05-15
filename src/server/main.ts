import { resolve } from 'node:path';
import { loadScene, sceneFilePath } from '../engine/scene-file.js';
import { SceneTree } from '../engine/scene-tree.js';
import { Node } from '../engine/node.js';
import { startInstance } from './instance.js';
import type { InstanceType } from './discovery.js';
import { ScriptEngine } from '../engine/script-engine.js';
import { PhysicsWorld } from '../engine/physics.js';
import { GameLoop } from '../engine/game-loop.js';
import { Renderer } from '../renderer/renderer.js';
import { InputManager } from './input-manager.js';
import { setGameLoop, setInputManager } from './message-handler.js';

const args = process.argv.slice(2);
let mode: InstanceType = 'edit';
let dir = process.cwd();
let port = 0;
let scene: string | undefined;

for (let i = 0; i < args.length; i++) {
  switch (args[i]) {
    case '--mode': mode = args[++i] as InstanceType; break;
    case '--dir': dir = resolve(args[++i]); break;
    case '--port': port = parseInt(args[++i], 10); break;
    case '--scene': scene = args[++i]; break;
  }
}

async function main(): Promise<void> {
  let tree: SceneTree;
  if (scene) {
    tree = await loadScene(sceneFilePath(resolve(dir, 'scenes'), scene));
  } else {
    tree = new SceneTree(new Node('root', 'Node'));
  }

  const instance = await startInstance(mode, tree, dir, port);

  if (mode === 'play') {
    const scripts = new ScriptEngine(tree);
    scripts.registerTree();

    const physics = new PhysicsWorld(tree);
    physics.syncFromTree();

    const input = new InputManager(scripts.getEventBus());
    setInputManager(input);

    const renderer = new Renderer();
    await renderer.open('ku - Flappy Bird');

    const loop = new GameLoop(tree, scripts, physics, renderer, 60, true);
    setGameLoop(loop);
    loop.start();
  }

  const cleanup = async () => {
    setGameLoop(null);
    setInputManager(null);
    await instance.stop();
    process.exit(0);
  };

  process.on('SIGTERM', cleanup);
  process.on('SIGINT', cleanup);
}

main().catch(err => {
  console.error(JSON.stringify({ ok: false, error: err.message }));
  process.exit(1);
});
