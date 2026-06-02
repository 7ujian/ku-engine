import type { Node } from './node.js';
import type { ComputedRect } from './types.js';
import { computeRect, getAnchors, getMargins } from './anchor.js';

/** Minimum size from node properties */
function getMinSize(node: Node): { width: number; height: number } {
  const minSize = node.getProperty('min_size') as { width?: number; height?: number } | undefined;
  const explicitW = minSize?.width ?? 0;
  const explicitH = minSize?.height ?? 0;
  // Use explicit min_size if set, otherwise fall back to width/height as implicit min
  const w = explicitW > 0 ? explicitW : (node.getProperty('width') as number) ?? 0;
  const h = explicitH > 0 ? explicitH : (node.getProperty('height') as number) ?? 0;
  return { width: w, height: h };
}

/** Get size flag from node properties */
function getSizeFlag(node: Node, axis: 'horizontal' | 'vertical'): string {
  const key = axis === 'horizontal' ? 'size_flags_horizontal' : 'size_flags_vertical';
  return (node.getProperty(key) as string) ?? 'fill';
}

/**
 * Compute the rect for a Control node within a parent rect.
 * Uses anchor+margin if anchors are set, otherwise falls back to x/y/width/height.
 */
export function computeControlRect(node: Node, parentRect: ComputedRect): ComputedRect {
  const anchors = getAnchors(node);
  const margins = getMargins(node);
  const local = computeRect(anchors, margins, parentRect.width, parentRect.height);
  return {
    x: parentRect.x + local.x,
    y: parentRect.y + local.y,
    width: local.width,
    height: local.height,
  };
}

/** Get container rect: prefer _computed from parent layout over re-computing */
function getContainerRect(container: Node, parentRect: ComputedRect): ComputedRect {
  if (container._computed) return container._computed;
  return computeControlRect(container, parentRect);
}

/** Layout resolver for VBoxContainer */
function layoutVBox(container: Node, parentRect: ComputedRect): void {
  const separation = (container.getProperty('separation') as number) ?? 4;
  const children = container.children;
  if (children.length === 0) return;

  const containerRect = getContainerRect(container, parentRect);

  // Calculate total min height and count expand children
  let totalMinHeight = 0;
  let expandCount = 0;
  const minSizes: { width: number; height: number }[] = [];

  for (const child of children) {
    const min = getMinSize(child);
    minSizes.push(min);
    totalMinHeight += min.height;
    if (getSizeFlag(child, 'vertical') === 'expand') expandCount++;
  }

  totalMinHeight += separation * (children.length - 1);
  const extraSpace = Math.max(0, containerRect.height - totalMinHeight);
  const expandShare = expandCount > 0 ? extraSpace / expandCount : 0;

  let y = containerRect.y;
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    const min = minSizes[i];
    const h = getSizeFlag(child, 'vertical') === 'expand'
      ? min.height + expandShare
      : min.height;
    child._computed = {
      x: containerRect.x,
      y,
      width: containerRect.width,
      height: h,
    };
    y += h + separation;
  }
}

/** Layout resolver for HBoxContainer */
function layoutHBox(container: Node, parentRect: ComputedRect): void {
  const separation = (container.getProperty('separation') as number) ?? 4;
  const children = container.children;
  if (children.length === 0) return;

  const containerRect = getContainerRect(container, parentRect);

  let totalMinWidth = 0;
  let expandCount = 0;
  const minSizes: { width: number; height: number }[] = [];

  for (const child of children) {
    const min = getMinSize(child);
    minSizes.push(min);
    totalMinWidth += min.width;
    if (getSizeFlag(child, 'horizontal') === 'expand') expandCount++;
  }

  totalMinWidth += separation * (children.length - 1);
  const extraSpace = Math.max(0, containerRect.width - totalMinWidth);
  const expandShare = expandCount > 0 ? extraSpace / expandCount : 0;

  let x = containerRect.x;
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    const min = minSizes[i];
    const w = getSizeFlag(child, 'horizontal') === 'expand'
      ? min.width + expandShare
      : min.width;
    child._computed = {
      x,
      y: containerRect.y,
      width: w,
      height: containerRect.height,
    };
    x += w + separation;
  }
}

