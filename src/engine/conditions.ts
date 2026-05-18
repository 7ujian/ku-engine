import type { PropertyMap } from './types.js';
import type { SceneTree } from './scene-tree.js';
import { resolveSymbol, type ResolverContext } from './resolve-symbol.js';

type Operator = 'eq' | 'neq' | 'gt' | 'lt' | 'gte' | 'lte' | 'in' | 'between';

export function evaluateCondition(
  node: PropertyMap,
  condition: Record<string, Record<string, unknown>>,
  context: Record<string, unknown> = {},
  tree?: SceneTree,
): boolean {
  const resolverCtx: ResolverContext = { properties: node, context, tree };
  for (const [propPath, ops] of Object.entries(condition)) {
    const value = resolveSymbol(propPath, resolverCtx);
    for (const [op, target] of Object.entries(ops)) {
      if (!applyOperator(op as Operator, value, target)) return false;
    }
  }
  return true;
}

function applyOperator(op: Operator, value: unknown, target: unknown): boolean {
  switch (op) {
    case 'eq': return value === target;
    case 'neq': return value !== target;
    case 'gt': return typeof value === 'number' && typeof target === 'number' && value > target;
    case 'lt': return typeof value === 'number' && typeof target === 'number' && value < target;
    case 'gte': return typeof value === 'number' && typeof target === 'number' && value >= target;
    case 'lte': return typeof value === 'number' && typeof target === 'number' && value <= target;
    case 'in': return Array.isArray(target) && target.includes(value);
    case 'between': {
      if (!Array.isArray(target) || target.length !== 2) return false;
      return typeof value === 'number' && value >= (target[0] as number) && value <= (target[1] as number);
    }
    default: return false;
  }
}
