import { describe, it, expect } from 'vitest';
import { advanceFrame, createAnimState, resolveAnimation, applyAnimationTracks, type TrackTargetResolver } from '../src/engine/animation.js';
import { SceneTree } from '../src/engine/scene-tree.js';
import { Node } from '../src/engine/node.js';

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

describe('applyAnimationTracks', () => {
  function makeTree(...nodeDefs: Array<{ id: string; type: string; props?: Record<string, unknown> }>): { tree: SceneTree; nodes: Record<string, Node> } {
    const root = new Node('root', 'Node');
    const tree = new SceneTree(root);
    const nodes: Record<string, Node> = {};
    for (const def of nodeDefs) {
      const n = new Node(def.id, def.type);
      if (def.props) {
        for (const [k, v] of Object.entries(def.props)) {
          n.setProperty(k, v);
        }
      }
      root.addChild(n);
      nodes[def.id] = n;
    }
    return { tree, nodes };
  }

  it('applies tracks to default target', () => {
    const { tree, nodes } = makeTree(
      { id: 'target', type: 'Node2D', props: { x: 0, rotation: 0 } },
    );

    applyAnimationTracks(
      {
        x: { keyframes: [{ t: 0, value: 0 }, { t: 1, value: 100 }] },
        rotation: { keyframes: [{ t: 0, value: 0 }, { t: 1, value: 3.14 }] },
      },
      0.5,
      nodes['target'],
      tree,
    );

    expect(nodes['target'].getProperty('x')).toBe(50);
    expect(nodes['target'].getProperty('rotation')).toBeCloseTo(1.57, 1);
  });

  it('uses per-track target when specified', () => {
    const { tree, nodes } = makeTree(
      { id: 'panel', type: 'Node2D', props: { scale_x: 0, rotation: 0 } },
      { id: 'icon', type: 'Node2D', props: { rotation: 0 } },
    );

    applyAnimationTracks(
      {
        scale_x: { keyframes: [{ t: 0, value: 0 }, { t: 1, value: 1 }] },
        rotation: {
          target: 'icon',
          keyframes: [{ t: 0, value: 0 }, { t: 1, value: 6.28 }],
        },
      },
      1,
      nodes['panel'],
      tree,
    );

    expect(nodes['panel'].getProperty('scale_x')).toBe(1);
    expect(nodes['panel'].getProperty('rotation')).toBe(0);
    expect(nodes['icon'].getProperty('rotation')).toBeCloseTo(6.28);
  });

  it('works with no default target using per-track targets', () => {
    const { tree, nodes } = makeTree(
      { id: 'a', type: 'Node2D', props: { x: 0 } },
      { id: 'b', type: 'Node2D', props: { y: 0 } },
    );

    applyAnimationTracks(
      {
        x: { target: 'a', keyframes: [{ t: 0, value: 0 }, { t: 1, value: 50 }] },
        y: { target: 'b', keyframes: [{ t: 0, value: 0 }, { t: 1, value: 100 }] },
      },
      0.5,
      null,
      tree,
    );

    expect(nodes['a'].getProperty('x')).toBe(25);
    expect(nodes['b'].getProperty('y')).toBe(50);
  });

  it('skips tracks with invalid per-track target', () => {
    const { tree, nodes } = makeTree(
      { id: 'target', type: 'Node2D', props: { x: 0 } },
    );

    applyAnimationTracks(
      {
        x: { keyframes: [{ t: 0, value: 0 }, { t: 1, value: 100 }] },
        rotation: {
          target: 'nonexistent',
          keyframes: [{ t: 0, value: 0 }, { t: 1, value: 3.14 }],
        },
      },
      1,
      nodes['target'],
      tree,
    );

    // Default target track applied fine
    expect(nodes['target'].getProperty('x')).toBe(100);
    // Invalid track silently skipped — no crash
    expect(nodes['target'].getProperty('rotation')).toBeUndefined();
  });

  it('skips tracks when both default and per-track target are null', () => {
    const { tree } = makeTree();

    // Should not throw
    applyAnimationTracks(
      {
        x: { keyframes: [{ t: 0, value: 0 }, { t: 1, value: 100 }] },
      },
      0.5,
      null,
      tree,
    );
  });
});
