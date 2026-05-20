import { readdir, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Node } from './node.js';
import type {
  KuPlugin, PluginHost, PluginNodeFactory, PluginInfo,
  ActionHandler, ActionContext,
  PluginMessageHandler,
  NodeRenderer,
  CliRegistrar,
} from './plugin.js';
import type { InstanceType } from '../server/discovery.js';
import type { PropertyMap } from './types.js';

export class PluginRegistry implements PluginHost {
  private nodeFactories = new Map<string, PluginNodeFactory>();
  private actionHandlers = new Map<string, ActionHandler>();
  private messageHandlers = new Map<string, PluginMessageHandler>();
  private nodeRenderers = new Map<string, NodeRenderer>();
  private cliRegistrars: CliRegistrar[] = [];
  private plugins: KuPlugin[] = [];
  private _projectDir = '';
  private _mode: 'edit' | 'play' = 'edit';

  get projectDir() { return this._projectDir; }
  get mode() { return this._mode; }

  // PluginHost implementation
  registerNodeType(type: string, factory: PluginNodeFactory): void {
    this.nodeFactories.set(type, factory);
  }

  registerAction(key: string, handler: ActionHandler): void {
    this.actionHandlers.set(key, handler);
  }

  registerMessageHandler(action: string, handler: PluginMessageHandler): void {
    this.messageHandlers.set(action, handler);
  }

  registerCliCommand(registrar: CliRegistrar): void {
    this.cliRegistrars.push(registrar);
  }

  registerNodeRenderer(type: string, renderer: NodeRenderer): void {
    this.nodeRenderers.set(type, renderer);
  }

  createNode(id: string, type: string, defaults?: PropertyMap, overrides?: Partial<PropertyMap>): Node {
    const props: PropertyMap = { ...defaults };
    if (overrides) {
      for (const [k, v] of Object.entries(overrides)) {
        if (v !== undefined) props[k] = v as PropertyMap[string];
      }
    }
    return new Node(id, type, props);
  }

  // Read accessors
  getNodeTypeFactory(type: string): PluginNodeFactory | undefined {
    return this.nodeFactories.get(type);
  }

  getAllActionHandlers(): ReadonlyMap<string, ActionHandler> {
    return this.actionHandlers;
  }

  getMessageHandler(action: string): PluginMessageHandler | undefined {
    return this.messageHandlers.get(action);
  }

  getNodeRenderer(type: string): NodeRenderer | undefined {
    return this.nodeRenderers.get(type);
  }

  getCliRegistrars(): CliRegistrar[] {
    return this.cliRegistrars;
  }

  async loadFromDir(projectDir: string, mode: 'edit' | 'play'): Promise<void> {
    this._projectDir = projectDir;
    this._mode = mode;

    const pluginsDir = join(projectDir, 'plugins');
    let entries: string[];
    try {
      entries = await readdir(pluginsDir);
    } catch {
      return; // no plugins dir — fine
    }

    // Determine load order
    let orderedNames: string[];
    try {
      const cfg = JSON.parse(await readFile(resolve(projectDir, 'project.json'), 'utf-8'));
      const declared = cfg.plugins as string[] | undefined;
      if (declared && Array.isArray(declared)) {
        orderedNames = declared;
      } else {
        orderedNames = entries.filter(e => !e.startsWith('.') && !e.startsWith('_')).sort();
      }
    } catch {
      orderedNames = entries.filter(e => !e.startsWith('.') && !e.startsWith('_')).sort();
    }

    for (const name of orderedNames) {
      const entryPath = await this.resolvePluginPath(pluginsDir, name);
      if (!entryPath) continue;

      try {
        const mod = await import(pathToFileURL(entryPath).href);
        const plugin: KuPlugin = mod.default ?? mod.plugin ?? mod;
        if (!plugin.name || !plugin.version) {
          console.warn(`[plugin] skipping ${name}: missing name/version`);
          continue;
        }
        if (plugin.init) plugin.init(this);
        this.plugins.push(plugin);
        console.log(`[plugin] loaded ${plugin.name}@${plugin.version}`);
      } catch (err) {
        console.warn(`[plugin] failed to load ${name}: ${(err as Error).message}`);
      }
    }
  }

  async destroyAll(): Promise<void> {
    for (const plugin of this.plugins) {
      try {
        if (plugin.destroy) plugin.destroy();
      } catch { /* ignore */ }
    }
    this.plugins = [];
    this.nodeFactories.clear();
    this.actionHandlers.clear();
    this.messageHandlers.clear();
    this.nodeRenderers.clear();
    this.cliRegistrars = [];
  }

  async listPlugins(projectDir: string): Promise<PluginInfo[]> {
    const pluginsDir = join(projectDir, 'plugins');
    let entries: string[];
    try {
      entries = await readdir(pluginsDir);
    } catch {
      return [];
    }

    const infos: PluginInfo[] = [];
    for (const name of entries) {
      if (name.startsWith('.') || name.startsWith('_')) continue;
      const entryPath = await this.resolvePluginPath(pluginsDir, name);
      if (!entryPath) continue;

      try {
        const mod = await import(pathToFileURL(entryPath).href);
        const plugin: KuPlugin = mod.default ?? mod.plugin ?? mod;
        infos.push({ name: plugin.name ?? name, version: plugin.version ?? '?', path: entryPath });
      } catch {
        infos.push({ name, version: '?', path: entryPath ?? join(pluginsDir, name) });
      }
    }
    return infos;
  }

  private async resolvePluginPath(pluginsDir: string, name: string): Promise<string | null> {
    const direct = join(pluginsDir, name);
    // .js file
    if (name.endsWith('.js')) {
      try { await readFile(direct); return direct; } catch { return null; }
    }
    // directory with index.js
    const indexPath = join(direct, 'index.js');
    try { await readFile(indexPath); return indexPath; } catch { /* fallthrough */ }
    // directory with package.json main
    try {
      const pkg = JSON.parse(await readFile(join(direct, 'package.json'), 'utf-8'));
      const main = pkg.main as string | undefined;
      if (main) return resolve(direct, main);
    } catch { /* fallthrough */ }
    return null;
  }
}

export const pluginRegistry = new PluginRegistry();
