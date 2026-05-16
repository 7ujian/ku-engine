import { Node } from './node.js';
import { SceneTree } from './scene-tree.js';
import { EventBus } from './event-bus.js';
import { evaluateExpression } from './expression-evaluator.js';
import { evaluateCondition } from './conditions.js';
import { createNodeByType } from './node-types.js';
import type { ScriptRule, ScriptAction, PropertyMap } from './types.js';

export class ScriptEngine {
  private bus = new EventBus();
  private registrations = new Map<Node, ScriptRule[]>();
  private tree: SceneTree;
  private logs: string[] = [];
  private namedScripts = new Map<string, { node: Node; script: ScriptRule }>();

  constructor(tree: SceneTree) {
    this.tree = tree;
  }

  unregisterNodeById(id: string): void {
    for (const [node, scripts] of this.registrations) {
      if (node.id === id) {
        this.registrations.delete(node);
        break;
      }
    }
  }

  registerNode(node: Node): void {
    if (node.scripts.length === 0) return;
    this.registrations.set(node, node.scripts);
    // Index named scripts for call action
    for (const script of node.scripts) {
      if (script.name) {
        this.namedScripts.set(script.name, { node, script });
      }
    }
  }

  registerTree(): void {
    this.registrations.clear();
    this.namedScripts.clear();
    this.tree.traverse((node) => {
      this.registerNode(node);
    });
  }

  evaluateEvent(event: string, data: Record<string, unknown> = {}): void {
    for (const [node, scripts] of this.registrations) {
      for (const script of scripts) {
        if (script.event !== event) continue;
        if (script.filter && !matchFilter(script.filter, data)) continue;
        if (script.condition && !evaluateCondition(node.properties, script.condition, data)) continue;
        for (const action of script.actions) {
          this.executeAction(node, action, data);
        }
      }
    }
  }

  getEventBus(): EventBus {
    return this.bus;
  }

  getLogs(): string[] {
    return [...this.logs];
  }

  clearLogs(): void {
    this.logs = [];
  }

  private executeAction(node: Node, action: ScriptAction, context: Record<string, unknown>): void {
    if (action.set !== undefined) {
      const value = evaluateExpression(action.to, node.properties, context);
      node.setPropertyByPath(action.set, value);
    } else if (action.move) {
      const dx = evaluateExpression(action.move.x, node.properties, context) as number ?? 0;
      const dy = evaluateExpression(action.move.y, node.properties, context) as number ?? 0;
      const x = (node.getProperty('x') as number ?? 0) + dx;
      const y = (node.getProperty('y') as number ?? 0) + dy;
      node.setProperty('x', x);
      node.setProperty('y', y);
    } else if (action.destroy) {
      const path = evaluateExpression(action.destroy, node.properties, context) as string;
      try { this.tree.remove(path); } catch { /* node may already be gone */ }
    } else if (action.emit) {
      const eventData = action.data as Record<string, unknown> | undefined;
      this.bus.emit(action.emit, eventData ?? {});
    } else if (action.log) {
      const msg = evaluateExpression(action.log, node.properties, context) as string;
      this.logs.push(msg);
    } else if (action.spawn) {
      this.executeSpawn(node, action, context);
    } else if (action.call) {
      this.executeCall(action, context);
    } else if (action.play) {
      this.executePlay(node, action, context);
    } else if (action.stop) {
      this.executeStop(node, action, context);
    }
  }

  private executeSpawn(node: Node, action: ScriptAction, context: Record<string, unknown>): void {
    const spawnExpr = action.spawn ?? '';
    const spawnType = evaluateExpression(spawnExpr, node.properties, context) as string;
    const spawnId = action.as ?? `${spawnType}_${Date.now()}`;
    const atX = action.at?.x !== undefined ? (evaluateExpression(action.at.x, node.properties, context) as number) : (node.getProperty('x') as number ?? 0);
    const atY = action.at?.y !== undefined ? (evaluateExpression(action.at.y, node.properties, context) as number) : (node.getProperty('y') as number ?? 0);

    try {
      const spawned = createNodeByType(spawnType, spawnId, { x: atX, y: atY });
      // Add scripts from data if provided
      this.tree.add('/', spawned);
      this.registerNode(spawned);
    } catch {
      // unknown type or tree error — skip
    }
  }

  private executeCall(action: ScriptAction, context: Record<string, unknown>): void {
    const scriptName = action.call ?? '';
    const entry = this.namedScripts.get(scriptName);
    if (!entry) return;
    const { node, script } = entry;
    if (script.condition && !evaluateCondition(node.properties, script.condition, context)) return;
    for (const a of script.actions) {
      this.executeAction(node, a, context);
    }
  }

  private executePlay(node: Node, action: ScriptAction, _context: Record<string, unknown>): void {
    const targetPath = evaluateExpression(action.play, node.properties, _context) as string;
    try {
      const target = this.tree.get(targetPath);
      target.setProperty('playing', true);
      if (action.from !== undefined) {
        target.setProperty('frame', action.from);
      }
    } catch { /* ignore */ }
  }

  private executeStop(node: Node, action: ScriptAction, _context: Record<string, unknown>): void {
    const targetPath = evaluateExpression(action.stop, node.properties, _context) as string;
    try {
      const target = this.tree.get(targetPath);
      target.setProperty('playing', false);
    } catch { /* ignore */ }
  }
}

function matchFilter(filter: Record<string, unknown>, data: Record<string, unknown>): boolean {
  for (const [key, value] of Object.entries(filter)) {
    if (key === 'with') {
      // Match by direct with value, or by other node id, or by tag
      if (data['with'] === value) continue;
      if (data['other'] === value) continue;
      const tags = data['otherTags'] as string[] | undefined;
      if (Array.isArray(tags) && tags.includes(value as string)) continue;
      return false;
    }
    if (data[key] !== value) return false;
  }
  return true;
}
