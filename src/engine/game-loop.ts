import { SceneTree } from '../engine/scene-tree.js';
import { ScriptEngine } from '../engine/script-engine.js';
import { PhysicsWorld } from '../engine/physics.js';
import { Renderer } from '../renderer/renderer.js';

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
  private physicsEnabled: boolean;

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
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.scripts.evaluateEvent('on_enter', {});
    this.physics.syncFromTree();
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

  private tick(): void {
    if (this.paused) return;
    this.frame++;

    if (this.physicsEnabled) {
      // Apply any velocity/position changes from scripts before stepping
      this.physics.applyNodeChanges();
      this.physics.step(1000 / this.fps);

      // Emit collision events (both directions)
      const collisions = this.physics.getCollisions();
      for (const col of collisions) {
        let tagsA: string[] = [];
        let tagsB: string[] = [];
        try {
          tagsA = this.tree.get(col.nodeA).getProperty('tags') as string[] ?? [];
        } catch { /* ignore */ }
        try {
          tagsB = this.tree.get(col.nodeB).getProperty('tags') as string[] ?? [];
        } catch { /* ignore */ }

        this.scripts.evaluateEvent('on_collision', {
          node: col.nodeA,
          other: col.nodeB,
          otherTags: tagsB,
        });
        this.scripts.evaluateEvent('on_collision', {
          node: col.nodeB,
          other: col.nodeA,
          otherTags: tagsA,
        });
      }
    }
    this.scripts.evaluateEvent('on_frame', { frame: this.frame });

    if (this.renderer && this.renderer.isOpen()) {
      this.renderer.draw(this.tree);
    }
  }
}
