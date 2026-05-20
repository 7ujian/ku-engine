import { SceneTree } from '../engine/scene-tree.js';
import { Node } from '../engine/node.js';
import { ScriptEngine } from '../engine/script-engine.js';
import { JsScriptEngine } from './js-script-engine.js';
import { PhysicsWorld } from '../engine/physics.js';
import { Renderer } from '../renderer/renderer.js';
import { CollisionEvents } from './collision-events.js';
import { interpolateKeyframes, getEasing, type PropertyAnimation, type AnimTrack } from './animation.js';
import type { AudioManager } from '../engine/audio.js';

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
  private animPlayerState = new Map<string, { elapsed: number; finished: boolean }>();
  private audio: AudioManager | null = null;
  private pendingScene: { name: string } | null = null;
  private sceneLoader: ((name: string) => Promise<SceneTree>) | null = null;

  constructor(
    tree: SceneTree,
    scripts: ScriptEngine,
    physics: PhysicsWorld,
    renderer: Renderer | null,
    fps = 60,
    physicsEnabled = true,
    jsScripts?: JsScriptEngine,
    audio?: AudioManager,
    sceneLoader?: (name: string) => Promise<SceneTree>,
  ) {
    this.tree = tree;
    this.scripts = scripts;
    this.jsScripts = jsScripts ?? null;
    this.physics = physics;
    this.renderer = renderer;
    this.fps = fps;
    this.fixedDt = 1000 / fps;
    this.physicsEnabled = physicsEnabled;
    this.audio = audio ?? null;
    if (audio) scripts.setAudio(audio);
    if (sceneLoader) {
      scripts.setSceneLoader(sceneLoader);
      this.sceneLoader = sceneLoader;
    }
    this.collisionEvents = new CollisionEvents(tree, (event, data) => {
      scripts.evaluateEvent(event, data);
      jsScripts?.evaluateEvent(event, data);
    });

    // Wire JS spawn/destroy callbacks so spawned nodes get full engine registration
    if (jsScripts) {
      jsScripts.setSpawnCallback((node: Node) => {
        scripts.registerNode(node);
        jsScripts?.registerNode(node);
        physics.syncNode(node);
      });
      jsScripts.setDestroyCallback((nodeId: string) => {
        scripts.unregisterNodeById(nodeId);
        jsScripts?.unregisterNodeById(nodeId);
        physics.removeBody(nodeId);
      });
    }
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
    this.audio?.destroy();
    this.collisionEvents.reset();
    this.timers.clear();
    this.animPlayerState.clear();
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

  getTree(): SceneTree {
    return this.tree;
  }

  syncNodeProperty(path: string): void {
    const node = this.tree.get(path);
    if (node) this.physics.syncNode(node);
  }

  getCollisions(): Array<{ nodeA: string; nodeB: string }> {
    return this.physics.getCollisions();
  }

  getLogs(): string[] {
    const logs = this.scripts.getLogs();
    if (this.jsScripts) logs.push(...this.jsScripts.getLogs());
    return logs;
  }

  clearLogs(): void {
    this.scripts.clearLogs();
    this.jsScripts?.clearLogs();
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

    // Process scene change between ticks (async, out of accumulator loop)
    if (this.pendingScene && this.sceneLoader) {
      this.applySceneChange(this.pendingScene.name);
      this.pendingScene = null;
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
    this.tickAnimationPlayers(dt);
    this.scripts.evaluateEvent('on_frame', { frame: this.frame, dt });
    this.jsScripts?.evaluateEvent('on_frame', { frame: this.frame, dt });

    // Audio tick — feeds queued sounds to SDL2 device
    this.audio?.tick();

    // Timer events
    this.tickTimers(dt);

    // Check for pending scene change request
    const change = this.scripts.getPendingSceneChange();
    if (change) {
      this.pendingScene = change;
    }
  }

  replaceTree(newTree: SceneTree): void {
    this.physics.destroy();
    this.collisionEvents.reset();
    this.timers.clear();
    this.animPlayerState.clear();
    this.tree = newTree;
    this.physics = new PhysicsWorld(newTree);
    this.physics.syncFromTree();
    this.scripts.setTree(newTree);
    this.scripts.registerTree();
    this.jsScripts?.registerTree();
    if (this.jsScripts) {
      const scripts = this.scripts;
      const jsScripts = this.jsScripts;
      const physics = this.physics;
      this.jsScripts.setSpawnCallback((node: Node) => {
        scripts.registerNode(node);
        jsScripts.registerNode(node);
        physics.syncNode(node);
      });
    }
    this.scripts.evaluateEvent('on_enter', {});
    this.jsScripts?.evaluateEvent('on_enter', {});
  }

  private snapshotProperties(): Record<string, Record<string, unknown>> {
    const snap: Record<string, Record<string, unknown>> = {};
    this.tree.traverse((node) => {
      snap[node.id] = { ...node.properties };
    });
    return snap;
  }

  private async applySceneChange(name: string): Promise<void> {
    if (!this.sceneLoader) return;
    try {
      const newTree = await this.sceneLoader(name);
      this.physics.destroy();
      this.collisionEvents.reset();
      this.timers.clear();
      this.tree = newTree;
      this.physics = new PhysicsWorld(newTree);
      this.physics.syncFromTree();
      this.scripts.setTree(newTree);
      this.scripts.registerTree();
      this.jsScripts?.registerTree();
      // Re-wire spawn/destroy for new tree
      if (this.jsScripts) {
        const scripts = this.scripts;
        const jsScripts = this.jsScripts;
        const physics = this.physics;
        this.jsScripts.setSpawnCallback((node: Node) => {
          scripts.registerNode(node);
          jsScripts.registerNode(node);
          physics.syncNode(node);
        });
      }
      this.scripts.evaluateEvent('on_enter', {});
      this.jsScripts?.evaluateEvent('on_enter', {});
    } catch {
      // scene load failed, keep current scene
    }
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

  private tickAnimationPlayers(dt: number): void {
    this.tree.traverse((node) => {
      if (node.type !== 'AnimationPlayer') return;
      const playing = (node.getProperty('playing') as boolean) ?? false;
      if (!playing) return;

      const current = (node.getProperty('current') as string) ?? '';
      const targetPath = (node.getProperty('target') as string) ?? '';
      const speed = (node.getProperty('speed') as number) ?? 1;
      const loop = (node.getProperty('loop') as boolean) ?? false;

      if (!current || !targetPath) return;

      const animations = (node.getProperty('animations') as Record<string, unknown>) ?? {};
      const animDef = animations[current];
      if (!animDef || typeof animDef !== 'object') return;
      const anim = animDef as PropertyAnimation;
      if (!anim.tracks || !anim.duration) return;

      let target: Node;
      try { target = this.tree.get(targetPath); } catch { return; }

      let state = this.animPlayerState.get(node.id);
      if (!state) {
        state = { elapsed: 0, finished: false };
        this.animPlayerState.set(node.id, state);
      }
      if (state.finished && !loop) {
        // Reset state when replaying a finished non-looping animation
        state.elapsed = 0;
        state.finished = false;
      }

      const durationMs = anim.duration * 1000;
      state.elapsed += dt * speed;

      let progress: number;
      if (loop) {
        progress = (state.elapsed % durationMs) / durationMs;
      } else {
        progress = Math.min(state.elapsed / durationMs, 1);
        if (progress >= 1) {
          state.finished = true;
          progress = 1;
        }
      }

      const animLoop = anim.loop ?? loop;
      for (const [prop, track] of Object.entries(anim.tracks)) {
        const t = track as AnimTrack;
        if (!t.keyframes || t.keyframes.length === 0) continue;
        const value = interpolateKeyframes(t.keyframes, progress, getEasing(t.easing));
        target.setPropertyByPath(prop, value);
      }

      if (state.finished && !animLoop) {
        node.setProperty('playing', false);
        this.scripts.evaluateEvent('on_animation_finished', { animation: current, node: node.id });
        this.jsScripts?.evaluateEvent('on_animation_finished', { animation: current, node: node.id });
        state.elapsed = 0;
        state.finished = false;
      }
    });
  }
}