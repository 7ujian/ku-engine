import { resolve } from 'node:path';
import { SceneTree } from '../engine/scene-tree.js';
import { Node } from '../engine/node.js';
import { createNodeByType } from '../engine/node-types.js';
import { PHYSICS_PROPERTIES } from '../engine/physics.js';
import { saveSceneSync, sceneFilePath } from '../persistence/scene-io.js';
import { isEditInstance, isPlayInstance, type InstanceType } from './discovery.js';
import { pluginRegistry } from '../engine/plugin-registry.js';
import type { GameLoop } from '../engine/game-loop.js';
import type { InputManager } from './input-manager.js';
import type { NodeData, ScriptRule } from '../engine/types.js';

let gameLoop: GameLoop | null = null;
let inputManager: InputManager | null = null;
let saveRuntimeState: ((name: string) => Promise<void>) | null = null;
let onDirty: (() => void) | null = null;
let autosaveHandler: ((enabled: boolean) => void) | null = null;
let sceneName = '';

export function setGameLoop(loop: GameLoop | null): void { gameLoop = loop; }
export function setInputManager(mgr: InputManager | null): void { inputManager = mgr; }
export function setSaveRuntimeState(fn: ((name: string) => Promise<void>) | null): void { saveRuntimeState = fn; }
export function setOnDirty(fn: (() => void) | null): void { onDirty = fn; }
export function setAutosaveHandler(fn: ((enabled: boolean) => void) | null): void { autosaveHandler = fn; }
export function setSceneName(name: string): void { sceneName = name; }

export interface Message {
  type: string;
  id: string;
  instance?: InstanceType;
  payload: Record<string, unknown>;
}

export interface Response {
  type: string;
  id: string;
  payload: { ok: boolean; data?: unknown; error?: string };
}

// Sync operation types for edit→play delta streaming
export type SyncOp =
  | { op: 'add'; path: string; node: NodeData }
  | { op: 'remove'; path: string }
  | { op: 'set'; path: string; property: string; value: unknown }
  | { op: 'move'; from: string; to: string }
  | { op: 'replace_scripts'; path: string; scripts: ScriptRule[] }
  | { op: 'replace_all'; root: NodeData }
  | { op: 'script_add'; path: string; script: ScriptRule; index?: number }
  | { op: 'script_remove'; path: string; index?: number; name?: string }
  | { op: 'script_set'; path: string; index: number; script: ScriptRule };

export interface HandleResult {
  response: Response;
  syncOps?: SyncOp[];
}

export function handleMessage(tree: SceneTree, instanceMode: InstanceType, msg: Message): HandleResult {
  try {
    // For play instances, use gameLoop's live tree (updated on scene change)
    const activeTree = (instanceMode === 'play' && gameLoop) ? gameLoop.getTree() : tree;
    const action = msg.payload.action as string;
    const { result, syncOps } = route(activeTree, instanceMode, action, msg.payload);
    if (syncOps && isEditInstance(instanceMode)) onDirty?.();
    return {
      response: { type: 'response', id: msg.id, payload: { ok: true, data: result } },
      ...(syncOps ? { syncOps } : {}),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      response: { type: 'response', id: msg.id, payload: { ok: false, error: message } },
    };
  }
}

