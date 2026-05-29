import { createContext, Script as VmScript, type Context } from 'node:vm';
import { Node } from './node.js';
import { SceneTree } from './scene-tree.js';
import { EventBus } from './event-bus.js';
import { createNodeByType } from './node-types.js';
import type { NodeData } from './types.js';

const MAX_LOGS = 1000;

export interface JsScriptEngineOptions {
  tree: SceneTree;
  projectDir: string;
  bus?: EventBus;
  onSpawn?: (node: Node) => void;
  onDestroy?: (nodeId: string) => void;
  loadSource?: (scriptPath: string) => Promise<string>;
  loadSceneFile?: (scenePath: string) => Promise<import('./types.js').NodeData>;
}

interface RegisteredScript {
  node: Node;
  compiled: VmScript;
  sandbox: Context;
  handlers: Record<string, (...args: unknown[]) => void>;
  state: Record<string, unknown>;
}

export class JsScriptEngine {
  private tree: SceneTree;
  private projectDir: string;
  private bus: EventBus;
  private compiledCache = new Map<string, VmScript>();
  private registrations = new Map<string, RegisteredScript>();
  private logs: string[] = [];
  private onSpawn: ((node: Node) => void) | null;
  private onDestroy: ((nodeId: string) => void) | null;
  private onEmit: ((event: string, data: Record<string, unknown>) => void) | null = null;
  private loadSource: (scriptPath: string) => Promise<string>;
  private loadSceneFile: ((scenePath: string) => Promise<NodeData>) | null;

  constructor(opts: JsScriptEngineOptions) {
    this.tree = opts.tree;
    this.projectDir = opts.projectDir;
    this.bus = opts.bus ?? new EventBus();
    this.onSpawn = opts.onSpawn ?? null;
    this.onDestroy = opts.onDestroy ?? null;
    this.loadSource = opts.loadSource ?? (async () => { throw new Error('no script loader provided'); });
    this.loadSceneFile = opts.loadSceneFile ?? null;
  }

  async registerTree(): Promise<void> {
    this.registrations.clear();
    const promises: Promise<void>[] = [];
    this.tree.traverse((node) => {
      const scriptPath = (node as any).js_script as string | undefined;
      if (scriptPath) {
        promises.push(this.registerNode(node));
      }
    });
    await Promise.all(promises);
  }

  async registerNode(node: Node): Promise<void> {
    const scriptPath = (node as any).js_script as string | undefined;
    if (!scriptPath) return;

    const { resolve } = await import('node:path');
    const absPath = resolve(this.projectDir, scriptPath);
    let compiled = this.compiledCache.get(absPath);
    if (!compiled) {
      const source = await this.loadSource(scriptPath);
      compiled = new VmScript(source, { filename: absPath });
      this.compiledCache.set(absPath, compiled);
    }

    const handlers: Record<string, (...args: unknown[]) => void> = {};
    const nodeApi = this.createNodeApi(node);
    const sceneApi = this.createSceneApi();

    const sandbox = createContext(Object.freeze({
      handlers,
      Math,
      console: {
        log: (...args: unknown[]) => {
          const msg = args.map(String).join(' ');
          this.pushLog(msg);
          console.log(msg);
        },
      },
    }) as any);

    try {
      compiled.runInContext(sandbox);
    } catch (err) {
      this.pushLog(`JS error in ${absPath}: ${(err as Error).message}`);
    }

    // Script may have used `const handlers = {...}` which shadows the sandbox
    // global without populating it. Read the context-scoped binding instead.
    if (Object.keys(handlers).length === 0) {
      try {
        const globalHandlers = new VmScript('handlers').runInContext(sandbox) as Record<string, (...args: unknown[]) => void> | undefined;
        if (globalHandlers && typeof globalHandlers === 'object') {
          for (const key of Object.keys(globalHandlers)) {
            if (typeof globalHandlers[key] === 'function') {
              handlers[key] = globalHandlers[key];
            }
          }
        }
      } catch { /* handlers not defined in context */ }
    }

    this.registrations.set(node.id, { node, compiled, sandbox, handlers, state: {} });
  }

  unregisterNodeById(id: string): void {
    this.registrations.delete(id);
  }

