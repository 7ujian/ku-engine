import { SceneTree } from '../engine/scene-tree.js';
import { Node } from '../engine/node.js';
import { createNodeByType } from '../engine/node-types.js';
import type { InstanceType } from './discovery.js';
import type { GameLoop } from '../engine/game-loop.js';
import type { InputManager } from './input-manager.js';

let gameLoop: GameLoop | null = null;
let inputManager: InputManager | null = null;

export function setGameLoop(loop: GameLoop | null): void { gameLoop = loop; }
export function setInputManager(mgr: InputManager | null): void { inputManager = mgr; }

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

export function handleMessage(tree: SceneTree, instanceMode: InstanceType, msg: Message): Response {
  try {
    const action = msg.payload.action as string;
    const result = route(tree, instanceMode, action, msg.payload);
    return { type: 'response', id: msg.id, payload: { ok: true, data: result } };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { type: 'response', id: msg.id, payload: { ok: false, error: message } };
  }
}

function route(tree: SceneTree, mode: InstanceType, action: string, payload: Record<string, unknown>): unknown {
  switch (action) {
    // Scene actions
    case 'scene.tree':
      return tree.root.toJSON();

    case 'scene.save':
      return { saved: true, note: 'use CLI scene save to write to disk' };

    // Node CRUD
    case 'node.add': {
      requireEdit(mode);
      const parentPath = payload.path as string;
      const nodeType = payload.nodeType as string;
      const nodeId = payload.nodeId as string;
      const overrides = payload.properties as import('../engine/types.js').PropertyMap | undefined;
      const node = createNodeByType(nodeType, nodeId, overrides);
      tree.add(parentPath || '/', node);
      return { id: nodeId, type: nodeType };
    }

    case 'node.rm': {
      requireEdit(mode);
      const path = payload.path as string;
      tree.remove(path);
      return { removed: path };
    }

    case 'node.set': {
      requireEdit(mode);
      const setPath = payload.path as string;
      const property = payload.property as string;
      const value = payload.value;
      const node = tree.get(setPath);
      node.setProperty(property, value as Node['properties'][string]);
      return { [property]: value };
    }

    case 'node.get': {
      const getPath = payload.path as string;
      const property = payload.property as string | undefined;
      const node = tree.get(getPath);
      if (property) {
        return { [property]: node.getProperty(property) };
      }
      return node.toJSON();
    }

    case 'node.list': {
      const listPath = payload.path as string;
      const node = tree.get(listPath);
      return node.children.map(c => ({ id: c.id, type: c.type }));
    }

    case 'node.move': {
      requireEdit(mode);
      const srcPath = payload.path as string;
      const destPath = payload.newParent as string;
      tree.move(srcPath, destPath);
      return { moved: srcPath, to: destPath };
    }

    // Instance info
    case 'instance.info':
      return { mode, rootId: tree.root.id };

    // Runtime control (play instance)
    case 'runtime.pause':
      if (!gameLoop) throw new Error('no game loop');
      gameLoop.pause();
      return { paused: true };

    case 'runtime.resume':
      if (!gameLoop) throw new Error('no game loop');
      gameLoop.resume();
      return { resumed: true };

    case 'runtime.step':
      if (!gameLoop) throw new Error('no game loop');
      gameLoop.step();
      return { stepped: true, frame: gameLoop.getFrame() };

    case 'runtime.status':
      return {
        running: gameLoop?.isRunning() ?? false,
        paused: gameLoop?.isPaused() ?? false,
        frame: gameLoop?.getFrame() ?? 0,
      };

    // Input (play instance)
    case 'input.key': {
      requirePlay(mode);
      if (!inputManager) throw new Error('no input manager');
      const key = payload.key as string;
      const direction = (payload.direction as string) ?? 'down';
      if (direction === 'down') inputManager.keyDown(key);
      else inputManager.keyUp(key);
      return { key, direction };
    }

    case 'input.click': {
      requirePlay(mode);
      if (!inputManager) throw new Error('no input manager');
      const x = payload.x as number;
      const y = payload.y as number;
      inputManager.click(x, y);
      return { click: { x, y } };
    }

    case 'input.axis': {
      requirePlay(mode);
      if (!inputManager) throw new Error('no input manager');
      const name = payload.name as string;
      const value = payload.value as number;
      inputManager.setAxis(name, value);
      return { axis: { name, value } };
    }

    // Query
    case 'query.scene':
      return tree.root.toJSON();

    case 'query.nodes': {
      const nodeType = payload.nodeType as string | undefined;
      if (nodeType) return tree.findByType(nodeType).map(n => n.toJSON());
      const all: unknown[] = [];
      tree.traverse((node) => { all.push({ id: node.id, type: node.type }); });
      return all;
    }

    default:
      throw new Error(`unknown action: ${action}`);
  }
}

function requireEdit(mode: InstanceType): void {
  if (mode !== 'edit') throw new Error('write operations require editor instance');
}

function requirePlay(mode: InstanceType): void {
  if (mode !== 'play') throw new Error('input requires play instance');
}
