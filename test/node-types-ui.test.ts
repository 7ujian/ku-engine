import { describe, it, expect } from 'vitest';
import {
  createControl,
  createCanvasLayer,
  createVBoxContainer,
  createHBoxContainer,
  createMarginContainer,
  createCenterContainer,
  createSlider,
  createToggle,
  createTheme,
} from '../src/engine/node-types.js';

describe('Control base type', () => {
  it('has anchor and margin defaults', () => {
    const node = createControl('ctrl');
    expect(node.type).toBe('Control');
    expect(node.getProperty('anchor_left')).toBe(0);
    expect(node.getProperty('margin_left')).toBe(0);
    expect(node.getProperty('size_flags_horizontal')).toBe('fill');
    expect(node.getProperty('focus_mode')).toBe('none');
    expect(node.getProperty('visible')).toBe(true);
  });
});

describe('CanvasLayer', () => {
  it('has layer properties', () => {
    const node = createCanvasLayer('hud');
    expect(node.type).toBe('CanvasLayer');
    expect(node.getProperty('layer')).toBe(0);
    expect(node.getProperty('follow_viewport')).toBe(true);
    expect(node.getProperty('visible')).toBe(true);
  });
});

describe('Container types', () => {
  it('VBoxContainer has separation', () => {
    const node = createVBoxContainer('vbox');
    expect(node.type).toBe('VBoxContainer');
    expect(node.getProperty('separation')).toBe(4);
  });

  it('HBoxContainer has separation', () => {
    const node = createHBoxContainer('hbox');
    expect(node.type).toBe('HBoxContainer');
    expect(node.getProperty('separation')).toBe(4);
  });

  it('MarginContainer has padding', () => {
    const node = createMarginContainer('mc');
    expect(node.type).toBe('MarginContainer');
    expect(node.getProperty('padding_left')).toBe(0);
    expect(node.getProperty('padding_right')).toBe(0);
  });

  it('CenterContainer', () => {
    const node = createCenterContainer('cc');
    expect(node.type).toBe('CenterContainer');
  });
});

describe('Slider', () => {
  it('has slider properties', () => {
    const node = createSlider('vol');
    expect(node.type).toBe('Slider');
    expect(node.getProperty('min_value')).toBe(0);
    expect(node.getProperty('max_value')).toBe(100);
    expect(node.getProperty('value')).toBe(0);
    expect(node.getProperty('orientation')).toBe('horizontal');
    expect(node.getProperty('step')).toBe(1);
    expect(node.getProperty('clickable')).toBe(true);
  });
});

describe('Toggle', () => {
  it('has toggle properties', () => {
    const node = createToggle('chk');
    expect(node.type).toBe('Toggle');
    expect(node.getProperty('pressed')).toBe(false);
    expect(node.getProperty('group')).toBe('');
    expect(node.getProperty('clickable')).toBe(true);
  });
});

describe('Theme', () => {
  it('has theme colors and constants', () => {
    const node = createTheme('theme');
    expect(node.type).toBe('Theme');
    const colors = node.getProperty('colors') as Record<string, string>;
    expect(colors.bg_color).toBe('#1a1a2e');
    expect(colors.accent_color).toBe('#6a6aff');
    const constants = node.getProperty('constants') as Record<string, number>;
    expect(constants.margin).toBe(8);
  });
});
