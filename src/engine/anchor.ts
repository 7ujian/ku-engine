import type { AnchorDef, MarginDef, ComputedRect } from './types.js';

/** Named anchor presets matching Godot's layout presets */
export const ANCHOR_PRESETS: Record<string, AnchorDef> = {
  fullscreen:     { anchor_left: 0,   anchor_right: 1,   anchor_top: 0,   anchor_bottom: 1 },
  top_left:       { anchor_left: 0,   anchor_right: 0,   anchor_top: 0,   anchor_bottom: 0 },
  top_right:      { anchor_left: 1,   anchor_right: 1,   anchor_top: 0,   anchor_bottom: 0 },
  bottom_left:    { anchor_left: 0,   anchor_right: 0,   anchor_top: 1,   anchor_bottom: 1 },
  bottom_right:   { anchor_left: 1,   anchor_right: 1,   anchor_top: 1,   anchor_bottom: 1 },
  center:         { anchor_left: 0.5, anchor_right: 0.5, anchor_top: 0.5, anchor_bottom: 0.5 },
  left_wide:      { anchor_left: 0,   anchor_right: 0,   anchor_top: 0,   anchor_bottom: 1 },
  top_wide:       { anchor_left: 0,   anchor_right: 1,   anchor_top: 0,   anchor_bottom: 0 },
  right_wide:     { anchor_left: 1,   anchor_right: 1,   anchor_top: 0,   anchor_bottom: 1 },
  bottom_wide:    { anchor_left: 0,   anchor_right: 1,   anchor_top: 1,   anchor_bottom: 1 },
  vcenter_wide:   { anchor_left: 0,   anchor_right: 1,   anchor_top: 0.5, anchor_bottom: 0.5 },
  hcenter_wide:   { anchor_left: 0.5, anchor_right: 0.5, anchor_top: 0,   anchor_bottom: 1 },
};

/**
 * Compute absolute rect from anchors + margins within parent rect.
 */
export function computeRect(
  anchors: AnchorDef,
  margins: MarginDef,
  parentWidth: number,
  parentHeight: number,
): ComputedRect {
  const left   = parentWidth  * anchors.anchor_left   + margins.left;
  const right  = parentWidth  * anchors.anchor_right  + margins.right;
  const top    = parentHeight * anchors.anchor_top    + margins.top;
  const bottom = parentHeight * anchors.anchor_bottom + margins.bottom;
  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  };
}

/**
 * Read anchor values from a node's properties.
 * Returns all-zero defaults if no anchors set.
 */
export function getAnchors(node: import('./node.js').Node): AnchorDef {
  return {
    anchor_left:   (node.getProperty('anchor_left')   as number) ?? 0,
    anchor_right:  (node.getProperty('anchor_right')  as number) ?? 0,
    anchor_top:    (node.getProperty('anchor_top')     as number) ?? 0,
    anchor_bottom: (node.getProperty('anchor_bottom')  as number) ?? 0,
  };
}

/**
 * Read margin values from a node's properties.
 * Falls back to computing from x, y, width, height for backward compat.
 */
export function getMargins(node: import('./node.js').Node): MarginDef {
  const hasAnchors = node.getProperty('anchor_left') !== undefined
    || node.getProperty('anchor_right') !== undefined
    || node.getProperty('anchor_top') !== undefined
    || node.getProperty('anchor_bottom') !== undefined;

  if (hasAnchors) {
    return {
      left:   (node.getProperty('margin_left')   as number) ?? 0,
      right:  (node.getProperty('margin_right')  as number) ?? 0,
      top:    (node.getProperty('margin_top')     as number) ?? 0,
      bottom: (node.getProperty('margin_bottom')  as number) ?? 0,
    };
  }

  // Legacy mode: derive margins from absolute x, y, width, height
  const x = (node.getProperty('x') as number) ?? 0;
  const y = (node.getProperty('y') as number) ?? 0;
  const w = (node.getProperty('width') as number) ?? 0;
  const h = (node.getProperty('height') as number) ?? 0;
  return {
    left: x,
    right: x + w,
    top: y,
    bottom: y + h,
  };
}

/**
 * Check if a node has any anchor properties set (vs legacy x/y positioning).
 */
export function hasAnchors(node: import('./node.js').Node): boolean {
  return node.getProperty('anchor_left') !== undefined
    || node.getProperty('anchor_right') !== undefined
    || node.getProperty('anchor_top') !== undefined
    || node.getProperty('anchor_bottom') !== undefined;
}

/**
 * Check if a node type is a Control (UI) type.
 */
export const CONTROL_TYPES = new Set([
  'Panel', 'Button', 'ImageRect', 'ScrollView', 'Label',
  'Slider', 'Toggle',
  'VBoxContainer', 'HBoxContainer', 'MarginContainer', 'CenterContainer',
  'ProfilerGui',
]);

export function isControlType(type: string): boolean {
  return CONTROL_TYPES.has(type);
}