/** Layout resolver for MarginContainer */
function layoutMargin(container: Node, parentRect: ComputedRect): void {
  const containerRect = getContainerRect(container, parentRect);
  const pl = (container.getProperty('padding_left') as number) ?? 0;
  const pr = (container.getProperty('padding_right') as number) ?? 0;
  const pt = (container.getProperty('padding_top') as number) ?? 0;
  const pb = (container.getProperty('padding_bottom') as number) ?? 0;

  if (container.children.length > 0) {
    const child = container.children[0];
    child._computed = {
      x: containerRect.x + pl,
      y: containerRect.y + pt,
      width: containerRect.width - pl - pr,
      height: containerRect.height - pt - pb,
    };
  }
}

/** Layout resolver for CenterContainer */
function layoutCenter(container: Node, parentRect: ComputedRect): void {
  const containerRect = getContainerRect(container, parentRect);

  if (container.children.length > 0) {
    const child = container.children[0];
    const min = getMinSize(child);
    child._computed = {
      x: containerRect.x + (containerRect.width - min.width) / 2,
      y: containerRect.y + (containerRect.height - min.height) / 2,
      width: min.width,
      height: min.height,
    };
  }
}

/** Layout resolver for Grid */
function layoutGrid(container: Node, parentRect: ComputedRect): void {
  const cols = Math.max(1, (container.getProperty('columns') as number) ?? 1);
  const colSpacing = (container.getProperty('column_spacing') as number) ?? 4;
  const rowSpacing = (container.getProperty('row_spacing') as number) ?? 4;
  const colMinWidth = (container.getProperty('column_min_width') as number) ?? 0;
  const children = container.children;
  if (children.length === 0) return;

  const containerRect = getContainerRect(container, parentRect);

  // Calculate column width (uniform, based on container width / cols)
  const totalColSpacing = colSpacing * (cols - 1);
  const colWidth = colMinWidth > 0
    ? Math.max(colMinWidth, (containerRect.width - totalColSpacing) / cols)
    : (containerRect.width - totalColSpacing) / cols;

  // Compute rows needed
  const rows = Math.ceil(children.length / cols);

  // Calculate row heights — max child height per row
  const rowHeights: number[] = [];
  for (let r = 0; r < rows; r++) {
    let maxH = 0;
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      if (idx < children.length) {
        const min = getMinSize(children[idx]);
        maxH = Math.max(maxH, min.height);
      }
    }
    rowHeights.push(maxH);
  }

  // Assign computed rects
  let y = containerRect.y;
  for (let r = 0; r < rows; r++) {
    let x = containerRect.x;
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      if (idx < children.length) {
        const child = children[idx];
        const vFlag = getSizeFlag(child, 'vertical');
        const h = vFlag === 'expand' ? rowHeights[r] : getMinSize(child).height;
        child._computed = {
          x,
          y,
          width: colWidth,
          height: h,
        };
      }
      x += colWidth + colSpacing;
    }
    y += rowHeights[r] + rowSpacing;
  }
}

/** Container layout dispatch */
const CONTAINER_LAYOUTS: Record<string, (node: Node, parentRect: ComputedRect) => void> = {
  VBoxContainer: layoutVBox,
  HBoxContainer: layoutHBox,
  MarginContainer: layoutMargin,
  CenterContainer: layoutCenter,
  Grid: layoutGrid,
};

/** Check if a node type is a container */
export function isContainerType(type: string): boolean {
  return type in CONTAINER_LAYOUTS;
}

/**
 * Resolve layout for a container node and all its children.
 * parentRect is the computed rect of the parent.
 */
export function resolveLayout(node: Node, parentRect: ComputedRect): void {
  const layoutFn = CONTAINER_LAYOUTS[node.type];
  if (layoutFn) {
    layoutFn(node, parentRect);
    // Recursively resolve children that are themselves containers
    for (const child of node.children) {
      if (child._computed && isContainerType(child.type)) {
        resolveLayout(child, child._computed);
      } else if (child._computed && child.children.length > 0) {
        // Non-container Control with children: resolve children relative to this
        for (const grandchild of child.children) {
          if (isContainerType(grandchild.type)) {
            resolveLayout(grandchild, child._computed);
          }
        }
      }
    }
  }
}
