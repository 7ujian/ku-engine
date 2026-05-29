import Matter from 'matter-js';
import { SceneTree } from './scene-tree.js';
import { Node } from './node.js';
import type { PropertyMap, TiledLayerData, MergedCollision } from './types.js';
import { getWorldTransform, worldToLocal } from './transform.js';
import { buildMergedCollisions } from './tiled-collision.js';
import type { Profiler } from './profiler.js';

export const PHYSICS_PROPERTIES = new Set([
  'x', 'y', 'velocity.x', 'velocity.y', 'rotation', 'scale_x', 'scale_y',
]);

interface BodyEntry {
  body: Matter.Body;
  node: Node;
}

export class PhysicsWorld {
  private engine: Matter.Engine;
  private entries = new Map<string, BodyEntry>();
  private childShapeIds = new Set<string>();
  private tree: SceneTree;
  private currentCollisions: Array<{ nodeA: string; nodeB: string }> = [];
  private currentAreaOverlaps: Array<{ nodeA: string; nodeB: string }> = [];
  private profiler: Profiler | null = null;

  constructor(tree: SceneTree) {
    this.tree = tree;
    this.engine = Matter.Engine.create();
    this.engine.gravity.y = 0;
    this.engine.gravity.scale = 0.003;

    Matter.Events.on(this.engine, 'collisionActive', (event) => {
      for (const pair of event.pairs) {
        const idA = pair.bodyA.label;
        const idB = pair.bodyB.label;
        if (!idA || !idB) continue;
        if (pair.bodyA.isStatic && pair.bodyB.isStatic) continue;
        if (pair.isSensor) {
          this.currentAreaOverlaps.push({ nodeA: idA, nodeB: idB });
        } else {
          this.currentCollisions.push({ nodeA: idA, nodeB: idB });
        }
      }
    });
  }

  setProfiler(p: Profiler): void {
    this.profiler = p;
  }

  get bodyCount(): number {
    return this.entries.size;
  }

  getBody(nodeId: string): Matter.Body | undefined {
    return this.entries.get(nodeId)?.body;
  }

  getDebugBodies(): Array<{
    x: number; y: number;
    width: number; height: number;
    isSensor: boolean; isStatic: boolean;
    label: string;
    circleRadius?: number;
    vertices?: Array<{ x: number; y: number }>;
    parts?: Array<{
      x: number; y: number;
      width: number; height: number;
      circleRadius?: number;
      vertices?: Array<{ x: number; y: number }>;
    }>;
  }> {
    const result: Array<{
      x: number; y: number;
      width: number; height: number;
      isSensor: boolean; isStatic: boolean;
      label: string;
      circleRadius?: number;
      vertices?: Array<{ x: number; y: number }>;
      parts?: Array<{
        x: number; y: number;
        width: number; height: number;
        circleRadius?: number;
        vertices?: Array<{ x: number; y: number }>;
      }>;
    }> = [];
    for (const entry of this.entries.values()) {
      const b = entry.body;
      const base: typeof result[0] = {
        x: b.position.x,
        y: b.position.y,
        width: 0, height: 0,
        isSensor: b.isSensor,
        isStatic: b.isStatic,
        label: b.label,
      };
      if (b.parts.length > 1) {
        base.parts = b.parts.slice(1).map((p: Matter.Body) => {
          const part: NonNullable<typeof base.parts>[0] = {
            x: p.position.x,
            y: p.position.y,
            width: p.bounds.max.x - p.bounds.min.x,
            height: p.bounds.max.y - p.bounds.min.y,
          };
          if (p.circleRadius) {
            part.circleRadius = p.circleRadius;
          }
          if (p.vertices.length > 2) {
            part.vertices = p.vertices.map((v: Matter.Vector) => ({ x: v.x, y: v.y }));
          }
          return part;
        });
      } else {
        if (b.circleRadius) {
          base.circleRadius = b.circleRadius;
        }
        if (b.vertices.length > 2) {
          base.vertices = b.vertices.map((v: Matter.Vector) => ({ x: v.x, y: v.y }));
        }
      }
      base.width = b.bounds.max.x - b.bounds.min.x;
      base.height = b.bounds.max.y - b.bounds.min.y;
      result.push(base);
    }
    return result;
  }

  syncFromTree(): void {
    this.entries.clear();
    this.childShapeIds.clear();
    this.tree.traverse((node, _path) => this.syncNode(node));
  }

