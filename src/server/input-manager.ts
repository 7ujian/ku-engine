import type { ScriptEngine } from '../engine/script-engine.js';

export class InputManager {
  private scripts: ScriptEngine;
  private keys = new Set<string>();

  constructor(scripts: ScriptEngine) {
    this.scripts = scripts;
  }

  keyDown(key: string): void {
    if (this.keys.has(key)) return;
    this.keys.add(key);
    this.scripts.evaluateEvent('on_key', { key });
  }

  keyUp(key: string): void {
    this.keys.delete(key);
    this.scripts.evaluateEvent('on_key_up', { key });
  }

  click(x: number, y: number): void {
    this.scripts.evaluateEvent('on_click', { x, y });
  }

  setAxis(name: string, value: number): void {
    this.scripts.evaluateEvent('on_axis', { name, value });
  }

  isKeyDown(key: string): boolean {
    return this.keys.has(key);
  }
}
