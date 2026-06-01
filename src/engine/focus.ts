import type { Node } from './node.js';

export class FocusManager {
  focusedNode: Node | null = null;
  private modalStack: Node[] = [];

  setFocus(node: Node): void {
    const focusMode = (node.getProperty('focus_mode') as string) ?? 'none';
    if (focusMode === 'none') return;

    if (this.modalStack.length > 0) {
      const modal = this.modalStack[this.modalStack.length - 1];
      if (!isDescendantOf(node, modal)) return;
    }

    this.focusedNode = node;
  }

  clearFocus(): void {
    this.focusedNode = null;
  }

  pushModal(node: Node): void {
    this.modalStack.push(node);
  }

  popModal(): void {
    this.modalStack.pop();
    if (this.focusedNode && this.modalStack.length > 0) {
      const modal = this.modalStack[this.modalStack.length - 1];
      if (!isDescendantOf(this.focusedNode, modal)) {
        this.focusedNode = null;
      }
    }
  }

  get activeModal(): Node | null {
    return this.modalStack.length > 0 ? this.modalStack[this.modalStack.length - 1] : null;
  }

  findNextFocus(current: Node, root: Node, direction: 1 | -1): Node | null {
    const focusable: Node[] = [];
    collectFocusable(root, focusable);
    if (focusable.length === 0) return null;

    const idx = focusable.indexOf(current);
    if (idx === -1) return focusable[0];

    const nextIdx = (idx + direction + focusable.length) % focusable.length;
    return focusable[nextIdx];
  }
}

function isDescendantOf(node: Node, ancestor: Node): boolean {
  let current: Node | null = node;
  while (current !== null) {
    if (current === ancestor) return true;
    current = current.parent;
  }
  return false;
}

function collectFocusable(node: Node, result: Node[]): void {
  const focusMode = (node.getProperty('focus_mode') as string) ?? 'none';
  if (focusMode !== 'none') {
    result.push(node);
  }
  for (const child of node.children) {
    collectFocusable(child, result);
  }
}
