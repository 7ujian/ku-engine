import { describe, it, expect } from 'vitest';
import { Node } from '../src/engine/node.js';
import { SceneTree } from '../src/engine/scene-tree.js';
import { computeControlRect } from '../src/engine/layout.js';
import { hasAnchors, ANCHOR_PRESETS } from '../src/engine/anchor.js';
import {
  createPanel,
  createButton,
  createImageRect,
  createScrollView,
  createLabel,
  createTheme,
} from '../src/engine/node-types.js';

describe('Legacy scene backward compatibility', () => {
  it('Panel without anchors renders at x, y', () => {
    const panel = createPanel('bg', { x: 50, y: 30, width: 200, height: 100 });
    expect(hasAnchors(panel)).toBe(false);

    const rect = computeControlRect(panel, { x: 0, y: 0, width: 800, height: 600 });
    expect(rect).toEqual({ x: 50, y: 30, width: 200, height: 100 });
  });

  it('Button without anchors renders at x, y', () => {
    const btn = createButton('ok', { x: 100, y: 200, width: 80, height: 30, text: 'OK' });
    expect(hasAnchors(btn)).toBe(false);

    const rect = computeControlRect(btn, { x: 0, y: 0, width: 800, height: 600 });
    expect(rect).toEqual({ x: 100, y: 200, width: 80, height: 30 });
  });

  it('ImageRect without anchors renders at x, y', () => {
    const img = createImageRect('avatar', { x: 10, y: 10, width: 64, height: 64, texture: 'face.png' });
    expect(hasAnchors(img)).toBe(false);

    const rect = computeControlRect(img, { x: 0, y: 0, width: 800, height: 600 });
    expect(rect).toEqual({ x: 10, y: 10, width: 64, height: 64 });
  });

  it('ScrollView without anchors renders at x, y', () => {
    const sv = createScrollView('list', { x: 20, y: 50, width: 300, height: 400 });
    expect(hasAnchors(sv)).toBe(false);

    const rect = computeControlRect(sv, { x: 0, y: 0, width: 800, height: 600 });
    expect(rect).toEqual({ x: 20, y: 50, width: 300, height: 400 });
  });

  it('Panel with anchors overrides x, y', () => {
    const panel = createPanel('fullscreen', {
      anchor_left: 0, anchor_right: 1,
      anchor_top: 0, anchor_bottom: 1,
      margin_left: 0, margin_right: 0,
      margin_top: 0, margin_bottom: 0,
      width: 800, height: 600,
    });
    expect(hasAnchors(panel)).toBe(true);

    const rect = computeControlRect(panel, { x: 0, y: 0, width: 800, height: 600 });
    expect(rect).toEqual({ x: 0, y: 0, width: 800, height: 600 });
  });

  it('Label has Control base properties', () => {
    const label = createLabel('title', { text: 'Hello' });
    expect(label.getProperty('anchor_left')).toBe(0);
    expect(label.getProperty('size_flags_horizontal')).toBe('fill');
    expect(label.getProperty('focus_mode')).toBe('none');
    expect(label.getProperty('autowrap')).toBe(false);
  });
});

describe('Theme node', () => {
  it('creates with default colors', () => {
    const theme = createTheme('theme');
    expect(theme.type).toBe('Theme');
    const colors = theme.getProperty('colors') as Record<string, string>;
    expect(colors.bg_color).toBe('#1a1a2e');
    expect(colors.fg_color).toBe('#ffffff');
    expect(colors.accent_color).toBe('#6a6aff');
  });

  it('creates with default font sizes', () => {
    const theme = createTheme('theme');
    const fonts = theme.getProperty('font_size') as Record<string, number>;
    expect(fonts.normal).toBe(14);
    expect(fonts.title).toBe(24);
  });

  it('creates with default constants', () => {
    const theme = createTheme('theme');
    const constants = theme.getProperty('constants') as Record<string, number>;
    expect(constants.spacing).toBe(4);
    expect(constants.corner_radius).toBe(4);
  });

  it('allows overriding colors', () => {
    const theme = createTheme('dark', {
      colors: {
        bg_color: '#000000',
        fg_color: '#cccccc',
        accent_color: '#ff0000',
        error_color: '#ff4444',
        disabled_color: '#333333',
        border_color: '#222222',
      },
    });
    const colors = theme.getProperty('colors') as Record<string, string>;
    expect(colors.bg_color).toBe('#000000');
    expect(colors.accent_color).toBe('#ff0000');
  });
});