  step(dt: number): void {
    this.currentCollisions = [];
    this.currentAreaOverlaps = [];

    const m = this.profiler ? (n: string, fn: () => void) => this.profiler!.measure(n, fn) : (_n: string, fn: () => void) => fn();

    m('phys.gravity', () => {
      const gScale = this.engine.gravity.scale;
      for (const entry of this.entries.values()) {
        if (entry.body.isStatic) continue;
        const gs = (entry.body.plugin as Record<string, unknown> | undefined)?.gravityScale as number ?? 1;
        if (gs !== 0) {
          Matter.Body.setVelocity(entry.body, {
            x: entry.body.velocity.x,
            y: entry.body.velocity.y + gs * gScale * dt,
          });
        }
      }
    });

    m('phys.syncChildShapes1', () => this.syncChildShapes());
    m('phys.Engine.update', () => Matter.Engine.update(this.engine, dt));
    m('phys.syncToTree', () => this.syncToTree());
    m('phys.syncChildShapes2', () => this.syncChildShapes());
  }

  applyNodeChanges(): void {
    for (const entry of this.entries.values()) {
      if (entry.body.isStatic) continue;
      const node = entry.node;
      if (node.type === 'CollisionShape' && node.parent && this.entries.has(node.parent.id)) continue;
      const world = getWorldTransform(node);
      Matter.Body.setPosition(entry.body, { x: world.x, y: world.y });
      const vx = (node.getPropertyByPath('velocity.x') as number);
      const vy = (node.getPropertyByPath('velocity.y') as number);
      if (vx !== undefined || vy !== undefined) {
        Matter.Body.setVelocity(entry.body, { x: vx ?? entry.body.velocity.x, y: vy ?? entry.body.velocity.y });
      }
    }
  }

  private syncChildShapes(): void {
    for (const id of this.childShapeIds) {
      const entry = this.entries.get(id);
      if (!entry) continue;
      const node = entry.node;
      const parent = node.parent;
      if (!parent) continue;

      const parentEntry = this.entries.get(parent.id);
      if (!parentEntry) continue;

      const parentBody = parentEntry.body;
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
      Matter.Body.setPosition(entry.body, {
        x: parentX + cosR * offsetX * parentScaleX - sinR * offsetY * parentScaleY,
        y: parentY + sinR * offsetX * parentScaleX + cosR * offsetY * parentScaleY,
      });
    }
  }

  syncToTree(): void {
    for (const entry of this.entries.values()) {
      if (entry.body.isStatic) continue;
      const node = entry.node;
      if (node.type === 'CollisionShape' && node.parent && this.entries.has(node.parent.id)) continue;
      const local = worldToLocal(node, entry.body.position.x, entry.body.position.y);
      node.setProperty('x', local.x);
      node.setProperty('y', local.y);
      node.setPropertyByPath('velocity.x', entry.body.velocity.x);
      node.setPropertyByPath('velocity.y', entry.body.velocity.y);
    }
  }

  getCollisions(): Array<{ nodeA: string; nodeB: string }> {
    return this.currentCollisions;
  }

  getAreaOverlaps(): Array<{ nodeA: string; nodeB: string }> {
    return this.currentAreaOverlaps;
  }

  private syncBody(node: Node): void {
    const existing = this.entries.get(node.id);
    const world = getWorldTransform(node);

    if (existing) {
      Matter.Body.setPosition(existing.body, { x: world.x, y: world.y });
      const vx = (node.getPropertyByPath('velocity.x') as number) ?? existing.body.velocity.x;
      const vy = (node.getPropertyByPath('velocity.y') as number) ?? existing.body.velocity.y;
      Matter.Body.setVelocity(existing.body, { x: vx, y: vy });
      return;
    }

    const mass = (node.getProperty('mass') as number) ?? 1;
    const w = (node.getProperty('width') as number) ?? 32;
    const h = (node.getProperty('height') as number) ?? 32;
    const gravityScale = (node.getProperty('gravity_scale') as number) ?? 1;

    const body = Matter.Bodies.rectangle(world.x, world.y, w, h, {
      label: node.id,
      mass,
      plugin: { gravityScale },
      collisionFilter: {
        category: (node.getProperty('collision_layer') as number) ?? 0x0001,
        mask: (node.getProperty('collision_mask') as number) ?? 0xFFFF,
      },
    });

    const vx = (node.getPropertyByPath('velocity.x') as number) ?? 0;
    const vy = (node.getPropertyByPath('velocity.y') as number) ?? 0;
    Matter.Body.setVelocity(body, { x: vx, y: vy });

    Matter.Composite.add(this.engine.world, body);
    this.entries.set(node.id, { body, node });
  }

