import type { PropertyMap } from './types.js';

export function evaluateExpression(
  template: unknown,
  properties: PropertyMap,
  context: Record<string, unknown> = {},
): unknown {
  if (typeof template !== 'string') return template;
  if (!template.includes('{{')) return template;

  // If the entire template is a single expression, return raw value
  const singleMatch = template.match(/^\{\{(.+?)\}\}$/);
  if (singleMatch) {
    return resolveExpr(singleMatch[1].trim(), properties, context);
  }

  // Otherwise interpolate into string
  return template.replace(/\{\{(.+?)\}\}/g, (_, expr: string) => {
    return String(resolveExpr(expr.trim(), properties, context));
  });
}

function resolveExpr(expr: string, properties: PropertyMap, context: Record<string, unknown>): unknown {
  // Built-in functions
  const randomMatch = expr.match(/^random\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)$/);
  if (randomMatch) {
    const min = parseFloat(randomMatch[1]);
    const max = parseFloat(randomMatch[2]);
    return min + Math.random() * (max - min);
  }

  // Negated property reference: -speed
  if (expr.startsWith('-')) {
    const val = getPropertyRef(expr.slice(1), properties, context);
    return typeof val === 'number' ? -val : val;
  }

  // Simple arithmetic: x + 10, speed * 2, x + speed
  const arithMatch = expr.match(/^([\w.]+)\s*([+\-*/%])\s*([\w.]+|-?\d+(?:\.\d+)?)$/);
  if (arithMatch) {
    const left = getPropertyRef(arithMatch[1], properties, context);
    const rightStr = arithMatch[3];
    const right = /^\d/.test(rightStr) ? parseFloat(rightStr) : getPropertyRef(rightStr, properties, context);
    const op = arithMatch[2];
    if (typeof left === 'number' && typeof right === 'number') {
      switch (op) {
        case '+': return left + right;
        case '-': return left - right;
        case '*': return left * right;
        case '/': return left / right;
        case '%': return left % right;
      }
    }
    return left;
  }

  // Simple property reference
  return getPropertyRef(expr, properties, context);
}

function getPropertyRef(ref: string, properties: PropertyMap, context: Record<string, unknown>): unknown {
  // Context references: other, other.id, other.x
  if (ref === 'other') return context['other'];
  if (ref.startsWith('other.')) return context[ref.slice(6)];
  if (ref.startsWith('context.')) return context[ref.slice(8)];

  const parts = ref.split('.');
  let current: unknown = properties;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') return undefined;
    current = (current as PropertyMap)[part];
  }
  return current;
}
