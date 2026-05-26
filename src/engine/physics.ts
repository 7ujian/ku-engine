import Matter from 'matter-js';
import { SceneTree } from './scene-tree.js';
import { Node } from './node.js';
import type { PropertyMap } from './types.js';
import { getWorldTransform, worldToLocal, getLocalTransform } from './transform.js';

export const PHYSICS_PROPERTIES = new Set([
  'x', 'y', 'velocity.x', 'velocity.y', 'rotation', 'scale_x', 'scale_y',
]);

export class PhysicsWorld {
  private engine: Matter.Engine;
  private bodyMap = new Map<string, Matter.Body>();
  private parentCache = new Map<string, string | null>();
  private tree: SceneTree;
  private detector: Matter.Detector | null = null;
  private cachedCollisions: Array<{ nodeA: string; nodeB: string }> | null = null;
  private cachedAreaOverlaps: Array<{ nodeA: string; nodeB: string }> | null = null;

  constructor(tree: SceneTree) {
    this.tree = tree;
    this.engine = Matter.Engine.create();
    this.engine.gravity.y = 0;
    this.engine.gravity.scale = 0.003;
  }

  syncFromTree(): void {
    this.parentCache.clear();
    this.bodyMap.clear();
    this.tree.traverse((node, path) => {
      const lastSlash = path.lastIndexOf('/');
      this.parentCache.set(node.id, lastSlash <= 0 ? null : path.slice(0, lastSlash));

      if (node.type === 'RigidBody') this.syncBody(node);
      else if (node.type === 'CollisionShape') this.syncShape(node);
      else if (node.type === 'Area') this.syncArea(node);
    });
  }

  step(dt: number): void {
    this.cachedCollisions = null;
    this.cachedAreaOverlaps = null;

    // Apply per-body gravity before Engine.update so positions reflect it
    const gScale = this.engine.gravity.scale;
    for (const body of this.bodyMap.values()) {
      if (body.isStatic) continue;
      const gs = (body.plugin as Record<string, unknown> | undefined)?.gravityScale as number ?? 1;
      if (gs !== 0) {
        Matter.Body.setVelocity(body, {
          x: body.velocity.x,
          y: body.velocity.y + gs * gScale * dt,
        });
      }
    }

    // Reposition child shapes to follow their parent rigid bodies
    this.syncChildShapes();

    Matter.Engine.update(this.engine, dt);
    this.syncToTree();
    // Final child shape sync after physics update
    this.syncChildShapes();
  }

  applyNodeChanges(): void {
    for (const [nodeId, body] of this.bodyMap) {
      try {
        const node = this.tree.get(nodeId);
        // Skip child CollisionShapes whose parent is a RigidBody — position is derived
        if (node.type === 'CollisionShape' && node.parent && this.bodyMap.has(node.parent.id)) continue;
        // Read local position, convert to world for physics body
        const world = getWorldTransform(node);
        Matter.Body.setPosition(body, { x: world.x, y: world.y });
        // Sync velocity (for impulses/flaps by scripts)
        const vx = (node.getPropertyByPath('velocity.x') as number);
        const vy = (node.getPropertyByPath('velocity.y') as number);
        if (vx !== undefined || vy !== undefined) {
          Matter.Body.setVelocity(body, { x: vx ?? body.velocity.x, y: vy ?? body.velocity.y });
        }
      } catch {
        // node removed
      }
    }
  }

  private syncChildShapes(): void {
    for (const [nodeId, body] of this.bodyMap) {
      try {
        const node = this.tree.get(nodeId);
        if (node.type !== 'CollisionShape') continue;

        const parent = node.parent;
        if (!parent) continue;

        const parentBody = this.bodyMap.get(parent.id);
        // Only sync shapes whose parent has a physics body (RigidBody).
        // Root-level shapes manage their own positions via scripts/physics.
        if (!parentBody) continue;

        const parentWorld = getWorldTransform(parent);
        const parentX = parentBody.position.x;
        const parentY = parentBody.position.y;
        const parentRotation = parentBody.angle;
        const parentScaleX = parentWorld.scaleX;
        const parentScaleY = parentWorld.scaleY;
        const offsetX = (node.getProperty('x') as number) ?? 0;
        const offsetY = (node.getProperty('y') as number) ?? 0;

        const cosR = Math.cos(parentRotation);
        const sinR = Math.sin(parentRotation);
        Matter.Body.setPosition(body, {
          x: parentX + cosR * offsetX * parentScaleX - sinR * offsetY * parentScaleY,
          y: parentY + sinR * offsetX * parentScaleX + cosR * offsetY * parentScaleY,
        });
      } catch {
        // node removed
      }
    }
  }

