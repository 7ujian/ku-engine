import { describe, it, expect } from 'vitest';
import {
  ANCHOR_PRESETS,
  computeRect,
} from '../src/engine/anchor.js';

describe('anchor types', () => {
  it('ANCHOR_PRESETS has required presets', () => {
    const required = ['fullscreen', 'top_left', 'top_right', 'bottom_left', 'bottom_right', 'center', 'left_wide', 'top_wide', 'right_wide', 'bottom_wide', 'vcenter_wide', 'hcenter_wide'];
    for (const name of required) {
      expect(ANCHOR_PRESETS).toHaveProperty(name);
    }
  });

  it('fullscreen preset fills parent', () => {
    const rect = computeRect(ANCHOR_PRESETS.fullscreen, { left: 0, right: 0, top: 0, bottom: 0 }, 800, 600);
    expect(rect).toEqual({ x: 0, y: 0, width: 800, height: 600 });
  });

  it('top_left preset at origin with margins', () => {
    const rect = computeRect(ANCHOR_PRESETS.top_left, { left: 10, right: 110, top: 10, bottom: 50 }, 800, 600);
    expect(rect).toEqual({ x: 10, y: 10, width: 100, height: 40 });
  });

  it('center preset with negative margins for sizing', () => {
    const preset = ANCHOR_PRESETS.center;
    const rect = computeRect(preset, { left: -50, right: 50, top: -20, bottom: 20 }, 800, 600);
    expect(rect).toEqual({ x: 350, y: 280, width: 100, height: 40 });
  });
});
