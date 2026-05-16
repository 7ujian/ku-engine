import { SceneTree } from './scene-tree.js';

export interface CollisionPair {
  nodeA: string;
  nodeB: string;
}

type CollisionCallback = (event: string, data: Record<string, unknown>) => void;

export class CollisionEvents {
  private prevPairs = new Map<string, CollisionPair>();
  private prevAreaPairs = new Map<string, CollisionPair>();
  private tree: SceneTree;
  private onCollision: CollisionCallback;

  constructor(tree: SceneTree, onCollision: CollisionCallback) {
    this.tree = tree;
    this.onCollision = onCollision;
  }

  /** Call each frame with current collision pairs. Fires callback for on_collision (enter) and on_collision_exit. */
  update(currentPairs: CollisionPair[]): void {
    const currentKeys = new Set<string>();

    for (const pair of currentPairs) {
      const key = pairKey(pair.nodeA, pair.nodeB);
      currentKeys.add(key);
      const isNew = !this.prevPairs.has(key);

      if (isNew) {
        this.fireCollision('on_collision', pair);
      }

      this.prevPairs.set(key, pair);
    }

    // Check for exits (pairs that were in prev but not in current)
    for (const [key, pair] of this.prevPairs) {
      if (!currentKeys.has(key)) {
        this.fireCollision('on_collision_exit', pair);
        this.prevPairs.delete(key);
      }
    }
  }

  /** Call each frame with current area overlaps. Fires on_area_enter and on_area_exit. */
  updateAreas(currentPairs: CollisionPair[]): void {
    const currentKeys = new Set<string>();

    for (const pair of currentPairs) {
      const key = pairKey(pair.nodeA, pair.nodeB);
      currentKeys.add(key);
      const isNew = !this.prevAreaPairs.has(key);

      if (isNew) {
        this.fireCollision('on_area_enter', pair);
      }

      this.prevAreaPairs.set(key, pair);
    }

    for (const [key, pair] of this.prevAreaPairs) {
      if (!currentKeys.has(key)) {
        this.fireCollision('on_area_exit', pair);
        this.prevAreaPairs.delete(key);
      }
    }
  }

  reset(): void {
    this.prevPairs.clear();
    this.prevAreaPairs.clear();
  }

  private fireCollision(event: string, pair: CollisionPair): void {
    let tagsA: string[] = [];
    let tagsB: string[] = [];
    try { tagsA = this.tree.get(pair.nodeA).getProperty('tags') as string[] ?? []; } catch { /* ignore */ }
    try { tagsB = this.tree.get(pair.nodeB).getProperty('tags') as string[] ?? []; } catch { /* ignore */ }

    this.onCollision(event, { node: pair.nodeA, other: pair.nodeB, otherTags: tagsB });
    this.onCollision(event, { node: pair.nodeB, other: pair.nodeA, otherTags: tagsA });
  }
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}
