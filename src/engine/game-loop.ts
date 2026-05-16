import { SceneTree } from '../engine/scene-tree.js';
import { ScriptEngine } from '../engine/script-engine.js';
import { PhysicsWorld } from '../engine/physics.js';
import { Renderer } from '../renderer/renderer.js';
import { CollisionEvents } from './collision-events.js';

export class GameLoop {
  private tree: SceneTree;
  private scripts: ScriptEngine;
  private physics: PhysicsWorld;
  private renderer: Renderer | null;
  private running = false;
  private paused = false;
  private frame = 0;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private fps: number;
  private onExit: (() => void) | null = null;
  private physicsEnabled: boolean;
  private collisionEvents: CollisionEvents;
  private prevSnapshot: Record<string, Record<string, unknown>> | null = null;

  constructor(
    tree: SceneTree,
    scripts: ScriptEngine,
    physics: PhysicsWorld,
    renderer: Renderer | null,
    fps = 60,
    physicsEnabled = true,
  ) {
    this.tree = tree;
    this.scripts = scripts;
    this.physics = physics;
    this.renderer = renderer;
    this.fps = fps;
    this.physicsEnabled = physicsEnabled;
    this.collisionEvents = new CollisionEvents(tree, (event, data) => {
      scripts.evaluateEvent(event, data);
    });
  }

  setOnExit(cb: () => void): void {
    this.onExit = cb;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.scripts.evaluateEvent('on_enter', {});
    this.physics.syncFromTree();
    this.prevSnapshot = this.snapshotProperties();
    this.intervalId = setInterval(() => this.tick(), 1000 / this.fps);
  }

  stop(): void {
    this.running = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    if (this.renderer) {
      this.renderer.close();
    }
    this.physics.destroy();
    this.collisionEvents.reset();
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
  }

  step(): void {
    this.tick();
  }

  isRunning(): boolean {
    return this.running;
  }

  isPaused(): boolean {
    return this.paused;
  }

  getFrame(): number {
    return this.frame;
  }

  getCollisions(): Array<{ nodeA: string; nodeB: string }> {
    return this.physics.getCollisions();
  }

  getDiff(): Array<{ node: string; property: string; old: unknown; new: unknown }> {
    const current = this.snapshotProperties();
    const prev = this.prevSnapshot ?? {};
    const deltas: Array<{ node: string; property: string; old: unknown; new: unknown }> = [];

    for (const [nodeId, props] of Object.entries(current)) {
      const prevProps = prev[nodeId] ?? {};
      for (const [key, value] of Object.entries(props)) {
        if (JSON.stringify(prevProps[key]) !== JSON.stringify(value)) {
          deltas.push({ node: nodeId, property: key, old: prevProps[key], new: value });
        }
      }
    }

    this.prevSnapshot = current;
    return deltas;
  }

  private tick(): void {
    if (this.paused) return;
    this.frame++;

    if (this.physicsEnabled) {
      this.physics.applyNodeChanges();
      this.physics.step(1000 / this.fps);

      // Collision events: on_collision (enter) and on_collision_exit
      const collisions = this.physics.getCollisions();
      this.collisionEvents.update(collisions);
    }
    this.scripts.evaluateEvent('on_frame', { frame: this.frame });

    if (this.renderer) {
      if (!this.renderer.isOpen()) {
        this.stop();
        this.onExit?.();
        return;
      }
      this.renderer.draw(this.tree);
    }
  }

  private snapshotProperties(): Record<string, Record<string, unknown>> {
    const snap: Record<string, Record<string, unknown>> = {};
    this.tree.traverse((node) => {
      snap[node.id] = { ...node.properties };
    });
    return snap;
  }
}
