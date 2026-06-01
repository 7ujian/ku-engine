import type { ScriptEngine } from '../engine/script-engine.js';
import type { JsScriptEngine } from '../engine/js-script-engine.js';
import type { HitResult } from '../engine/hit-test.js';
import type { Node } from '../engine/node.js';
import { FocusManager } from '../engine/focus.js';
import { isControlType } from '../engine/anchor.js';
import type { SceneTree } from '../engine/scene-tree.js';

export type HitTestFunction = (screenX: number, screenY: number) => HitResult | null;

export class InputManager {
  private scripts: ScriptEngine;
  private jsScripts: JsScriptEngine | null;
  private keys = new Set<string>();
  private hitTestFn: HitTestFunction | null = null;
  private hoveredNode: Node | null = null;
  private focusManager = new FocusManager();
  private sceneTree: SceneTree | null = null;
  private lastHoveredControl: Node | null = null;
  private draggingSlider: Node | null = null;
  private draggingPointerId: number | null = null;

  constructor(scripts: ScriptEngine, jsScripts?: JsScriptEngine) {
    this.scripts = scripts;
    this.jsScripts = jsScripts ?? null;
  }

  get focus(): FocusManager {
    return this.focusManager;
  }

  setSceneTree(tree: SceneTree): void {
    this.sceneTree = tree;
  }

  setHitTestFn(fn: HitTestFunction | null): void {
    this.hitTestFn = fn;
  }

  keyDown(key: string): void {
    if (this.keys.has(key)) return;
    this.keys.add(key);

    // Tab key: focus navigation
    if (key === 'Tab' && this.sceneTree) {
      const focused = this.focusManager.focusedNode;
      if (focused) {
        const direction = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? -1 : 1;
        const next = this.focusManager.findNextFocus(focused, this.sceneTree.root, direction as 1 | -1);
        if (next) this.focusManager.setFocus(next);
      }
    }

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
        const node = hit.node;

        if (node.type === 'Button') {
          node.setPropertyByPath('state', 'pressed');
          this.focusManager.setFocus(node);
        } else if (node.type === 'Toggle') {
          const current = node.getProperty('pressed') === true;
          const group = (node.getProperty('group') as string) ?? '';
          if (group && !current) {
            this.unpressRadioGroup(node, group);
          }
          node.setPropertyByPath('pressed', !current);
          this.focusManager.setFocus(node);
        } else if (node.type === 'Slider') {
          this.updateSliderValue(node, hit.localX, hit.localY);
          this.draggingSlider = node;
          this.draggingPointerId = pointerId;
          this.focusManager.setFocus(node);
        } else {
          this.focusManager.setFocus(node);
        }

        this.scripts.evaluateEvent('on_gui_click', { x, y, pointerId, hit_node: node.id, localX: hit.localX, localY: hit.localY });
        this.jsScripts?.evaluateEvent('on_gui_click', { x, y, pointerId, hit_node: node.id, localX: hit.localX, localY: hit.localY });
      }
    }
  }

  touchMove(x: number, y: number, pointerId: number): void {
    // Handle slider drag
    if (this.draggingSlider && this.draggingPointerId === pointerId) {
      const rect = this.draggingSlider._computed;
      if (rect) {
        const localX = x - rect.x;
        const localY = y - rect.y;
        this.updateSliderValue(this.draggingSlider, localX, localY);
      }
    }

    this.scripts.evaluateEvent('on_touch_move', { x, y, pointerId });
    this.jsScripts?.evaluateEvent('on_touch_move', { x, y, pointerId });
    this.updateButtonHover(x, y);
    this.updateControlHover(x, y);
  }

  touchEnd(x: number, y: number, pointerId: number): void {
    // Clear slider drag state
    if (this.draggingPointerId === pointerId) {
      this.draggingSlider = null;
      this.draggingPointerId = null;
    }

    this.scripts.evaluateEvent('on_touch_end', { x, y, pointerId });
    this.jsScripts?.evaluateEvent('on_touch_end', { x, y, pointerId });

    // Reset any pressed button back to normal/hover
    if (this.hoveredNode && this.hoveredNode.type === 'Button') {
      this.hoveredNode.setPropertyByPath('state', 'normal');
    }
    // Re-evaluate hover at release position
    this.updateButtonHover(x, y);
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
      const prevState = this.hoveredNode.getProperty('state');
      if (prevState === 'hover' || prevState === 'pressed') {
        this.hoveredNode.setPropertyByPath('state', 'normal');
      }
    }

    this.hoveredNode = hitBtn;

    // Set new hover
    if (hitBtn) {
      hitBtn.setPropertyByPath('state', 'hover');
    }
  }

  private updateSliderValue(node: Node, localX: number, localY: number): void {
    const rect = node._computed;
    if (!rect) return;
    const orientation = (node.getProperty('orientation') as string) ?? 'horizontal';
    const min = (node.getProperty('min_value') as number) ?? 0;
    const max = (node.getProperty('max_value') as number) ?? 100;
    const step = (node.getProperty('step') as number) ?? 1;

    let t: number;
    if (orientation === 'horizontal') {
      t = Math.max(0, Math.min(1, localX / rect.width));
    } else {
      t = 1 - Math.max(0, Math.min(1, localY / rect.height));
    }

    let value = min + t * (max - min);
    if (step > 0) value = Math.round(value / step) * step;
    value = Math.max(min, Math.min(max, value));
    node.setProperty('value', value);
  }

  private unpressRadioGroup(node: Node, group: string): void {
    if (!node.parent) return;
    for (const sibling of node.parent.children) {
      if (sibling !== node && sibling.type === 'Toggle') {
        const sibGroup = (sibling.getProperty('group') as string) ?? '';
        if (sibGroup === group) {
          sibling.setProperty('pressed', false);
        }
      }
    }
  }

  private updateControlHover(x: number, y: number): void {
    if (!this.hitTestFn) return;
    const hit = this.hitTestFn(x, y);
    const hitControl = hit?.node ?? null;

    if (hitControl !== this.lastHoveredControl) {
      if (this.lastHoveredControl) {
        this.scripts.evaluateEvent('on_mouse_exit', { node: this.lastHoveredControl.id });
        this.jsScripts?.evaluateEvent('on_mouse_exit', { node: this.lastHoveredControl.id });
      }
      if (hitControl && isControlType(hitControl.type)) {
        this.scripts.evaluateEvent('on_mouse_enter', { node: hitControl.id });
        this.jsScripts?.evaluateEvent('on_mouse_enter', { node: hitControl.id });
      }
      this.lastHoveredControl = hitControl;
    }
  }
}