  private syncShape(node: Node): void {
    const existing = this.entries.get(node.id);
    const world = getWorldTransform(node);

    if (existing) {
      Matter.Body.setPosition(existing.body, { x: world.x, y: world.y });
      return;
    }

    const shape = (node.getProperty('shape') as string) ?? 'rect';
    const width = (node.getProperty('width') as number) ?? 32;
    const height = (node.getProperty('height') as number) ?? 32;
    const isStatic = !(node.getProperty('dynamic') as boolean);
    const isChildOfBody = node.parent ? this.entries.has(node.parent.id) && this.entries.get(node.parent.id)!.body.plugin?.gravityScale !== undefined : false;

    let body: Matter.Body;
    const collisionFilter: { category: number; mask: number; group?: number } = {
      category: (node.getProperty('collision_layer') as number) ?? 0x0001,
      mask: (node.getProperty('collision_mask') as number) ?? 0xFFFF,
    };
    // Prevent child shapes from colliding with their parent RigidBody
    if (isChildOfBody) {
      const group = -(node.parent!.id.charCodeAt(0) + 1);
      collisionFilter.group = group;
      // Also set parent to same group so they don't collide
      const parentEntry = this.entries.get(node.parent!.id);
      if (parentEntry && !parentEntry.body.collisionFilter.group) {
        Matter.Body.set(parentEntry.body, { collisionFilter: { ...parentEntry.body.collisionFilter, group } });
      }
    }
    if (shape === 'circle') {
      const radius = (node.getProperty('radius') as number) ?? 16;
      body = Matter.Bodies.circle(world.x, world.y, radius, { label: node.id, isStatic, collisionFilter });
    } else if (shape === 'polygon') {
      const rawPoints = (node.getProperty('points') as Array<{ x: number; y: number }>) ?? [];
      if (rawPoints.length >= 3) {
        body = Matter.Bodies.fromVertices(world.x, world.y, [rawPoints as Matter.Vector[]], { label: node.id, isStatic, collisionFilter });
        if (!body) {
          body = Matter.Bodies.rectangle(world.x, world.y, width, height, { label: node.id, isStatic, collisionFilter });
        }
      } else {
        body = Matter.Bodies.rectangle(world.x, world.y, width, height, { label: node.id, isStatic, collisionFilter });
      }
    } else {
      body = Matter.Bodies.rectangle(world.x, world.y, width, height, { label: node.id, isStatic, collisionFilter });
    }

    if (!isStatic) {
      body.plugin = { gravityScale: 0 };
    }

    Matter.Composite.add(this.engine.world, body);
    this.entries.set(node.id, { body, node });

    if (node.parent && this.entries.has(node.parent.id)) {
      this.childShapeIds.add(node.id);
    }
  }

  private syncArea(node: Node): void {
    const existing = this.entries.get(node.id);
    const world = getWorldTransform(node);

    if (existing) {
      Matter.Body.setPosition(existing.body, { x: world.x, y: world.y });
      return;
    }

    const width = (node.getProperty('width') as number) ?? 32;
    const height = (node.getProperty('height') as number) ?? 32;

    const body = Matter.Bodies.rectangle(world.x, world.y, width, height, {
      label: node.id,
      isStatic: true,
      isSensor: true,
      collisionFilter: {
        category: (node.getProperty('collision_layer') as number) ?? 0x0001,
        mask: (node.getProperty('collision_mask') as number) ?? 0xFFFF,
      },
    });
    Matter.Composite.add(this.engine.world, body);
    this.entries.set(node.id, { body, node });
  }

  setGravity(scale: number): void {
    this.engine.gravity.y = scale;
  }

  removeBody(nodeId: string): void {
    const entry = this.entries.get(nodeId);
    if (entry) {
      Matter.Composite.remove(this.engine.world, entry.body);
      this.entries.delete(nodeId);
    }
    this.childShapeIds.delete(nodeId);
    // Also remove compound tile collision body
    this.removeTileCollisions(nodeId);
  }

