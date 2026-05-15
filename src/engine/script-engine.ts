import { Node } from './node.js';
import { SceneTree } from './scene-tree.js';
import { EventBus } from './event-bus.js';
import { evaluateExpression } from './expression-evaluator.js';
import { evaluateCondition } from './conditions.js';
import type { ScriptRule, ScriptAction, PropertyMap } from './types.js';

export class ScriptEngine {
  private bus = new EventBus();
  private registrations = new Map<Node, ScriptRule[]>();
  private tree: SceneTree;
  private logs: string[] = [];

  constructor(tree: SceneTree) {
    this.tree = tree;
  }

  registerNode(node: Node): void {
    if (node.scripts.length === 0) return;
    this.registrations.set(node, node.scripts);
  }

  registerTree(): void {
    this.registrations.clear();
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
    }
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
