import type { PropertyMap } from './types.js';
import type { SceneTree } from './scene-tree.js';

export interface ResolverContext {
  properties: PropertyMap;
  context: Record<string, unknown>;
  tree?: SceneTree;
}

export function resolveSymbol(ref: string, ctx: ResolverContext): unknown {
  // Cross-node reference: /path/to/node/prop or /path/to/node/prop.nested
  if (ref.startsWith('/')) {
    // Find the last segment — it could be a property or part of the node path
    // Split on / then try resolving from longest path to shortest
    const segments = ref.slice(1).split('/');
    if (segments.length < 2 || !ctx.tree) return undefined;
    // Try: last segment is property, rest is node path
    // Then: last two are property (if single-char fail), rest is node path
    for (let propCount = 1; propCount < segments.length; propCount++) {
      const nodePath = '/' + segments.slice(0, segments.length - propCount).join('/');
      const propPath = segments.slice(segments.length - propCount).join('.');
      try {
        const node = ctx.tree.get(nodePath);
        if (!node) continue;
        const parts = propPath.split('.');
        let current: unknown = node.properties;
        for (const part of parts) {
          if (current == null || typeof current !== 'object') return undefined;
          current = (current as PropertyMap)[part];
        }
        return current;
      } catch {
        continue;
      }
    }
    return undefined;
  }

  // Context references
  if (ref === 'other') return ctx.context['other'];
  if (ref.startsWith('other.')) {
    const path = ref.slice(6);
    const parts = path.split('.');
    let current: unknown = ctx.context;
    for (const part of parts) {
      if (current == null || typeof current !== 'object') return undefined;
      current = (current as Record<string, unknown>)[part];
    }
    return current;
  }
  if (ref.startsWith('context.')) {
    const path = ref.slice(8);
    const parts = path.split('.');
    let current: unknown = ctx.context;
    for (const part of parts) {
      if (current == null || typeof current !== 'object') return undefined;
      current = (current as Record<string, unknown>)[part];
    }
    return current;
  }

  // Local property (dot-path supported)
  const parts = ref.split('.');
  let current: unknown = ctx.properties;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as PropertyMap)[part];
  }
  return current;
}
