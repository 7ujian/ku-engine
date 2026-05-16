import Matter from 'matter-js';
import { SceneTree } from './scene-tree.js';
import { Node } from './node.js';
import type { PropertyMap } from './types.js';

export class PhysicsWorld {
  private engine: Matter.Engine;
  private bodyMap = new Map<string, Matter.Body>();
  private tree: SceneTree;

  constructor(tree: SceneTree) {
    this.tree = tree;
    this.engine = Matter.Engine.create();
    this.engine.gravity.y = 0;
    this.engine.gravity.scale = 0.003;
  }

  syncFromTree(): void {
    this.tree.traverse((node) => {
      if (node.type === 'RigidBody') {
        this.syncBody(node);
      } else if (node.type === 'CollisionShape') {
        this.syncShape(node);
      } else if (node.type === 'Area') {
        this.syncArea(node);
      }
    });
  }

  step(dt: number): void {
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

    Matter.Engine.update(this.engine, dt);
    this.syncToTree();
  }

  applyNodeChanges(): void {
    for (const [nodeId, body] of this.bodyMap) {
      try {
        const node = this.tree.get(nodeId);
        const nx = (node.getProperty('x') as number);
        const ny = (node.getProperty('y') as number);
        // Sync position (for teleport/move by scripts)
        if (nx !== undefined && ny !== undefined) {
          Matter.Body.setPosition(body, { x: nx, y: ny });
        }
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

  syncToTree(): void {
    for (const [nodeId, body] of this.bodyMap) {
      try {
        const node = this.tree.get(nodeId);
        node.setProperty('x', body.position.x);
        node.setProperty('y', body.position.y);
        node.setPropertyByPath('velocity.x', body.velocity.x);
        node.setPropertyByPath('velocity.y', body.velocity.y);
      } catch {
        // node was removed during step
      }
    }
  }

  getCollisions(): Array<{ nodeA: string; nodeB: string }> {
    const bodies = Matter.Composite.allBodies(this.engine.world);
    const detector = Matter.Detector.create({ bodies });
    const collisions: Array<{ nodeA: string; nodeB: string }> = [];
    const events = Matter.Detector.collisions(detector);
    for (const pair of events) {
      // Skip sensor-only overlaps (Area nodes)
      if (pair.bodyA.isSensor && pair.bodyB.isSensor) continue;
      const idA = pair.bodyA.label;
      const idB = pair.bodyB.label;
      if (idA && idB) {
        collisions.push({ nodeA: idA, nodeB: idB });
      }
    }
    return collisions;
  }

  getAreaOverlaps(): Array<{ nodeA: string; nodeB: string }> {
    const bodies = Matter.Composite.allBodies(this.engine.world);
    const detector = Matter.Detector.create({ bodies });
    const overlaps: Array<{ nodeA: string; nodeB: string }> = [];
    const events = Matter.Detector.collisions(detector);
    for (const pair of events) {
      // Only include pairs where at least one body is a sensor (Area)
      if (!pair.bodyA.isSensor && !pair.bodyB.isSensor) continue;
      const idA = pair.bodyA.label;
      const idB = pair.bodyB.label;
      if (idA && idB) {
        overlaps.push({ nodeA: idA, nodeB: idB });
      }
    }
    return overlaps;
  }

  private syncBody(node: Node): void {
    const existing = this.bodyMap.get(node.id);
    const x = (node.getProperty('x') as number) ?? 0;
    const y = (node.getProperty('y') as number) ?? 0;
    const mass = (node.getProperty('mass') as number) ?? 1;
    const w = (node.getProperty('width') as number) ?? 32;
    const h = (node.getProperty('height') as number) ?? 32;
    const gravityScale = (node.getProperty('gravity_scale') as number) ?? 1;

    if (existing) {
      Matter.Body.setPosition(existing, { x, y });
      return;
    }

    const body = Matter.Bodies.rectangle(x, y, w, h, {
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
    // CollisionShapes are static bodies
    const existing = this.bodyMap.get(node.id);
    const parentPath = this.getParentPath(node);
    let x = (node.getProperty('x') as number) ?? 0;
    let y = (node.getProperty('y') as number) ?? 0;

    if (parentPath) {
      try {
        const parent = this.tree.get(parentPath);
        x += (parent.getProperty('x') as number) ?? 0;
        y += (parent.getProperty('y') as number) ?? 0;
      } catch { /* ignore */ }
    }

    if (existing) {
      Matter.Body.setPosition(existing, { x, y });
      return;
    }

    const shape = (node.getProperty('shape') as string) ?? 'rect';
    const width = (node.getProperty('width') as number) ?? 32;
    const height = (node.getProperty('height') as number) ?? 32;

    let body: Matter.Body;
    const collisionFilter = {
      category: (node.getProperty('collision_layer') as number) ?? 0x0001,
      mask: (node.getProperty('collision_mask') as number) ?? 0xFFFF,
    };
    if (shape === 'circle') {
      const radius = (node.getProperty('radius') as number) ?? 16;
      body = Matter.Bodies.circle(x, y, radius, { label: node.id, isStatic: true, collisionFilter });
    } else {
      body = Matter.Bodies.rectangle(x, y, width, height, { label: node.id, isStatic: true, collisionFilter });
    }

    Matter.Composite.add(this.engine.world, body);
    this.bodyMap.set(node.id, body);
  }

  private syncArea(node: Node): void {
    const existing = this.bodyMap.get(node.id);
    const x = (node.getProperty('x') as number) ?? 0;
    const y = (node.getProperty('y') as number) ?? 0;
    const width = (node.getProperty('width') as number) ?? 32;
    const height = (node.getProperty('height') as number) ?? 32;

    if (existing) {
      Matter.Body.setPosition(existing, { x, y });
      return;
    }

    const body = Matter.Bodies.rectangle(x, y, width, height, {
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

  private getParentPath(_node: Node): string | null {
    let found = false;
    let parentPath: string | null = null;
    this.tree.traverse((node, path) => {
      if (found) return;
      if (node === _node) {
        const lastSlash = path.lastIndexOf('/');
        parentPath = lastSlash <= 0 ? null : path.slice(0, lastSlash);
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
  }

  syncNode(node: Node): void {
    if (node.type === 'RigidBody') this.syncBody(node);
    else if (node.type === 'CollisionShape') this.syncShape(node);
    else if (node.type === 'Area') this.syncArea(node);
  }

  destroy(): void {
    Matter.Engine.clear(this.engine);
    this.bodyMap.clear();
  }
}
