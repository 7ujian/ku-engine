import type { PropertyMap } from './types.js';

type Operator = 'eq' | 'neq' | 'gt' | 'lt' | 'gte' | 'lte' | 'in' | 'between';

export function evaluateCondition(
  node: PropertyMap,
  condition: Record<string, Record<string, unknown>>,
  context: Record<string, unknown> = {},
): boolean {
  for (const [propPath, ops] of Object.entries(condition)) {
    const value = resolveValue(node, propPath, context);
    for (const [op, target] of Object.entries(ops)) {
      if (!applyOperator(op as Operator, value, target)) return false;
    }
  }
  return true;
}

function resolveValue(node: PropertyMap, propPath: string, context: Record<string, unknown>): unknown {
  if (propPath.startsWith('context.')) {
    return context[propPath.slice(8)];
  }
  const parts = propPath.split('.');
  let current: unknown = node;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') return undefined;
    current = (current as PropertyMap)[part];
  }
  return current;
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
