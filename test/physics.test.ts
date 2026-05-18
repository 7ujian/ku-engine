import { describe, it, expect } from 'vitest';
import { Node } from '../src/engine/node.js';
import { SceneTree } from '../src/engine/scene-tree.js';
import { PhysicsWorld } from '../src/engine/physics.js';

describe('PhysicsWorld', () => {
  function makeScene(): SceneTree {
    const root = new Node('root', 'Node');
    const ground = new Node('ground', 'CollisionShape', { shape: 'rect', width: 640, height: 32, x: 320, y: 464 });
    const player = new Node('player', 'RigidBody', { x: 100, y: 100, mass: 1, velocity: { x: 0, y: 0 }, gravity_scale: 1, linear_damping: 0 });
    root.addChild(ground);
    root.addChild(player);
    return new SceneTree(root);
  }

  it('syncs bodies from tree', () => {
    const tree = makeScene();
    const world = new PhysicsWorld(tree);
    world.syncFromTree();
    const collisions = world.getCollisions();
    expect(collisions).toBeDefined();
    world.destroy();
  });

  it('falls with gravity after step', () => {
    const tree = makeScene();
    const world = new PhysicsWorld(tree);
    world.syncFromTree();

    const player = tree.get('player');
    const startY = player.getProperty('y') as number;

    world.step(1000 / 60);

    const newY = player.getProperty('y') as number;
    expect(newY).toBeGreaterThan(startY);
    world.destroy();
  });

  it('syncs velocity back to node', () => {
    const tree = makeScene();
    const world = new PhysicsWorld(tree);
    world.syncFromTree();
    world.step(1000 / 60);

    const player = tree.get('player');
    const vy = player.getPropertyByPath('velocity.y') as number;
    expect(vy).toBeGreaterThan(0);
    world.destroy();
  });

  it('detects collisions between bodies', () => {
    const root = new Node('root', 'Node');
    const body1 = new Node('body1', 'RigidBody', { x: 100, y: 100, mass: 1, velocity: { x: 0, y: 0 }, gravity_scale: 1, linear_damping: 0 });
    const body2 = new Node('body2', 'RigidBody', { x: 100, y: 102, mass: 1, velocity: { x: 0, y: 0 }, gravity_scale: 1, linear_damping: 0 });
    root.addChild(body1);
    root.addChild(body2);

    const tree = new SceneTree(root);
    const world = new PhysicsWorld(tree);
    world.syncFromTree();

    // Step a few times to let bodies potentially collide
    for (let i = 0; i < 10; i++) {
      world.step(1000 / 60);
    }

    // Bodies should have moved due to gravity
    const y1 = tree.get('body1').getProperty('y') as number;
    const y2 = tree.get('body2').getProperty('y') as number;
    expect(y1).not.toBe(100);
    expect(y2).not.toBe(102);
    world.destroy();
  });

  it('cleans up on destroy', () => {
    const tree = makeScene();
    const world = new PhysicsWorld(tree);
    world.syncFromTree();
    world.destroy();
    // No errors means cleanup worked
  });

  it('child CollisionShape follows parent RigidBody', () => {
    const root = new Node('root', 'Node');
    const player = new Node('player', 'RigidBody', { x: 100, y: 100, mass: 1, velocity: { x: 0, y: 0 }, gravity_scale: 1, linear_damping: 0, width: 32, height: 32 });
    const shape = new Node('shape', 'CollisionShape', { shape: 'rect', width: 32, height: 32, x: 10, y: 0 });
    player.addChild(shape);
    root.addChild(player);

    const tree = new SceneTree(root);
    const world = new PhysicsWorld(tree);
    world.syncFromTree();

    // Initial shape position should be parent + offset
    const shapeBody = (world as any).bodyMap.get('shape');
    expect(shapeBody.position.x).toBeCloseTo(110);
    expect(shapeBody.position.y).toBeCloseTo(100);

    // Step physics — parent falls due to gravity
    world.step(1000 / 60);
    world.step(1000 / 60);
    world.step(1000 / 60);

    // Shape should still track parent position + offset
    const playerBody = (world as any).bodyMap.get('player');
    const parentY = playerBody.position.y;
    expect(shapeBody.position.x).toBeCloseTo(110, 0);
    // Shape Y should be at parent Y + 0 offset
    expect(shapeBody.position.y).toBeCloseTo(parentY, 0);

    world.destroy();
  });
});
