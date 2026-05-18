import { SceneTree } from '../engine/scene-tree.js';
import { ScriptEngine } from '../engine/script-engine.js';
import { JsScriptEngine } from './js-script-engine.js';
import { PhysicsWorld } from '../engine/physics.js';
import { Renderer } from '../renderer/renderer.js';
import { CollisionEvents } from './collision-events.js';

export class GameLoop {
  private tree: SceneTree;
  private scripts: ScriptEngine;
  private jsScripts: JsScriptEngine | null;
  private physics: PhysicsWorld;
  private renderer: Renderer | null;
  private running = false;
  private paused = false;
  private frame = 0;
  private fixedDt: number;
  private maxFrameTime = 250;
  private accumulator = 0;
  private lastTime = 0;
  private loopHandle: ReturnType<typeof setTimeout> | null = null;
  private fps: number;
  private onExit: (() => void) | null = null;
  private physicsEnabled: boolean;
  private collisionEvents: CollisionEvents;
  private prevSnapshot: Record<string, Record<string, unknown>> | null = null;
  private timers = new Map<string, { elapsed: number; fired: boolean }>();

  constructor(
    tree: SceneTree,
    scripts: ScriptEngine,
    physics: PhysicsWorld,
    renderer: Renderer | null,
    fps = 60,
    physicsEnabled = true,
    jsScripts?: JsScriptEngine,
  ) {
    this.tree = tree;
    this.scripts = scripts;
    this.jsScripts = jsScripts ?? null;
    this.physics = physics;
    this.renderer = renderer;
    this.fps = fps;
    this.fixedDt = 1000 / fps;
    this.physicsEnabled = physicsEnabled;
    this.collisionEvents = new CollisionEvents(tree, (event, data) => {
      scripts.evaluateEvent(event, data);
      jsScripts?.evaluateEvent(event, data);
    });
  }

  setOnExit(cb: () => void): void {
    this.onExit = cb;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.accumulator = 0;
    this.lastTime = performance.now();
    this.scripts.evaluateEvent('on_enter', {});
    this.jsScripts?.evaluateEvent('on_enter', {});
    this.physics.syncFromTree();
    this.prevSnapshot = this.snapshotProperties();
    this.scheduleFrame();
  }

  stop(): void {
    this.running = false;
    if (this.loopHandle) {
      clearTimeout(this.loopHandle);
      this.loopHandle = null;
    }
    if (this.renderer) {
      this.renderer.close();
    }
    this.physics.destroy();
    this.collisionEvents.reset();
    this.timers.clear();
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
  }

  step(): void {
    this.tick(this.fixedDt);
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

  private scheduleFrame(): void {
    this.loopHandle = setTimeout(() => this.frameLoop(), 0);
  }

  private frameLoop(): void {
    if (!this.running) return;

    const now = performance.now();
    let frameTime = now - this.lastTime;
    this.lastTime = now;

    if (frameTime > this.maxFrameTime) frameTime = this.maxFrameTime;

    this.accumulator += frameTime;

    while (this.accumulator >= this.fixedDt) {
      this.tick(this.fixedDt);
      this.accumulator -= this.fixedDt;
    }

    if (this.renderer) {
      if (!this.renderer.isOpen()) {
        this.stop();
        this.onExit?.();
        return;
      }
      this.renderer.draw(this.tree);
    }

    this.scheduleFrame();
  }

  private tick(dt: number): void {
    if (this.paused) return;
    this.frame++;

    if (this.physicsEnabled) {
      this.physics.applyNodeChanges();
      this.physics.step(dt);

      // Collision events: on_collision (enter) and on_collision_exit
      const collisions = this.physics.getCollisions();
      this.collisionEvents.update(collisions);

      // Area overlap events: on_area_enter and on_area_exit
      const areaOverlaps = this.physics.getAreaOverlaps();
      this.collisionEvents.updateAreas(areaOverlaps);
    }
    this.scripts.evaluateEvent('on_frame', { frame: this.frame });
    this.jsScripts?.evaluateEvent('on_frame', { frame: this.frame });

    // Timer events
    this.tickTimers(dt);
  }

  private snapshotProperties(): Record<string, Record<string, unknown>> {
    const snap: Record<string, Record<string, unknown>> = {};
    this.tree.traverse((node) => {
      snap[node.id] = { ...node.properties };
    });
    return snap;
  }

  private tickTimers(dt: number): void {
    this.tree.traverse((node) => {
      if (node.type !== 'Timer') return;
      const autostart = (node.getProperty('autostart') as boolean) ?? false;
      const playing = (node.getProperty('playing') as boolean) ?? autostart;
      if (!playing) return;

      const waitTime = ((node.getProperty('wait_time') as number) ?? 1) * 1000;
      const oneShot = (node.getProperty('one_shot') as boolean) ?? false;

      let state = this.timers.get(node.id);
      if (!state) {
        state = { elapsed: 0, fired: false };
        this.timers.set(node.id, state);
      }

      state.elapsed += dt;
      if (state.elapsed >= waitTime) {
        if (oneShot && state.fired) return;
        state.fired = true;
        state.elapsed = 0;
        this.scripts.evaluateEvent('on_timer', { timer: node.id });
        this.jsScripts?.evaluateEvent('on_timer', { timer: node.id });
      }
    });
  }
}