function route(tree: SceneTree, mode: InstanceType, action: string, payload: Record<string, unknown>): { result: unknown; syncOps?: SyncOp[] } {
  switch (action) {
    // Scene actions
    case 'scene.tree':
      return { result: tree.root.toJSON() };

    case 'scene.save':
      return { result: { saved: true, note: 'use CLI scene save to write to disk' } };

    case 'scene.load': {
const sceneData = payload.sceneData as NodeData;
      const newRoot = Node.fromJSON(sceneData);
      tree.root.children = newRoot.children;
      tree.root.properties = newRoot.properties;
      tree.root.scripts = newRoot.scripts;
      return { result: { loaded: true }, syncOps: [{ op: 'replace_all', root: sceneData }] };
    }

    // Node CRUD
    case 'node.add': {
const parentPath = payload.path as string;
      const nodeType = payload.nodeType as string;
      const nodeId = payload.nodeId as string;
      const overrides = payload.properties as import('../engine/types.js').PropertyMap | undefined;
      const node = createNodeByType(nodeType, nodeId, overrides);
      // Lift instance/js_script from properties to top-level fields
      if (overrides) {
        if (typeof overrides.node_path === 'string') {
          node.node_path = overrides.node_path;
          delete node.properties.node_path;
        }
        if (typeof overrides.js_script === 'string') {
          node.js_script = overrides.js_script;
          delete node.properties.js_script;
        }
      }
      tree.add(parentPath || '/', node);
      return {
        result: { id: nodeId, type: nodeType },
        syncOps: [{ op: 'add', path: parentPath || '/', node: node.toJSON() }],
      };
    }

    case 'node.rm': {
const path = payload.path as string;
      const node = tree.get(path);
      const ids: string[] = [];
      (function collect(n: typeof node) { ids.push(n.id); for (const c of n.children) collect(c); })(node);
      tree.remove(path);
      if (gameLoop) {
        for (const id of ids) gameLoop.removeBody(id);
        gameLoop.unregisterNode(ids);
      }
      return {
        result: { removed: path },
        syncOps: [{ op: 'remove', path }],
      };
    }

    case 'node.set': {
const setPath = payload.path as string;
      const property = payload.property as string;
      const value = payload.value;
      const node = tree.get(setPath);
      node.setPropertyByPath(property, value);
      // Sync back to physics body if in play mode
      if (gameLoop && PHYSICS_PROPERTIES.has(property)) {
        gameLoop.syncNodeProperty(setPath);
      }
      return {
        result: { [property]: value },
        syncOps: [{ op: 'set', path: setPath, property, value }],
      };
    }

    case 'node.get': {
      const getPath = payload.path as string;
      const property = payload.property as string | undefined;
      const node = tree.get(getPath);
      if (property) {
        const value = node.getPropertyByPath(property);
        return { result: { property, value: value ?? null } };
      }
      return { result: node.toJSON() };
    }

    case 'node.list': {
      const listPath = payload.path as string;
      const node = tree.get(listPath);
      return { result: node.children.map(c => ({ id: c.id, type: c.type, childCount: c.children.length })) };
    }

    case 'node.move': {
const srcPath = payload.path as string;
      const destPath = payload.newParent as string;
      tree.move(srcPath, destPath);
      return {
        result: { moved: srcPath, to: destPath },
        syncOps: [{ op: 'move', from: srcPath, to: destPath }],
      };
    }

    case 'node.duplicate': {
      const srcPath = payload.path as string;
      const newId = payload.newId as string;
      const src = tree.get(srcPath);
      const parent = src.parent;
      if (!parent) throw new Error('cannot duplicate root');
      const clone = Node.fromJSON(src.toJSON());
      clone.id = newId;
      const parentPath = findNodePath(tree, parent) || '/';
      tree.add(parentPath, clone);
      return {
        result: { id: newId, parent: parentPath },
        syncOps: [{ op: 'add', path: parentPath, node: clone.toJSON() }],
      };
    }

    case 'node.save': {
      const savePath = payload.path as string;
      const sceneName = payload.sceneName as string;
      const node = tree.get(savePath);
      const clone = Node.fromJSON(node.toJSON());
      clone.id = 'root';
      const subTree = new SceneTree(clone);
      const filePath = sceneFilePath(resolve(payload.projectDir as string, 'scenes'), sceneName);
      saveSceneSync(subTree, filePath, sceneName);
      return { result: { saved: sceneName, path: filePath } };
    }

    // Instance info
    case 'instance.info':
      return { result: { mode, rootId: tree.root.id, scene: sceneName } };

    // Runtime control (play instance)
    case 'runtime.pause':
      if (!gameLoop) throw new Error('no game loop');
      gameLoop.pause();
      return { result: { paused: true } };

    case 'runtime.resume':
      if (!gameLoop) throw new Error('no game loop');
      gameLoop.resume();
      return { result: { resumed: true } };

    case 'runtime.step':
      if (!gameLoop) throw new Error('no game loop');
      gameLoop.step();
      return { result: { stepped: true, frame: gameLoop.getFrame() } };

    case 'runtime.status':
      return {
        result: {
          running: gameLoop?.isRunning() ?? false,
          paused: gameLoop?.isPaused() ?? false,
          frame: gameLoop?.getFrame() ?? 0,
        },
      };

    // Input (play instance)
    case 'input.key': {
      requirePlay(mode);
      if (!inputManager) throw new Error('no input manager');
      const key = payload.key as string;
      const direction = (payload.direction as string) ?? 'down';
      if (direction === 'down') inputManager.keyDown(key);
      else inputManager.keyUp(key);
      return { result: { key, direction } };
    }

    case 'input.click': {
      requirePlay(mode);
      if (!inputManager) throw new Error('no input manager');
      const x = payload.x as number;
      const y = payload.y as number;
      inputManager.click(x, y);
      return { result: { click: { x, y } } };
    }

    case 'input.axis': {
      requirePlay(mode);
      if (!inputManager) throw new Error('no input manager');
      const name = payload.name as string;
      const value = payload.value as number;
      inputManager.setAxis(name, value);
      return { result: { axis: { name, value } } };
    }

    case 'input.touch': {
      requirePlay(mode);
      if (!inputManager) throw new Error('no input manager');
      const phase = payload.phase as string;
      const x = payload.x as number;
      const y = payload.y as number;
      const pointerId = (payload.pointerId as number) ?? 0;
      if (phase === 'start') inputManager.touchStart(x, y, pointerId);
      else if (phase === 'move') inputManager.touchMove(x, y, pointerId);
      else if (phase === 'end') inputManager.touchEnd(x, y, pointerId);
      return { result: { touch: { phase, x, y, pointerId } } };
    }

    // Query
    case 'query.scene':
      return { result: tree.root.toJSON() };

    case 'query.nodes': {
      const nodeType = payload.nodeType as string | undefined;
      if (nodeType) return { result: tree.findByType(nodeType).map(n => n.toJSON()) };
      const all: unknown[] = [];
      tree.traverse((node) => { all.push({ id: node.id, type: node.type }); });
      return { result: all };
    }

    case 'query.diff': {
      if (!gameLoop) return { result: { deltas: [] } };
      return { result: { deltas: gameLoop.getDiff() } };
    }

    case 'query.collisions': {
      if (!gameLoop) return { result: { collisions: [] } };
      return { result: { collisions: gameLoop.getCollisions() } };
    }

    case 'query.logs': {
      if (!gameLoop) return { result: { logs: [] } };
      const logs = gameLoop.getLogs();
      return { result: { logs } };
    }

    case 'query.logs_clear': {
      gameLoop?.clearLogs();
      return { result: { cleared: true } };
    }

    case 'query.node': {
      const nodePath = payload.path as string;
      const node = tree.get(nodePath);
      return { result: node.toJSON() };
    }

    // Sync (editor-side)
    case 'sync.snapshot': {
return { result: { root: tree.root.toJSON() } };
    }

    case 'sync.subscribe':
return { result: { subscribed: true } };

    case 'scene.save_runtime': {
      requirePlay(mode);
      const name = payload.name as string;
      if (saveRuntimeState) {
        void saveRuntimeState(name);
        return { result: { saving: true, name } };
      }
      return { result: { saving: false, error: 'save not available' } };
    }

    // Script delta edits
    case 'script.add': {
const scriptPath = payload.path as string;
      const script = payload.script as ScriptRule;
      const index = payload.index as number | undefined;
      const node = tree.get(scriptPath);
      const idx = index ?? node.scripts.length;
      node.scripts.splice(idx, 0, script);
      return {
        result: { added: true, index: idx },
        syncOps: [{ op: 'script_add', path: scriptPath, script, index: idx }],
      };
    }

    case 'script.rm': {
const rmPath = payload.path as string;
      const rmIndex = payload.index as number | undefined;
      const rmName = payload.name as string | undefined;
      const node = tree.get(rmPath);
      const before = node.scripts.length;
      if (rmIndex !== undefined) {
        node.scripts.splice(rmIndex, 1);
      } else if (rmName) {
        node.scripts = node.scripts.filter(s => s.name !== rmName);
      }
      return {
        result: { removed: before - node.scripts.length },
        syncOps: [{ op: 'script_remove', path: rmPath, index: rmIndex, name: rmName }],
      };
    }

    case 'script.set': {
const setPath = payload.path as string;
      const setIndex = payload.index as number;
      const setScript = payload.script as ScriptRule;
      const node = tree.get(setPath);
      if (setIndex < 0 || setIndex >= node.scripts.length) throw new Error(`script index out of range: ${setIndex}`);
      node.scripts[setIndex] = setScript;
      return {
        result: { replaced: true, index: setIndex },
        syncOps: [{ op: 'script_set', path: setPath, index: setIndex, script: setScript }],
      };
    }

    case 'scene.autosave':
if (autosaveHandler) {
        autosaveHandler(payload.enabled as boolean);
        return { result: { autosave: payload.enabled } };
      }
      return { result: { autosave: false, error: 'autosave not available' } };

    default: {
      const handler = pluginRegistry.getMessageHandler(action);
      if (handler) return handler(tree, mode, payload);
      throw new Error(`unknown action: ${action}`);
    }
  }
}

function findNodePath(tree: SceneTree, target: Node): string | null {
  let found: string | null = null;
  tree.traverse((node, path) => {
    if (node === target) found = path;
  });
  return found;
}

function requirePlay(mode: InstanceType): void {
  if (!isPlayInstance(mode)) throw new Error('input requires play instance');
}
