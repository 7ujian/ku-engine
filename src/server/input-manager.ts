import type { ScriptEngine } from '../engine/script-engine.js';
import type { JsScriptEngine } from '../engine/js-script-engine.js';
import type { HitResult } from '../engine/hit-test.js';
import type { Node } from '../engine/node.js';

export type HitTestFunction = (screenX: number, screenY: number) => HitResult | null;

export class InputManager {
  private scripts: ScriptEngine;
  private jsScripts: JsScriptEngine | null;
  private keys = new Set<string>();
  private hitTestFn: HitTestFunction | null = null;
  private hoveredNode: Node | null = null;

  constructor(scripts: ScriptEngine, jsScripts?: JsScriptEngine) {
    this.scripts = scripts;
    this.jsScripts = jsScripts ?? null;
  }

  setHitTestFn(fn: HitTestFunction | null): void {
    this.hitTestFn = fn;
  }

  keyDown(key: string): void {
    if (this.keys.has(key)) return;
    this.keys.add(key);
    this.scripts.evaluateEvent('on_key', { key });
    this.jsScripts?.evaluateEvent('on_key', { key });
  }

  keyUp(key: string): void {
    this.keys.delete(key);
    this.scripts.evaluateEvent('on_key_up', { key });
    this.jsScripts?.evaluateEvent('on_key_up', { key });
  }

  click(x: number, y: number): void {
    this.scripts.evaluateEvent('on_click', { x, y });
    this.jsScripts?.evaluateEvent('on_click', { x, y });

    if (this.hitTestFn) {
      const hit = this.hitTestFn(x, y);
      if (hit) {
        this.scripts.evaluateEvent('on_gui_click', { x, y, hit_node: hit.node.id, localX: hit.localX, localY: hit.localY });
        this.jsScripts?.evaluateEvent('on_gui_click', { x, y, hit_node: hit.node.id, localX: hit.localX, localY: hit.localY });
      }
    }
  }

  setAxis(name: string, value: number): void {
    this.scripts.evaluateEvent('on_axis', { name, value });
    this.jsScripts?.evaluateEvent('on_axis', { name, value });
  }

  touchStart(x: number, y: number, pointerId: number): void {
    this.scripts.evaluateEvent('on_touch_start', { x, y, pointerId });
    this.jsScripts?.evaluateEvent('on_touch_start', { x, y, pointerId });

    if (this.hitTestFn) {
      const hit = this.hitTestFn(x, y);
      if (hit) {
        // Set pressed state on button
        if (hit.node.type === 'Button') {
          hit.node.setPropertyByPath('state', 'pressed');
        }
        this.scripts.evaluateEvent('on_gui_click', { x, y, pointerId, hit_node: hit.node.id, localX: hit.localX, localY: hit.localY });
        this.jsScripts?.evaluateEvent('on_gui_click', { x, y, pointerId, hit_node: hit.node.id, localX: hit.localX, localY: hit.localY });
      }
    }
  }

  touchMove(x: number, y: number, pointerId: number): void {
    this.scripts.evaluateEvent('on_touch_move', { x, y, pointerId });
    this.jsScripts?.evaluateEvent('on_touch_move', { x, y, pointerId });
    this.updateButtonHover(x, y);
  }

  touchEnd(x: number, y: number, pointerId: number): void {
    this.scripts.evaluateEvent('on_touch_end', { x, y, pointerId });
    this.jsScripts?.evaluateEvent('on_touch_end', { x, y, pointerId });
  }

  isKeyDown(key: string): boolean {
    return this.keys.has(key);
  }

  private updateButtonHover(x: number, y: number): void {
    if (!this.hitTestFn) return;

    const hit = this.hitTestFn(x, y);
    const hitBtn = hit?.node.type === 'Button' ? hit.node : null;

    if (hitBtn === this.hoveredNode) return;

    // Clear previous hover
    if (this.hoveredNode) {
      this.hoveredNode.setPropertyByPath('state', 'normal');
    }

    this.hoveredNode = hitBtn;

    // Set new hover
    if (hitBtn) {
      hitBtn.setPropertyByPath('state', 'hover');
    }
  }
}
