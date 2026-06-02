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
  private draggingScrollView: Node | null = null;
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

        // Check if click is on ScrollView scrollbar area
        if (node.type === 'ScrollView') {
          const scrollDir = this.hitScrollbar(node, hit.localX, hit.localY);
          if (scrollDir) {
            this.draggingScrollView = node;
            this.draggingPointerId = pointerId;
            this.updateScrollViewScroll(node, hit.localX, hit.localY);
            return;
          }
        }

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
        } else if (node.type === 'ListItem') {
          const selectable = node.getProperty('selectable') !== false;
          if (selectable) {
            const wasSelected = node.getProperty('selected') === true;
            node.setPropertyByPath('selected', !wasSelected);
            const eventType = wasSelected ? 'on_deselect' : 'on_select';
            this.scripts.evaluateEvent(eventType, { node_id: node.id });
            this.jsScripts?.evaluateEvent(eventType, { node_id: node.id });
          }
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
        this.scripts.evaluateEvent('on_gui_click', { x, y, pointerId, hit_node: this.draggingSlider.id, localX, localY });
        this.jsScripts?.evaluateEvent('on_gui_click', { x, y, pointerId, hit_node: this.draggingSlider.id, localX, localY });
      }
    }

    // Handle scrollbar drag
    if (this.draggingScrollView && this.draggingPointerId === pointerId) {
      const rect = this.draggingScrollView._computed;
      if (rect) {
        const localX = x - rect.x;
        const localY = y - rect.y;
        this.updateScrollViewScroll(this.draggingScrollView, localX, localY);
      }
    }

    this.scripts.evaluateEvent('on_touch_move', { x, y, pointerId });
    this.jsScripts?.evaluateEvent('on_touch_move', { x, y, pointerId });
    this.updateButtonHover(x, y);
    this.updateControlHover(x, y);
  }

  touchEnd(x: number, y: number, pointerId: number): void {
    // Clear drag state
    if (this.draggingPointerId === pointerId) {
      this.draggingSlider = null;
      this.draggingScrollView = null;
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

  /** Handle mouse wheel — scroll ScrollView under cursor */
  mouseWheel(x: number, y: number, deltaY: number): void {
    if (!this.hitTestFn || deltaY === 0) return;
    const hit = this.hitTestFn(x, y);
    if (!hit) return;

    // Walk up to find a ScrollView ancestor
    let node: Node | null = hit.node;
    while (node) {
      if (node.type === 'ScrollView') {
        // Normalize: SDL deltaY can be ±1 (normal) or ±120 (high-res). Clamp to ±1 direction.
        const direction = deltaY > 0 ? 1 : -1;
        const scrollStep = 12;
        const scrollY = (node.getProperty('scroll_y') as number) ?? 0;
        const content = this.getContentSize(node);
        const vpH = node._computed?.height ?? (node.getProperty('height') as number) ?? 300;
        const maxScroll = Math.max(0, content.height - vpH);
        const newY = Math.max(0, Math.min(maxScroll, scrollY - direction * scrollStep));
        node.setPropertyByPath('scroll_y', Math.round(newY));
        return;
      }
      node = node.parent;
    }
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

  /** Get content size from ScrollView children */
  private getContentSize(node: Node): { width: number; height: number } {
    let contentW = 0;
    let contentH = 0;
    for (const child of node.children) {
      const cw = child._computed?.width  ?? (child.getProperty('width') as number)  ?? 0;
      const ch = child._computed?.height ?? (child.getProperty('height') as number) ?? 0;
      const cx = child._computed?.x ?? (child.getProperty('x') as number) ?? 0;
      const cy = child._computed?.y ?? (child.getProperty('y') as number) ?? 0;
      contentW = Math.max(contentW, cx + cw);
      contentH = Math.max(contentH, cy + ch);
    }
    return { width: contentW, height: contentH };
  }

  /** Check if local coords hit a scrollbar track. Returns 'vertical' | 'horizontal' | null */
  private hitScrollbar(node: Node, localX: number, localY: number): string | null {
    const vpW = node._computed?.width  ?? (node.getProperty('width') as number)  ?? 400;
    const vpH = node._computed?.height ?? (node.getProperty('height') as number) ?? 300;
    const barWidth = 8;
    const content = this.getContentSize(node);

    // Vertical scrollbar
    if (content.height > vpH) {
      const trackX = vpW - barWidth;
      if (localX >= trackX && localX <= vpW && localY >= 0 && localY <= vpH) {
        return 'vertical';
      }
    }
    // Horizontal scrollbar
    if (content.width > vpW) {
      const trackY = vpH - barWidth;
      if (localY >= trackY && localY <= vpH && localX >= 0 && localX <= vpW) {
        return 'horizontal';
      }
    }
    return null;
  }

  /** Update scroll position based on pointer position relative to scrollbar track */
  private updateScrollViewScroll(node: Node, localX: number, localY: number): void {
    const vpW = node._computed?.width  ?? (node.getProperty('width') as number)  ?? 400;
    const vpH = node._computed?.height ?? (node.getProperty('height') as number) ?? 300;
    const barWidth = 8;
    const content = this.getContentSize(node);

    // Vertical scroll
    if (content.height > vpH) {
      const trackH = vpH;
      const thumbH = Math.max(20, (vpH / content.height) * trackH);
      const maxScroll = content.height - vpH;
      // Map localY within track to scroll position
      const ratio = Math.max(0, Math.min(1, (localY - thumbH / 2) / (trackH - thumbH)));
      node.setPropertyByPath('scroll_y', Math.round(ratio * maxScroll));
    }
    // Horizontal scroll
    if (content.width > vpW) {
      const trackW = vpW;
      const thumbW = Math.max(20, (vpW / content.width) * trackW);
      const maxScroll = content.width - vpW;
      const ratio = Math.max(0, Math.min(1, (localX - thumbW / 2) / (trackW - thumbW)));
      node.setPropertyByPath('scroll_x', Math.round(ratio * maxScroll));
    }
  }
}
