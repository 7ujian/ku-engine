import type { PropertyMap } from './types.js';
import type { SceneTree } from './scene-tree.js';

export interface ResolverContext {
  properties: PropertyMap;
  context: Record<string, unknown>;
  tree?: SceneTree;
}

export function resolveSymbol(ref: string, ctx: ResolverContext): unknown {
  // Cross-node reference: /player/x or /player/velocity.x
  if (ref.startsWith('/')) {
    const slashIdx = ref.indexOf('/', 1);
    if (slashIdx === -1) return undefined;
    const nodeId = ref.slice(1, slashIdx);
    const propPath = ref.slice(slashIdx + 1);
    if (!ctx.tree) return undefined;
    try {
      const node = ctx.tree.get(nodeId);
      const parts = propPath.split('.');
      let current: unknown = node.properties;
      for (const part of parts) {
        if (current == null || typeof current !== 'object') return undefined;
        current = (current as PropertyMap)[part];
      }
      return current;
    } catch {
      return undefined;
    }
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
