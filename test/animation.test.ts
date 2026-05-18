import { describe, it, expect } from 'vitest';
import { advanceFrame, createAnimState, resolveAnimation } from '../src/engine/animation.js';

describe('advanceFrame', () => {
  it('loops by default', () => {
    const state = createAnimState();
    // 3 frames, 10 fps → 100ms per frame
    advanceFrame(state, 3, 150, 10, true, false);
    expect(state.frame).toBe(1);
    expect(state.finished).toBe(false);
  });

  it('wraps around with loop', () => {
    const state = { frame: 2, direction: 1 as const, elapsed: 0, finished: false };
    advanceFrame(state, 3, 150, 10, true, false);
    expect(state.frame).toBe(0); // wraps from 2 → 0
    expect(state.finished).toBe(false);
  });

  it('stops at last frame without loop', () => {
    const state = { frame: 2, direction: 1 as const, elapsed: 0, finished: false };
    advanceFrame(state, 3, 150, 10, false, false);
    expect(state.frame).toBe(2); // stays at last
    expect(state.finished).toBe(true);
  });

  it('ping-pongs direction', () => {
    const state = { frame: 2, direction: 1 as const, elapsed: 0, finished: false };
    advanceFrame(state, 3, 150, 10, true, true);
    expect(state.frame).toBe(2); // hit end, direction flips
    expect(state.direction).toBe(-1);
  });

  it('ping-pong reverses at start', () => {
    const state = { frame: 0, direction: -1 as const, elapsed: 0, finished: false };
    advanceFrame(state, 3, 150, 10, true, true);
    expect(state.direction).toBe(1);
  });

  it('ping-pong finishes at start without loop', () => {
    const state = { frame: 0, direction: -1 as const, elapsed: 0, finished: false };
    advanceFrame(state, 3, 150, 10, false, true);
    expect(state.finished).toBe(true);
  });

  it('no-ops on single frame', () => {
    const state = createAnimState();
    advanceFrame(state, 1, 500, 10, true, false);
    expect(state.frame).toBe(0);
  });

  it('no-ops when already finished', () => {
    const state = { frame: 2, direction: 1 as const, elapsed: 0, finished: true };
    advanceFrame(state, 3, 150, 10, false, false);
    expect(state.frame).toBe(2);
  });
});

describe('resolveAnimation', () => {
  it('resolves a simple string array', () => {
    const anim = resolveAnimation({ walk: ['f0', 'f1', 'f2'] }, 'walk');
    expect(anim).toEqual({ frames: ['f0', 'f1', 'f2'], speed: 10, loop: true, ping_pong: false });
  });

  it('resolves a full definition object', () => {
    const anim = resolveAnimation({
      run: { frames: ['r0', 'r1'], speed: 15, loop: false, ping_pong: true },
    }, 'run');
    expect(anim).toEqual({ frames: ['r0', 'r1'], speed: 15, loop: false, ping_pong: true });
  });

  it('returns null for missing animation', () => {
    expect(resolveAnimation({}, 'walk')).toBeNull();
  });
});
