import { resolve } from 'node:path';
import { SceneTree } from '../engine/scene-tree.js';
import { Node } from '../engine/node.js';
import { Instance } from './instance.js';
import { loadScene, sceneFilePath, saveSceneSync } from '../persistence/scene-io.js';
import { setOnDirty, setAutosaveHandler, setSceneName } from './message-handler.js';
import type { InstanceType } from './discovery.js';

const AUTOSAVE_DEBOUNCE_MS = 2000;

export class EditorRuntime {
  tree: SceneTree;
  instance: Instance;
  dir: string;
  private lastSavePath: string | null;
  private autosave: boolean;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  private constructor(tree: SceneTree, instance: Instance, dir: string, lastSavePath: string | null, autosave: boolean) {
    this.tree = tree;
    this.instance = instance;
    this.dir = dir;
    this.lastSavePath = lastSavePath;
    this.autosave = autosave;
  }

  static async create(dir: string, port: number, scene?: string, autosave = false): Promise<EditorRuntime> {
    let tree: SceneTree;
    let lastSavePath: string | null = null;

    // Load plugins before engine subsystems
    const { pluginRegistry } = await import('../engine/plugin-registry.js');
    await pluginRegistry.loadFromDir(dir, 'edit');

    if (scene) {
      const path = sceneFilePath(resolve(dir, 'scenes'), scene);
      tree = await loadScene(path, dir);
      lastSavePath = path;
    } else {
      tree = new SceneTree(new Node('root', 'Node'));
    }

    const instance = new Instance('edit' as InstanceType, tree, dir, port);
    instance.sceneName = scene ?? '';
    return new EditorRuntime(tree, instance, dir, lastSavePath, autosave);
  }

  async start(): Promise<void> {
    if (this.autosave) {
      setOnDirty(() => this.scheduleSave());
      setAutosaveHandler((enabled: boolean) => this.toggleAutosave(enabled));
    }
    setSceneName(this.instance.sceneName);
    await this.instance.start();
  }

  async stop(): Promise<void> {
    setOnDirty(null);
    setAutosaveHandler(null);
    if (this.saveTimer) clearTimeout(this.saveTimer);
    const { pluginRegistry } = await import('../engine/plugin-registry.js');
    await pluginRegistry.destroyAll();
    await this.instance.stop();
  }

  private scheduleSave(): void {
    if (!this.autosave || !this.lastSavePath) return;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      if (this.lastSavePath) {
        saveSceneSync(this.tree, this.lastSavePath);
      }
    }, AUTOSAVE_DEBOUNCE_MS);
  }

  private toggleAutosave(enabled: boolean): void {
    this.autosave = enabled;
    if (!enabled) {
      if (this.saveTimer) clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
  }
}
