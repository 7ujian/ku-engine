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
