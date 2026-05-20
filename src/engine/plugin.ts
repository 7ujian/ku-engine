import type { Node } from './node.js';
import type { SceneTree } from './scene-tree.js';
import type { EventBus } from './event-bus.js';
import type { PropertyMap, ScriptAction } from './types.js';
import type { SyncOp } from '../server/message-handler.js';
import type { InstanceType } from '../server/discovery.js';
import type { NodeData } from './types.js';
import type { Command } from 'commander';
import type { SKRSContext2D } from '@napi-rs/canvas';

export interface KuPlugin {
  name: string;
  version: string;
  init?(host: PluginHost): void;
  destroy?(): void;
}

export interface PluginHost {
  registerNodeType(type: string, factory: PluginNodeFactory): void;
  registerAction(key: string, handler: ActionHandler): void;
  registerMessageHandler(action: string, handler: PluginMessageHandler): void;
  registerCliCommand(registrar: CliRegistrar): void;
  registerNodeRenderer(type: string, renderer: NodeRenderer): void;
  createNode(id: string, type: string, defaults?: PropertyMap, overrides?: Partial<PropertyMap>): Node;
  readonly projectDir: string;
  readonly mode: 'edit' | 'play';
}

export type PluginNodeFactory = (id: string, overrides?: Partial<PropertyMap>) => Node;

export interface ActionContext {
  tree: SceneTree;
  evaluateExpression: (expr: unknown, props: PropertyMap, ctx: Record<string, unknown>, tree: SceneTree) => unknown;
  recordError: (nodeId: string, event: string, actionType: string, reason: string) => void;
  createNodeByType: (type: string, id: string, overrides?: Partial<PropertyMap>) => Node;
  bus: EventBus;
}

export type ActionHandler = (
  node: Node,
  action: ScriptAction,
  context: Record<string, unknown>,
  event: string,
  ctx: ActionContext,
) => void;

export type PluginMessageHandler = (
  tree: SceneTree,
  mode: InstanceType,
  payload: Record<string, unknown>,
) => { result: unknown; syncOps?: SyncOp[] };

export type NodeRenderer = (
  ctx: SKRSContext2D,
  node: Node,
  wx: number,
  wy: number,
  sx: number,
  sy: number,
  dt: number,
  projectDir: string,
) => void;

export type CliRegistrar = (program: Command) => void;

export interface PluginInfo {
  name: string;
  version: string;
  path: string;
}
