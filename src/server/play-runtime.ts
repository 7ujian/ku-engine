import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { SceneTree } from '../engine/scene-tree.js';
import { Node } from '../engine/node.js';
import { Instance } from './instance.js';
import { SyncClient } from './sync-client.js';
import { ScriptEngine } from '../engine/script-engine.js';
import { JsScriptEngine } from '../engine/js-script-engine.js';
import { PhysicsWorld } from '../engine/physics.js';
import { GameLoop } from '../engine/game-loop.js';
import { Renderer } from '../renderer/renderer.js';
import { InputManager } from './input-manager.js';
import { AudioManager } from '../engine/audio.js';
import { loadScene, sceneFilePath, saveSceneSync } from '../persistence/scene-io.js';
import { loadWav } from '../persistence/audio-loader.js';
import { loadScriptSource } from '../persistence/script-loader.js';
import { setGameLoop, setInputManager, setSaveRuntimeState } from './message-handler.js';
import type { InstanceType } from './discovery.js';

export interface PlayConfig {
  dir: string;
  port: number;
  syncFrom?: number;
  hotReload?: boolean;
  loadScene?: string;
}

export class PlayRuntime {
  tree: SceneTree;
  instance: Instance;
  dir: string;

  syncClient: SyncClient | null = null;
  scripts: ScriptEngine;
  jsScripts: JsScriptEngine;
  physics: PhysicsWorld;
  input: InputManager;
  renderer: Renderer;
  audio: AudioManager;
  loop: GameLoop;

  private constructor(
    tree: SceneTree,
    instance: Instance,
    dir: string,
    scripts: ScriptEngine,
    jsScripts: JsScriptEngine,
    physics: PhysicsWorld,
    input: InputManager,
    renderer: Renderer,
    audio: AudioManager,
    loop: GameLoop,
  ) {
    this.tree = tree;
    this.instance = instance;
    this.dir = dir;
    this.scripts = scripts;
    this.jsScripts = jsScripts;
    this.physics = physics;
    this.input = input;
    this.renderer = renderer;
    this.audio = audio;
    this.loop = loop;
  }

  static async create(config: PlayConfig): Promise<PlayRuntime> {
    const dir = config.dir;

    let tree: SceneTree;
    const projectConfig = JSON.parse(await readFile(resolve(dir, 'project.json'), 'utf-8'));

    // PREVIEW mode: sync from editor
    if (config.syncFrom && config.syncFrom > 0) {
      tree = new SceneTree(new Node('root', 'Node'));
    }
    // RELEASE mode: load named scene
    else if (config.loadScene) {
      const path = sceneFilePath(resolve(dir, 'scenes'), config.loadScene);
      tree = await loadScene(path);
    }
    // RELEASE mode: load entry scene from project.json
    else {
      const entryScene = projectConfig.entry ?? 'main';
      const path = sceneFilePath(resolve(dir, 'scenes'), entryScene);
      tree = await loadScene(path);
    }

    const instance = new Instance('play' as InstanceType, tree, dir, config.port);

    const scripts = new ScriptEngine(tree);
    scripts.registerTree();

    const jsScripts = new JsScriptEngine({ tree, projectDir: dir, loadSource: (path) => loadScriptSource(dir, path) });
    await jsScripts.registerTree();

    const physics = new PhysicsWorld(tree);
    physics.syncFromTree();

    const input = new InputManager(scripts, jsScripts);
    setInputManager(input);

    const cfg = projectConfig as Record<string, unknown>;
    const renderer = new Renderer(
      (cfg.window as any)?.width ?? 640,
      (cfg.window as any)?.height ?? 480,
      dir,
      (cfg.debug_physics as boolean) ?? false,
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

    const audio = new AudioManager(dir, loadWav);
    const sceneLoader = async (name: string) => loadScene(sceneFilePath(resolve(dir, 'scenes'), name));
    const loop = new GameLoop(tree, scripts, physics, renderer, 60, true, jsScripts, audio, sceneLoader);

    setGameLoop(loop);
    setSaveRuntimeState(async (name: string) => {
      saveSceneSync(loop.getTree(), sceneFilePath(resolve(dir, 'scenes'), name), name);
    });

    const rt = new PlayRuntime(tree, instance, dir, scripts, jsScripts, physics, input, renderer, audio, loop);

    // Wire syncClient for delta application (preview mode)
    if (config.syncFrom && config.syncFrom > 0) {
      rt.syncClient = new SyncClient(tree, config.syncFrom, config.hotReload ?? false);
      rt.syncClient.scripts = scripts;
      rt.syncClient.jsScripts = jsScripts;
      rt.syncClient.physics = physics;
    }

    return rt;
  }

  async start(): Promise<void> {
    await this.instance.start();

    if (this.syncClient) {
      await this.syncClient.connect();
    }

    this.loop.start();
  }

  async stop(): Promise<void> {
    setGameLoop(null);
    setInputManager(null);
    if (this.syncClient) this.syncClient.disconnect();
    await this.instance.stop();
  }
}