  syncToTree(): void {
    for (const [nodeId, body] of this.bodyMap) {
      try {
        const node = this.tree.get(nodeId);
        // Skip child shapes of RigidBody — position is derived from parent
        if (node.type === 'CollisionShape' && node.parent && this.bodyMap.has(node.parent.id)) continue;
        const local = worldToLocal(node, body.position.x, body.position.y);
        node.setProperty('x', local.x);
        node.setProperty('y', local.y);
        node.setPropertyByPath('velocity.x', body.velocity.x);
        node.setPropertyByPath('velocity.y', body.velocity.y);
      } catch {
        // node was removed during step
      }
    }
  }

  getCollisions(): Array<{ nodeA: string; nodeB: string }> {
    if (!this.cachedCollisions) this.detectAll();
    return this.cachedCollisions!;
  }

  getAreaOverlaps(): Array<{ nodeA: string; nodeB: string }> {
    if (!this.cachedAreaOverlaps) this.detectAll();
    return this.cachedAreaOverlaps!;
  }

  /** Run collision detection once, cache results for both getCollisions and getAreaOverlaps */
  private detectAll(): void {
    const bodies = Matter.Composite.allBodies(this.engine.world);
    if (!this.detector) {
      this.detector = Matter.Detector.create({ bodies });
    } else {
      Matter.Detector.setBodies(this.detector, bodies);
    }
    const events = Matter.Detector.collisions(this.detector);
    const collisions: Array<{ nodeA: string; nodeB: string }> = [];
    const overlaps: Array<{ nodeA: string; nodeB: string }> = [];
    for (const pair of events) {
      const idA = pair.bodyA.label;
      const idB = pair.bodyB.label;
      if (!idA || !idB) continue;
      if (pair.bodyA.isSensor && pair.bodyB.isSensor) {
        overlaps.push({ nodeA: idA, nodeB: idB });
      } else if (!pair.bodyA.isSensor && !pair.bodyB.isSensor) {
        collisions.push({ nodeA: idA, nodeB: idB });
      } else {
        // One sensor, one non-sensor → area overlap
        overlaps.push({ nodeA: idA, nodeB: idB });
      }
    }
    this.cachedCollisions = collisions;
    this.cachedAreaOverlaps = overlaps;
  }

  /** Invalidate cached collision results (call after physics step) */
  invalidateCollisionCache(): void {
    this.cachedCollisions = null;
    this.cachedAreaOverlaps = null;
  }

  private syncBody(node: Node): void {
    const existing = this.bodyMap.get(node.id);
    const world = getWorldTransform(node);
    const wx = world.x;
    const wy = world.y;
    const mass = (node.getProperty('mass') as number) ?? 1;
    const w = (node.getProperty('width') as number) ?? 32;
    const h = (node.getProperty('height') as number) ?? 32;
    const gravityScale = (node.getProperty('gravity_scale') as number) ?? 1;

    if (existing) {
      Matter.Body.setPosition(existing, { x: wx, y: wy });
      // Sync velocity from node props; fall back to current body velocity if unset
      const vx = (node.getPropertyByPath('velocity.x') as number) ?? existing.velocity.x;
      const vy = (node.getPropertyByPath('velocity.y') as number) ?? existing.velocity.y;
      Matter.Body.setVelocity(existing, { x: vx, y: vy });
      return;
    }

    const body = Matter.Bodies.rectangle(wx, wy, w, h, {
      label: node.id,
      mass,
      plugin: { gravityScale },
      collisionFilter: {
        category: (node.getProperty('collision_layer') as number) ?? 0x0001,
        mask: (node.getProperty('collision_mask') as number) ?? 0xFFFF,
      },
    });

    // Sync initial velocity
    const vx = (node.getPropertyByPath('velocity.x') as number) ?? 0;
    const vy = (node.getPropertyByPath('velocity.y') as number) ?? 0;
    Matter.Body.setVelocity(body, { x: vx, y: vy });

    Matter.Composite.add(this.engine.world, body);
    this.bodyMap.set(node.id, body);
  }

