export interface AnimationDef {
  frames: string[];
  speed: number;
  loop: boolean;
  ping_pong: boolean;
}

export interface AnimState {
  frame: number;
  direction: 1 | -1;
  elapsed: number;
  finished: boolean;
}

export function createAnimState(): AnimState {
  return { frame: 0, direction: 1, elapsed: 0, finished: false };
}

export function advanceFrame(
  state: AnimState,
  totalFrames: number,
  dt: number,
  speed: number,
  loop: boolean,
  pingPong: boolean,
): void {
  if (totalFrames <= 1 || speed <= 0) return;
  if (state.finished) return;

  state.elapsed += dt;
  const frameDuration = 1000 / speed;

  while (state.elapsed >= frameDuration) {
    state.elapsed -= frameDuration;

    if (pingPong) {
      state.frame += state.direction;
      if (state.frame >= totalFrames - 1) {
        state.frame = totalFrames - 1;
        state.direction = -1;
      } else if (state.frame <= 0) {
        state.frame = 0;
        state.direction = 1;
        if (!loop) state.finished = true;
      }
    } else {
      state.frame++;
      if (state.frame >= totalFrames) {
        if (loop) {
          state.frame = 0;
        } else {
          state.frame = totalFrames - 1;
          state.finished = true;
        }
      }
    }
  }
}

export function resolveAnimation(
  animations: Record<string, unknown>,
  name: string,
): AnimationDef | null {
  const raw = animations[name];
  if (!raw) return null;

  if (Array.isArray(raw)) {
    return { frames: raw as string[], speed: 10, loop: true, ping_pong: false };
  }

  if (typeof raw === 'object' && raw !== null) {
    const obj = raw as Record<string, unknown>;
    return {
      frames: Array.isArray(obj.frames) ? (obj.frames as string[]) : [],
      speed: typeof obj.speed === 'number' ? obj.speed : 10,
      loop: typeof obj.loop === 'boolean' ? obj.loop : true,
      ping_pong: typeof obj.ping_pong === 'boolean' ? obj.ping_pong : false,
    };
  }

  return null;
}

// --- Property Animation (AnimationPlayer) ---

export interface Keyframe {
  t: number;
  value: number;
}

export interface AnimTrack {
  keyframes: Keyframe[];
  easing?: string;
  target?: string;
}

export interface PropertyAnimation {
  duration: number;
  loop?: boolean;
  tracks: Record<string, AnimTrack>;
}

export type EasingFn = (t: number) => number;

const easingFunctions: Record<string, EasingFn> = {
  linear: (t) => t,
  ease_in: (t) => t * t,
  ease_out: (t) => t * (2 - t),
  ease_in_out: (t) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),
  bounce: (t) => {
    if (t < 1 / 2.75) return 7.5625 * t * t;
    if (t < 2 / 2.75) return 7.5625 * (t -= 1.5 / 2.75) * t + 0.75;
    if (t < 2.5 / 2.75) return 7.5625 * (t -= 2.25 / 2.75) * t + 0.9375;
    return 7.5625 * (t -= 2.625 / 2.75) * t + 0.984375;
  },
};

export function getEasing(name?: string): EasingFn {
  if (!name) return easingFunctions.linear;
  return easingFunctions[name] ?? easingFunctions.linear;
}

export function interpolateKeyframes(keyframes: Keyframe[], progress: number, easingFn: EasingFn): number {
  if (keyframes.length === 0) return 0;
  if (keyframes.length === 1) return keyframes[0].value;

  const t = easingFn(Math.max(0, Math.min(1, progress)));

  let lo = 0;
  for (let i = 0; i < keyframes.length - 1; i++) {
    if (t >= keyframes[i].t && t <= keyframes[i + 1].t) { lo = i; break; }
    if (i === keyframes.length - 2) lo = i;
  }

  const a = keyframes[lo];
  const b = keyframes[lo + 1];
  const segLen = b.t - a.t;
  const segT = segLen > 0 ? (t - a.t) / segLen : 0;
  return a.value + (b.value - a.value) * segT;
}

// --- Multi-node track application ---

export interface TrackTargetResolver {
  get(path: string): unknown;
}

export function applyAnimationTracks(
  tracks: Record<string, unknown>,
  progress: number,
  defaultTarget: unknown | null,
  resolver: TrackTargetResolver,
): void {
  for (const [prop, track] of Object.entries(tracks)) {
    const t = track as AnimTrack;
    if (!t.keyframes || t.keyframes.length === 0) continue;
    const value = interpolateKeyframes(t.keyframes, progress, getEasing(t.easing));

    let target = defaultTarget;
    if (t.target) {
      try { target = resolver.get(t.target); } catch { continue; }
    }
    if (!target) continue;

    (target as { setPropertyByPath(prop: string, value: unknown): void })
      .setPropertyByPath(prop, value);
  }
}

