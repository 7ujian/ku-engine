import { createContext, Script as VmScript, type Context } from 'node:vm';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Node } from './node.js';
import { SceneTree } from './scene-tree.js';
import { EventBus } from './event-bus.js';
import { createNodeByType } from './node-types.js';

export interface JsScriptEngineOptions {
  tree: SceneTree;
  projectDir: string;
  bus?: EventBus;
}

interface RegisteredScript {
  node: Node;
  compiled: VmScript;
  sandbox: Context;
  handlers: Record<string, (...args: unknown[]) => void>;
}

export class JsScriptEngine {
  private tree: SceneTree;
  private projectDir: string;
  private bus: EventBus;
  private compiledCache = new Map<string, VmScript>();
  private registrations = new Map<string, RegisteredScript>();
  private logs: string[] = [];

  constructor(opts: JsScriptEngineOptions) {
    this.tree = opts.tree;
    this.projectDir = opts.projectDir;
    this.bus = opts.bus ?? new EventBus();
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

    const absPath = resolve(this.projectDir, scriptPath);
    let compiled = this.compiledCache.get(absPath);
    if (!compiled) {
      const source = await readFile(absPath, 'utf-8');
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
        log: (...args: unknown[]) => { this.logs.push(args.map(String).join(' ')); },
      },
    }) as any);

    try {
      compiled.runInContext(sandbox);
    } catch (err) {
      this.logs.push(`JS error in ${absPath}: ${(err as Error).message}`);
    }

    this.registrations.set(node.id, { node, compiled, sandbox, handlers });
  }

  unregisterNodeById(id: string): void {
    this.registrations.delete(id);
  }

  evaluateEvent(event: string, data: Record<string, unknown> = {}): void {
    for (const [, reg] of this.registrations) {
      const handler = reg.handlers[event];
      if (typeof handler !== 'function') continue;

      const ctx = {
        node: this.createNodeApi(reg.node),
        scene: this.createSceneApi(),
        data,
        emit: (name: string, payload?: Record<string, unknown>) => {
          this.bus.emit(name, payload ?? {});
        },
        log: (...args: unknown[]) => {
          this.logs.push(args.map(String).join(' '));
        },
      };

      try {
        handler(ctx);
      } catch (err) {
        this.logs.push(`JS handler error (${event}): ${(err as Error).message}`);
      }
    }
  }

  getLogs(): string[] {
    return [...this.logs];
  }

  clearLogs(): void {
    this.logs = [];
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
    return {
      get: (path: string, prop: string) => {
        try { return this.tree.get(path).getPropertyByPath(prop); }
        catch { return undefined; }
      },
      set: (path: string, prop: string, value: unknown) => {
        try { this.tree.get(path).setPropertyByPath(prop, value); }
        catch { /* node not found */ }
      },
      spawn: (type: string, id: string, props?: Record<string, unknown>) => {
        try {
          const node = createNodeByType(type, id, props as any);
          this.tree.add('/', node);
        } catch { /* ignore */ }
      },
      destroy: (path: string) => {
        try { this.tree.remove(path); }
        catch { /* ignore */ }
      },
      find: (path: string) => {
        try {
          const node = this.tree.get(path);
          return this.createNodeApi(node);
        } catch { return null; }
      },
    };
  }
}
