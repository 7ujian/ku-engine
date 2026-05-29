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

  constructor(reportIntervalMs = 5000) {
    this.reportIntervalMs = reportIntervalMs;
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

  syncToNode(bodyCount: number, nodeCount: number): void {
    const node = this.targetNode;
    if (!node) return;

    const now = performance.now();
    if (now - this.lastSync < this.reportIntervalMs) return;
    this.lastSync = now;

    node.setProperty('enabled', true);
    node.setProperty('body_count', bodyCount);
    node.setProperty('node_count', nodeCount);
    node.setProperty('samples', this.getSamples());
  }

  reset(): void {
    this.samples.clear();
    this.lastSync = performance.now();
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
