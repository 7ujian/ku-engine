import WebSocket from 'ws';
import { SceneTree } from '../engine/scene-tree.js';
import { Node } from '../engine/node.js';
import { ScriptEngine } from '../engine/script-engine.js';
import { JsScriptEngine } from '../engine/js-script-engine.js';
import { PhysicsWorld } from '../engine/physics.js';
import type { NodeData, ScriptRule } from '../engine/types.js';
import type { SyncOp } from './message-handler.js';

const GUARDED_PROPERTIES = new Set(['x', 'y', 'velocity', 'velocity.x', 'velocity.y']);

export class SyncClient {
  private ws: WebSocket | null = null;
  private tree: SceneTree;
  private _scripts: ScriptEngine | null = null;
  private _jsScripts: JsScriptEngine | null = null;
  private _physics: PhysicsWorld | null = null;
  private editorPort: number;
  private hotReload: boolean;

  constructor(tree: SceneTree, editorPort: number, hotReload = false) {
    this.tree = tree;
    this.editorPort = editorPort;
    this.hotReload = hotReload;
  }

  set scripts(engine: ScriptEngine | null) { this._scripts = engine; }
  set jsScripts(engine: JsScriptEngine | null) { this._jsScripts = engine; }
  set physics(world: PhysicsWorld | null) { this._physics = world; }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://localhost:${this.editorPort}`);
      this.ws = ws;

      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error('sync: timed out connecting to editor'));
      }, 5000);

      ws.on('open', () => {
        // Request snapshot
        const msg = JSON.stringify({
          type: 'command',
          id: `sync-snapshot-${Date.now()}`,
          payload: { action: 'sync.snapshot' },
        });
        ws.send(msg);
      });

      ws.on('message', (data: Buffer) => {
        const resp = JSON.parse(data.toString());
        clearTimeout(timeout);

        if (resp.payload?.ok && resp.payload.data?.root) {
          this.applySnapshot(resp.payload.data.root as NodeData);
        }

        // Subscribe for deltas if hot-reload
        if (this.hotReload) {
          const subMsg = JSON.stringify({
            type: 'command',
            id: `sync-sub-${Date.now()}`,
            payload: { action: 'sync.subscribe' },
          });
          ws.send(subMsg);

          // Now listen for incoming sync deltas
          ws.on('message', (deltaData: Buffer) => {
            this.handleMessage(deltaData);
          });
        }

        resolve();
      });

      ws.on('error', (err) => {
        clearTimeout(timeout);
        reject(new Error(`sync: ${err.message}`));
      });
    });
  }

  private handleMessage(data: Buffer): void {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'sync' && msg.payload?.ops) {
        this.applyDelta(msg.payload.ops as SyncOp[]);
      }
    } catch {
      // ignore malformed messages
    }
  }

  applySnapshot(rootData: NodeData): void {
    const newRoot = Node.fromJSON(rootData);
    this.tree.root.children = newRoot.children;
    this.tree.root.properties = newRoot.properties;
    this.tree.root.scripts = newRoot.scripts;

    if (this._scripts) this._scripts.registerTree();
    if (this._physics) this._physics.syncFromTree();
    if (this._jsScripts) this._jsScripts.registerTree();
  }

  applyDelta(ops: SyncOp[]): void {
    for (const op of ops) {
      try {
        this.applyOp(op);
      } catch {
        // skip ops that fail (node not found, etc.)
      }
    }
  }

  private applyOp(op: SyncOp): void {
    switch (op.op) {
      case 'add': {
        const node = Node.fromJSON(op.node);
        this.tree.add(op.path, node);
        if (this._scripts) this._scripts.registerNode(node);
        if (this._physics) this._physics.syncNode(node);
        if (this._jsScripts && (node as any).js_script) this._jsScripts.registerNode(node);
        break;
      }
      case 'remove': {
        // Find node before removing (to unregister scripts/physics)
        try {
          const node = this.tree.get(op.path);
          if (this._scripts) this._scripts.unregisterNodeById(node.id);
          if (this._jsScripts) this._jsScripts.unregisterNodeById(node.id);
          if (this._physics) this._physics.removeBody(node.id);
        } catch { /* already gone */ }
        this.tree.remove(op.path);
        break;
      }
      case 'set': {
        if (this.hotReload && this.isGuarded(op.path, op.property)) break;
        const node = this.tree.get(op.path);
        node.setProperty(op.property, op.value as Node['properties'][string]);
        if (this._physics) this._physics.syncNode(node);
        if (this._jsScripts && op.property === 'js_script') {
          this._jsScripts.unregisterNodeById(node.id);
          if ((node as any).js_script) this._jsScripts.registerNode(node);
        }
        break;
      }
      case 'move': {
        this.tree.move(op.from, op.to);
        break;
      }
      case 'replace_scripts': {
        const node = this.tree.get(op.path);
        node.scripts = op.scripts;
        if (this._scripts) {
          this._scripts.unregisterNodeById(node.id);
          this._scripts.registerNode(node);
        }
        break;
      }
      case 'replace_all': {
        this.applySnapshot(op.root);
        break;
      }
      case 'script_add': {
        const node = this.tree.get(op.path);
        const idx = op.index ?? node.scripts.length;
        node.scripts.splice(idx, 0, op.script);
        if (this._scripts) {
          this._scripts.unregisterNodeById(node.id);
          this._scripts.registerNode(node);
        }
        break;
      }
      case 'script_remove': {
        const node = this.tree.get(op.path);
        if (op.index !== undefined) {
          node.scripts.splice(op.index, 1);
        } else if (op.name) {
          node.scripts = node.scripts.filter(s => s.name !== op.name);
        }
        if (this._scripts) {
          this._scripts.unregisterNodeById(node.id);
          this._scripts.registerNode(node);
        }
        break;
      }
      case 'script_set': {
        const node = this.tree.get(op.path);
        if (op.index >= 0 && op.index < node.scripts.length) {
          node.scripts[op.index] = op.script;
        }
        if (this._scripts) {
          this._scripts.unregisterNodeById(node.id);
          this._scripts.registerNode(node);
        }
        break;
      }
    }
  }

  private isGuarded(path: string, property: string): boolean {
    try {
      const node = this.tree.get(path);
      if (node.type !== 'RigidBody') return false;
      return GUARDED_PROPERTIES.has(property);
    } catch {
      return false;
    }
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}