  evaluateEvent(event: string, data: Record<string, unknown> = {}): void {
    const targetNode = data.node as string | undefined;

    for (const [, reg] of this.registrations) {
      const handler = reg.handlers[event];
      if (typeof handler !== 'function') continue;

      // For node-targeted events (collisions, area, key, click, touch),
      // only dispatch to the node specified in data.node
      if (targetNode && reg.node.id !== targetNode) continue;

      // Merge event data into persisted per-node state
      const merged = { ...reg.state, ...data };
      reg.state = merged;

      const ctx = {
        node: this.createNodeApi(reg.node),
        scene: this.createSceneApi(),
        data: merged,
        dt: (data.dt as number) ?? (1000 / 60),
        emit: (name: string, payload?: Record<string, unknown>) => {
          const data = payload ?? {};
          this.bus.emit(name, data);
          this.onEmit?.(name, data);
        },
        log: (...args: unknown[]) => {
          this.pushLog(args.map(String).join(' '));
        },
      };

      try {
        handler(ctx);
      } catch (err) {
        this.pushLog(`JS handler error (${event}): ${(err as Error).message}`);
      }
    }
  }

  getLogs(): string[] {
    return [...this.logs];
  }

  clearLogs(): void {
    this.logs = [];
  }

  setTree(tree: SceneTree): void { this.tree = tree; }

  setSpawnCallback(cb: (node: Node) => void): void { this.onSpawn = cb; }
  setDestroyCallback(cb: (nodeId: string) => void): void { this.onDestroy = cb; }
  setEmitCallback(cb: (event: string, data: Record<string, unknown>) => void): void { this.onEmit = cb; }

  notifySpawnRecursive(node: Node): void {
    this.onSpawn?.(node);
    for (const child of node.children) {
      this.notifySpawnRecursive(child);
    }
  }

  private pushLog(msg: string): void {
    if (this.logs.length >= MAX_LOGS) this.logs.shift();
    this.logs.push(msg);
  }

  private createNodeApi(node: Node) {
    return {
      id: node.id,
      type: node.type,
      get: (prop: string) => node.getPropertyByPath(prop),
      set: (prop: string, value: unknown) => node.setPropertyByPath(prop, value),
    };
  }

  private createSceneApi() {
    const self = this;
    return {
      get: (path: string, prop: string) => {
        try { return self.tree.get(path).getPropertyByPath(prop); }
        catch { return undefined; }
      },
      set: (path: string, prop: string, value: unknown) => {
        try { self.tree.get(path).setPropertyByPath(prop, value); }
        catch { /* node not found */ }
      },
      spawn: (type: string, id: string, props?: Record<string, unknown>, parent?: string) => {
        try {
          const node = createNodeByType(type, id, props as any);
          self.tree.add(parent ?? '/', node);
          self.onSpawn?.(node);
        } catch { /* ignore */ }
      },
      destroy: (path: string) => {
        try {
          const node = self.tree.get(path);
          const ids: string[] = [];
          (function collect(n: Node) { ids.push(n.id); for (const c of n.children) collect(c); })(node);
          self.tree.remove(path);
          for (const id of ids) self.onDestroy?.(id);
        } catch { /* ignore */ }
      },
      load_scene: async (containerPath: string, sceneFile: string) => {
        if (!self.loadSceneFile) return;
        try {
          const rootData = await self.loadSceneFile(sceneFile);
          const container = self.tree.get(containerPath);
          const loadedIds: string[] = [];
          if (rootData.children) {
            for (const childData of rootData.children) {
              if (container.findChild(childData.id)) continue;
              const childNode = Node.fromJSON(childData);
              container.addChild(childNode);
              self.notifySpawnRecursive(childNode);
              loadedIds.push(childNode.id);
            }
          }
          // Register scripts only for newly loaded nodes
          const loadPromises: Promise<void>[] = [];
          (function collect(node: Node): void {
            if ((node as any).js_script) {
              loadPromises.push(self.registerNode(node));
            }
            for (const child of node.children) collect(child);
          })(container);
          await Promise.all(loadPromises);
          // Fire on_enter per loaded top-level node
          for (const id of loadedIds) {
            self.evaluateEvent('on_enter', { node: id });
          }
        } catch (e) {
          console.error('[load_scene] failed:', (e as Error).message);
        }
      },
      find: (path: string) => {
        try {
          const node = self.tree.get(path);
          return self.createNodeApi(node);
        } catch { return null; }
      },
    };
  }
}