  private syncShape(node: Node): void {
    const existing = this.bodyMap.get(node.id);
    const world = getWorldTransform(node);
    const wx = world.x;
    const wy = world.y;

    if (existing) {
      Matter.Body.setPosition(existing, { x: wx, y: wy });
      return;
    }

    const shape = (node.getProperty('shape') as string) ?? 'rect';
    const width = (node.getProperty('width') as number) ?? 32;
    const height = (node.getProperty('height') as number) ?? 32;
    const isStatic = !(node.getProperty('dynamic') as boolean);

    let body: Matter.Body;
    const collisionFilter = {
      category: (node.getProperty('collision_layer') as number) ?? 0x0001,
      mask: (node.getProperty('collision_mask') as number) ?? 0xFFFF,
    };
    if (shape === 'circle') {
      const radius = (node.getProperty('radius') as number) ?? 16;
      body = Matter.Bodies.circle(wx, wy, radius, { label: node.id, isStatic, collisionFilter });
    } else {
      body = Matter.Bodies.rectangle(wx, wy, width, height, { label: node.id, isStatic, collisionFilter });
    }

    if (!isStatic) {
      body.plugin = { gravityScale: 0 };
    }

    Matter.Composite.add(this.engine.world, body);
    this.bodyMap.set(node.id, body);
  }

  private syncArea(node: Node): void {
    const existing = this.bodyMap.get(node.id);
    const world = getWorldTransform(node);
    const wx = world.x;
    const wy = world.y;
    const width = (node.getProperty('width') as number) ?? 32;
    const height = (node.getProperty('height') as number) ?? 32;

    if (existing) {
      Matter.Body.setPosition(existing, { x: wx, y: wy });
      return;
    }

    const body = Matter.Bodies.rectangle(wx, wy, width, height, {
      label: node.id,
      isStatic: true,
      isSensor: true,
      collisionFilter: {
        category: (node.getProperty('collision_layer') as number) ?? 0x0001,
        mask: (node.getProperty('collision_mask') as number) ?? 0xFFFF,
      },
    });
    Matter.Composite.add(this.engine.world, body);
    this.bodyMap.set(node.id, body);
  }

  private getParentPathCached(node: Node): string | null {
    if (this.parentCache.has(node.id)) return this.parentCache.get(node.id) ?? null;
    // Fallback: find via traversal
    let found = false;
    let parentPath: string | null = null;
    this.tree.traverse((n, path) => {
      if (found) return;
      if (n === node) {
        const lastSlash = path.lastIndexOf('/');
        parentPath = lastSlash <= 0 ? null : path.slice(0, lastSlash);
        this.parentCache.set(node.id, parentPath);
        found = true;
      }
    });
    return parentPath;
  }

  setGravity(scale: number): void {
    this.engine.gravity.y = scale;
  }

  removeBody(nodeId: string): void {
    const body = this.bodyMap.get(nodeId);
    if (body) {
      Matter.Composite.remove(this.engine.world, body);
      this.bodyMap.delete(nodeId);
    }
    this.parentCache.delete(nodeId);
  }

  syncNode(node: Node): void {
    // Ensure parent cache is populated for this node
    if (!this.parentCache.has(node.id)) {
      let found = false;
      this.tree.traverse((n, path) => {
        if (found) return;
        if (n === node) {
          const lastSlash = path.lastIndexOf('/');
          this.parentCache.set(node.id, lastSlash <= 0 ? null : path.slice(0, lastSlash));
          found = true;
        }
      });
    }
    if (node.type === 'RigidBody') this.syncBody(node);
    else if (node.type === 'CollisionShape') this.syncShape(node);
    else if (node.type === 'Area') this.syncArea(node);
  }

  destroy(): void {
    Matter.Engine.clear(this.engine);
    this.bodyMap.clear();
    this.parentCache.clear();
    this.detector = null;
    this.cachedCollisions = null;
    this.cachedAreaOverlaps = null;
  }
}
