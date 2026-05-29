import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { SceneTree } from '../engine/scene-tree.js';
import { Node } from '../engine/node.js';
import { createNodeByType } from '../engine/node-types.js';
import { Instance } from './instance.js';
import { SyncClient } from './sync-client.js';
import { ScriptEngine } from '../engine/script-engine.js';
import { JsScriptEngine } from '../engine/js-script-engine.js';
import { PhysicsWorld } from '../engine/physics.js';
import { GameLoop } from '../engine/game-loop.js';
import { Renderer, migrateWindowConfig, type WindowConfig } from '../renderer/renderer.js';
import { InputManager } from './input-manager.js';
import { hitTest } from '../engine/hit-test.js';
import { findCamera } from '../renderer/camera.js';
import { AudioManager } from '../engine/audio.js';
import { loadScene, sceneFilePath, saveSceneSync } from '../persistence/scene-io.js';
import { invalidateTiledCache } from '../persistence/tiled-cache.js';
import { loadWav } from '../persistence/audio-loader.js';
import { loadScriptSource } from '../persistence/script-loader.js';
import { setGameLoop, setInputManager, setSaveRuntimeState, setSceneName } from './message-handler.js';
import type { InstanceType } from './discovery.js';

export interface PlayConfig {
  dir: string;
  port: number;
  name?: string;
  syncFrom?: number;
  hotReload?: boolean;
  loadScene?: string;
  watch?: boolean;
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
  private watcher: import('node:fs').FSWatcher | null = null;
  private tiledWatcher: import('node:fs').FSWatcher | null = null;
  private watchSceneName = '';
  private sceneLoader: ((name: string) => Promise<SceneTree>) | null = null;
  private doWatch = false;

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
    const raw = (projectConfig.entry as string) ?? 'main';
    const entryScene = raw.replace(/^scenes\/|\.json$/g, '');

    // Load plugins before engine subsystems
    const { pluginRegistry } = await import('../engine/plugin-registry.js');
    await pluginRegistry.loadFromDir(dir, 'play');

    // PREVIEW mode: sync from editor
    if (config.syncFrom && config.syncFrom > 0) {
      tree = new SceneTree(new Node('root', 'Node'));
    }
    // RELEASE mode: load named scene
    else if (config.loadScene) {
      const path = sceneFilePath(resolve(dir, 'scenes'), config.loadScene);
      tree = await loadScene(path, dir);
    }
    // RELEASE mode: load entry scene from project.json
    else {
      const path = sceneFilePath(resolve(dir, 'scenes'), entryScene);
      tree = await loadScene(path, dir);
    }

    const instance = new Instance(config.name ?? 'play1', tree, dir, config.port);
    instance.sceneName = config.loadScene ?? entryScene;

    const scripts = new ScriptEngine(tree);
    scripts.registerTree();

    const jsScripts = new JsScriptEngine({ tree, projectDir: dir, loadSource: (path) => loadScriptSource(dir, path) });
    await jsScripts.registerTree();

    const physics = new PhysicsWorld(tree);
    physics.syncFromTree();

    const input = new InputManager(scripts, jsScripts);
    setInputManager(input);

    // Wire hit testing for GUI click events
    input.setHitTestFn((screenX: number, screenY: number) => {
      const cam = findCamera(tree, { node: null, cam: { x: 0, y: 0, zoom: 1 } });
      return hitTest(tree, screenX, screenY, renderer.getWidth(), renderer.getHeight(), cam);
    });

    const cfg = projectConfig as Record<string, unknown>;
    const win = (cfg.window ?? {}) as Record<string, unknown>;
    const windowConfig = migrateWindowConfig(win);
    const renderer = new Renderer(
      windowConfig,
      dir,
      (cfg.debug_physics as boolean) ?? false,
    );
    renderer.setKeyHandler((key, down) => {
      if (down) {
        input.keyDown(key);
        // F1 toggles ProfilerGui visibility
        if (key === 'F1') {
          try {
            const gui = tree.get('/profiler_gui');
            const vis = gui.getProperty('visible');
            gui.setProperty('visible', !vis);
          } catch { /* no-op */ }
        }
      } else {
        input.keyUp(key);
      }
    });
    renderer.setTouchHandler((phase, x, y, pointerId) => {
      if (phase === 'start') input.touchStart(x, y, pointerId);
      else if (phase === 'move') input.touchMove(x, y, pointerId);
      else if (phase === 'end') input.touchEnd(x, y, pointerId);
    });
    await renderer.open('ku');

    const audio = new AudioManager(dir, loadWav);
    const sceneLoader = async (name: string) => loadScene(sceneFilePath(resolve(dir, 'scenes'), name), dir);
    const loop = new GameLoop(tree, scripts, physics, renderer, 60, true, jsScripts, audio, sceneLoader);
    // Profiler node always exists as feature interface
    const profilingEnabled = (cfg.profiling as boolean) ?? false;
    if (profilingEnabled) {
      physics.setProfiler(loop.profiler);
    }
    const profilerNode = createNodeByType('Profiler', 'profiler', { enabled: profilingEnabled });
    tree.root.addChild(profilerNode);
    loop.profiler.setTargetNode(profilerNode);

    // ProfilerGui overlay (F1 to toggle)
    const profilerGuiNode = createNodeByType('ProfilerGui', 'profiler_gui', { visible: profilingEnabled });
    tree.root.addChild(profilerGuiNode);

    setGameLoop(loop);
    setSceneName(instance.sceneName);
    setSaveRuntimeState(async (name: string) => {
      saveSceneSync(loop.getTree(), sceneFilePath(resolve(dir, 'scenes'), name), name);
    });

    const rt = new PlayRuntime(tree, instance, dir, scripts, jsScripts, physics, input, renderer, audio, loop);
    rt.sceneLoader = sceneLoader;
    rt.watchSceneName = instance.sceneName;
    rt.doWatch = config.watch ?? false;

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

    if (this.doWatch && this.sceneLoader && this.watchSceneName) {
      this.startWatcher();
    }
  }

  async stop(): Promise<void> {
    if (this.watcher) { this.watcher.close(); this.watcher = null; }
    if (this.tiledWatcher) { this.tiledWatcher.close(); this.tiledWatcher = null; }
    setGameLoop(null);
    setInputManager(null);
    if (this.syncClient) this.syncClient.disconnect();
    const { pluginRegistry } = await import('../engine/plugin-registry.js');
    await pluginRegistry.destroyAll();
    await this.instance.stop();
  }

  private startWatcher(): void {
    const { watch } = require('node:fs') as typeof import('node:fs');
    const scenesDir = resolve(this.dir, 'scenes');
    let debounce: ReturnType<typeof setTimeout> | null = null;
    const triggerReload = () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => {
        debounce = null;
        this.reloadScene();
      }, 300);
    };
    this.watcher = watch(scenesDir, (_event: string, filename: string | null) => {
      if (!filename || !filename.endsWith('.json')) return;
      triggerReload();
    });
    // Also watch for Tiled map changes
    this.tiledWatcher = watch(this.dir, { recursive: true }, (_event: string, filename: string | null) => {
      if (!filename) return;
      if (filename.endsWith('.tmj') || filename.endsWith('.tsx')) {
        invalidateTiledCache(resolve(this.dir, filename));
        triggerReload();
      }
    });
  }

  private async reloadScene(): Promise<void> {
    if (!this.sceneLoader || !this.watchSceneName) return;
    try {
      const newTree = await this.sceneLoader(this.watchSceneName);
      await this.loop.replaceTree(newTree);
    } catch { /* reload failed, keep current scene */ }
  }
}
