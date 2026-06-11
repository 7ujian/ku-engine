import type { Node } from './node.js';

export interface ProfileSample {
  name: string;
  totalMs: number;
  count: number;
  avgMs: number;
  maxMs: number;
  minMs: number;
  lastMs: number;
}

type SampleData = { total: number; count: number; max: number; min: number; last: number };

export class Profiler {
  private samples = new Map<string, SampleData>();
  private reportIntervalMs: number;
  private lastSync = 0;
  private targetNode: Node | null = null;

  // Frame time tracking
  private frameTimeHistory: number[] = [];
  private frameTimeIndex = 0;
  private frameTimeFilled = false;
  private readonly frameTimeCapacity = 120;
  private fps = 0;
  private lastFrameTime = 0;
  private frameCount = 0;
  private fpsAccumulator = 0;
  private lastFpsUpdate = 0;

  constructor(reportIntervalMs = 5000) {
    this.reportIntervalMs = reportIntervalMs;
    this.lastFpsUpdate = performance.now();
  }

  setTargetNode(node: Node): void {
    this.targetNode = node;
  }

  get enabled(): boolean {
    return this.targetNode !== null && (this.targetNode.getProperty('enabled') as boolean) === true;
  }

  measure<T>(name: string, fn: () => T): T {
    if (!this.enabled) return fn();
    const t0 = performance.now();
    const result = fn();
    this.record(name, performance.now() - t0);
    return result;
  }

  recordFrameTime(frameTimeMs: number): void {
    this.lastFrameTime = frameTimeMs;
    // Ring buffer for frame time history
    if (this.frameTimeHistory.length < this.frameTimeCapacity) {
      this.frameTimeHistory.push(frameTimeMs);
    } else {
      this.frameTimeHistory[this.frameTimeIndex] = frameTimeMs;
      this.frameTimeFilled = true;
    }
    this.frameTimeIndex = (this.frameTimeIndex + 1) % this.frameTimeCapacity;

    // FPS calculation (update every second)
    this.frameCount++;
    this.fpsAccumulator += frameTimeMs;
    const now = performance.now();
    if (now - this.lastFpsUpdate >= 1000) {
      this.fps = Math.round((this.frameCount * 1000) / this.fpsAccumulator);
      this.frameCount = 0;
      this.fpsAccumulator = 0;
      this.lastFpsUpdate = now;
    }
  }

  getFrameTimeHistory(): { data: number[]; filled: boolean } {
    if (!this.frameTimeFilled) {
      return { data: [...this.frameTimeHistory], filled: false };
    }
    // Return rotated array (oldest first)
    const rotated = [
      ...this.frameTimeHistory.slice(this.frameTimeIndex),
      ...this.frameTimeHistory.slice(0, this.frameTimeIndex),
    ];
    return { data: rotated, filled: true };
  }

  getFps(): number {
    return this.fps;
  }

  getLastFrameTime(): number {
    return this.lastFrameTime;
  }

  private record(name: string, elapsed: number): void {
    let s = this.samples.get(name);
    if (!s) {
      s = { total: 0, count: 0, max: 0, min: Infinity, last: 0 };
      this.samples.set(name, s);
    }
    s.total += elapsed;
    s.count++;
    s.last = elapsed;
    if (elapsed > s.max) s.max = elapsed;
    if (elapsed < s.min) s.min = elapsed;
  }

  syncToNode(bodyCount: number, nodeCount: number, callback?: () => void): void {
    const node = this.targetNode;
    if (!node) return;

    const now = performance.now();
    const doFullSync = now - this.lastSync >= this.reportIntervalMs;
    if (doFullSync) {
      this.lastSync = now;
      this.syncToNodeImmediate(bodyCount, nodeCount);
    } else {
      // Lightweight per-frame sync: only fps + frame time + history
      node.setProperty('fps', this.fps);
      node.setProperty('last_frame_time', this.lastFrameTime);
      node.setProperty('frame_time_history', this.getFrameTimeHistory());
    }
    // Always call callback so UI widgets (e.g. LineGraph) update every frame
    callback?.();
  }

  syncToNodeImmediate(bodyCount: number, nodeCount: number): void {
    const node = this.targetNode;
    if (!node) return;

    node.setProperty('body_count', bodyCount);
    node.setProperty('node_count', nodeCount);
    node.setProperty('samples', this.getSamples());
    node.setProperty('fps', this.fps);
    node.setProperty('frame_time_history', this.getFrameTimeHistory());
  }

  reset(): void {
    this.samples.clear();
    this.lastSync = performance.now();
    this.frameTimeHistory = [];
    this.frameTimeIndex = 0;
    this.frameTimeFilled = false;
  }

  getSamples(): ProfileSample[] {
    const result: ProfileSample[] = [];
    for (const [name, s] of this.samples) {
      result.push({
        name,
        totalMs: Math.round(s.total * 100) / 100,
        count: s.count,
        avgMs: Math.round((s.total / s.count) * 1000) / 1000,
        maxMs: Math.round(s.max * 1000) / 1000,
        minMs: s.count > 0 ? Math.round(s.min * 1000) / 1000 : 0,
        lastMs: Math.round(s.last * 1000) / 1000,
      });
    }
    return result.sort((a, b) => b.totalMs - a.totalMs);
  }
}