  addTileCollisions(
    nodeId: string,
    merged: MergedCollision[],
    offsetX = 0,
    offsetY = 0,
  ): void {
    if (merged.length === 0) return;
    const filter = { category: 0x0008, mask: 0xFFFF };
    const tileNode = this.entries.has(nodeId) ? this.entries.get(nodeId)!.node : this.tree.get(nodeId);
    const label = `${nodeId}_compound`;

    const parts: Matter.Body[] = [];
    for (const col of merged) {
      let part: Matter.Body;
      if (col.type === 'circle') {
        part = Matter.Bodies.circle(
          offsetX + (col.x ?? 0), offsetY + (col.y ?? 0),
          col.radius ?? 8,
          { label, isStatic: true, collisionFilter: filter },
        );
      } else if (col.type === 'polygon' && col.points && col.points.length >= 3) {
        // Compute centroid so shape aligns with world position.
        // col.points are world-space; fromVertices centres shape at hull centroid.
        let cx = 0, cy = 0;
        for (const p of col.points) { cx += p.x; cy += p.y; }
        cx /= col.points.length;
        cy /= col.points.length;
        part = Matter.Bodies.fromVertices(
          offsetX + cx, offsetY + cy,
          [col.points as Matter.Vector[]],
          { label, isStatic: true, collisionFilter: filter },
        );
        if (!part) continue;
      } else {
        const w = col.width ?? 16;
        const h = col.height ?? 16;
        part = Matter.Bodies.rectangle(
          offsetX + (col.x ?? 0) + w / 2, offsetY + (col.y ?? 0) + h / 2,
          w, h,
          { label, isStatic: true, collisionFilter: filter },
        );
      }
      parts.push(part);
    }

    if (parts.length === 0) return;
    const compound = Matter.Body.create({
      parts,
      isStatic: true,
      label,
      collisionFilter: filter,
    });
    Matter.Composite.add(this.engine.world, compound);
    this.entries.set(label, { body: compound, node: tileNode });
  }

  removeTileCollisions(nodeId: string): void {
    const label = `${nodeId}_compound`;
    const entry = this.entries.get(label);
    if (entry) {
      Matter.Composite.remove(this.engine.world, entry.body);
      this.entries.delete(label);
    }
  }

  private syncTileCollisions(node: Node): void {
    const enabled = node.getProperty('tile_collisions_enabled');
    if (!enabled) return;

    const tiledLayers = node.getProperty('tiled_layers');
    if (!Array.isArray(tiledLayers)) return;

    const world = getWorldTransform(node);
    for (const layer of tiledLayers as TiledLayerData[]) {
      if (!layer.tile_collisions) continue;
      const merged = buildMergedCollisions(
        layer.data, layer.width, layer.height,
        layer.tile_collisions, layer.firstgid,
        layer.tilewidth, layer.tileheight,
      );
      if (merged.length > 0) {
        this.addTileCollisions(node.id, merged, world.x, world.y);
      }
    }
  }

  // Physics types — closed set with plugin extensibility.
  // Plugins register custom types that inherit base physics: PhysicsWorld.registerPhysicsType('Enemy', 'RigidBody')
  private static baseSync = new Map<string, (pw: PhysicsWorld, node: Node) => void>([
    ['RigidBody', (pw, n) => pw.syncBody(n)],
    ['CollisionShape', (pw, n) => pw.syncShape(n)],
    ['Area', (pw, n) => pw.syncArea(n)],
    ['TileMap', (pw, n) => pw.syncTileCollisions(n)],
  ]);
  private static customTypes = new Map<string, string>();  // customType → baseType

  /** Register a custom node type that inherits physics from a base type. E.g. registerPhysicsType('Enemy', 'RigidBody') */
  static registerPhysicsType(customType: string, baseType: string): void {
    if (PhysicsWorld.baseSync.has(baseType)) {
      PhysicsWorld.customTypes.set(customType, baseType);
    }
  }

  syncNode(node: Node): void {
    let handler = PhysicsWorld.baseSync.get(node.type);
    if (!handler) {
      const baseType = PhysicsWorld.customTypes.get(node.type);
      if (baseType) handler = PhysicsWorld.baseSync.get(baseType);
    }
    if (handler) handler(this, node);
  }

  destroy(): void {
    Matter.Engine.clear(this.engine);
    this.entries.clear();
    this.childShapeIds.clear();
    this.currentCollisions = [];
    this.currentAreaOverlaps = [];
  }
}
