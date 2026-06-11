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
import { loadScene, loadSceneRootSync, sceneFilePath, saveSceneSync } from '../persistence/scene-io.js';
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

    const jsScripts = new JsScriptEngine({
      tree,
      projectDir: dir,
      loadSource: (path) => loadScriptSource(dir, path),
      loadSceneFile: async (scenePath) => {
        const { loadSceneRoot } = await import('../persistence/scene-io.js');
        return loadSceneRoot(sceneFilePath(resolve(dir, 'scenes'), scenePath), dir);
      },
      loadSceneFileSync: (scenePath) => {
        return loadSceneRootSync(sceneFilePath(resolve(dir, 'scenes'), scenePath), dir);
      },
    });
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
    const win = { ...(cfg.window ?? {}) as Record<string, unknown> };
    // vsync can live at project root or inside window
    if (cfg.vsync !== undefined && win.vsync === undefined) win.vsync = cfg.vsync;
    const windowConfig = migrateWindowConfig(win);
    const renderer = new Renderer(
      windowConfig,
      dir,
      (cfg.debug_physics as boolean) ?? false,
      (cfg.debug_ui as boolean) ?? false,
    );
    await renderer.open('ku');

    const audio = new AudioManager(dir, loadWav);
    const sceneLoader = async (name: string) => loadScene(sceneFilePath(resolve(dir, 'scenes'), name), dir);
    const loop = new GameLoop(tree, scripts, physics, renderer, 60, true, jsScripts, audio, sceneLoader);
    loop.setVsync(windowConfig.vsync);
    const profilingEnabled = (cfg.profiling as boolean) ?? false;
    if (profilingEnabled) {
      physics.setProfiler(loop.profiler);
    }

    // System nodes: Profiler + ProfilerGui — re-added on every scene change
    const profilerLabels: Node[] = [];
    let graphNode: Node | null = null;

    const setupSystemNodes = () => {
      const t = loop.getTree();
      // Profiler node
      const pn = createNodeByType('Profiler', 'profiler', { enabled: profilingEnabled });
      t.root.addChild(pn);
      loop.profiler.setTargetNode(pn);

      // ProfilerGui using widgets
      const gui = createNodeByType('Panel', 'profiler_gui', {
        visible: profilingEnabled,
        x: 8, y: 8,
        width: 290, height: 260,
        color: 'rgba(0, 0, 0, 0.75)',
        border_color: '#555',
        border_width: 1,
      });
      t.root.addChild(gui);

      const vbox = createNodeByType('VBoxContainer', 'profiler_vbox', {
        separation: 2,
        width: 280, height: 250,
        margin_left: 6, margin_right: 6,
        margin_top: 6, margin_bottom: 6,
      });
      gui.addChild(vbox);

      // Header label
      const header = createNodeByType('Label', 'profiler_header', {
        text: 'Profiler',
        font_size: 12,
        height: 15,
        color: '#0f0',
        font: 'Silkscreen',
      });
      vbox.addChild(header);

      // FPS label
      const fpsLabel = createNodeByType('Label', 'profiler_fps', {
        text: 'FPS: 0',
        font_size: 12,
        height: 15,
        color: '#0f0',
        font: 'Silkscreen',
      });
      vbox.addChild(fpsLabel);

      // Frame time label
      const frametimeLabel = createNodeByType('Label', 'profiler_frametime', {
        text: 'Frame: 0.00ms',
        font_size: 12,
        height: 15,
        color: '#0f0',
        font: 'Silkscreen',
      });
      vbox.addChild(frametimeLabel);

      // Column headers
      const colHeader = createNodeByType('Label', 'profiler_cols', {
        text: '  name                   total   avg   max count',
        font_size: 12,
        height: 15,
        color: '#aaa',
        font: 'Silkscreen',
      });
      vbox.addChild(colHeader);

      // Sample labels (pre-create 8 slots)
      profilerLabels.length = 0;
      for (let i = 0; i < 8; i++) {
        const lbl = createNodeByType('Label', `profiler_sample_${i}`, {
          text: '',
          font_size: 12,
          height: 15,
          color: '#fff',
          font: 'Silkscreen',
        });
        vbox.addChild(lbl);
        profilerLabels.push(lbl);
      }

      // Frame time graph
      graphNode = createNodeByType('LineGraph', 'profiler_graph', {
        width: 268, height: 50,
        max_value: 33.33,
        line_color: '#0af',
        fill_color: 'rgba(0, 170, 255, 0.1)',
        grid_values: [16.67],
        grid_colors: ['rgba(0, 255, 0, 0.3)'],
      });
      vbox.addChild(graphNode);

      // Re-wire physics profiler after scene change creates new PhysicsWorld
      if (profilingEnabled) {
        loop.getPhysics().setProfiler(loop.profiler);
      }
    };
    setupSystemNodes();
    loop.setSystemNodeSetup(setupSystemNodes);

    // F1 toggles ProfilerGui — uses loop.getTree() so it survives scene changes
    renderer.setKeyHandler((key, down) => {
      if (down) {
        input.keyDown(key);
        if (key === 'F1') {
          try {
            const gui = loop.getTree().get('/profiler_gui');
            gui.setProperty('visible', !gui.getProperty('visible'));
          } catch { /* no-op */ }
        }
      } else {
        input.keyUp(key);
      }
    });

    // Update profiler GUI widgets
    loop.setProfilerSyncCallback(() => {
      try {
        const profilerNode = loop.getTree().get('/profiler');
        if (!profilerNode || !profilerNode.getProperty('enabled')) return;

        const samples = (profilerNode.getProperty('samples') as Array<{
          name: string; totalMs: number; avgMs: number; maxMs: number; count: number;
        }>) ?? [];
        const fps = (profilerNode.getProperty('fps') as number) ?? 0;
        const bodyCount = (profilerNode.getProperty('body_count') as number) ?? 0;
        const nodeCount = (profilerNode.getProperty('node_count') as number) ?? 0;
        const frameTimeHistory = (profilerNode.getProperty('frame_time_history') as {
          data: number[]; filled: boolean;
        }) ?? { data: [], filled: false };

        // Update header
        const header = loop.getTree().get('/profiler_gui/profiler_vbox/profiler_header');
        if (header) header.setProperty('text', `Profiler  bodies=${bodyCount}  nodes=${nodeCount}`);

        // Update FPS
        const fpsLabel = loop.getTree().get('/profiler_gui/profiler_vbox/profiler_fps');
        if (fpsLabel) {
          fpsLabel.setProperty('text', `FPS: ${fps}`);
          fpsLabel.setProperty('color', fps >= 55 ? '#0f0' : fps >= 30 ? '#ff0' : '#f00');
        }

        // Update frame time (every frame)
        const lastFrameTime = (profilerNode.getProperty('last_frame_time') as number) ?? 0;
        const frametimeLabel = loop.getTree().get('/profiler_gui/profiler_vbox/profiler_frametime');
        if (frametimeLabel) {
          frametimeLabel.setProperty('text', `Frame: ${lastFrameTime.toFixed(2)}ms`);
        }

        // Update sample labels
        for (let i = 0; i < profilerLabels.length; i++) {
          const lbl = profilerLabels[i];
          if (i < samples.length) {
            const s = samples[i];
            lbl.setProperty('text',
              `  ${s.name.padEnd(20).slice(0, 20)}  ${String(s.totalMs).padStart(7)}  ${String(s.avgMs).padStart(5)}  ${String(s.maxMs).padStart(5)}  ${String(s.count).padStart(5)}`
            );
          } else {
            lbl.setProperty('text', '');
          }
        }

        // Update graph
        if (graphNode) {
          graphNode.setProperty('data', frameTimeHistory.data);
        }
      } catch { /* no-op */ }
    });
    renderer.setTouchHandler((phase, x, y, pointerId) => {
      if (phase === 'start') input.touchStart(x, y, pointerId);
      else if (phase === 'move') input.touchMove(x, y, pointerId);
      else if (phase === 'end') input.touchEnd(x, y, pointerId);
    });

    renderer.setWheelHandler((x, y, deltaY) => {
      input.mouseWheel(x, y, deltaY);
    });

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
