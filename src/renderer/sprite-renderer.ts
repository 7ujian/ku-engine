import { type Canvas, loadImage, type Image } from '@napi-rs/canvas';
import { resolve } from 'node:path';
import { Node } from '../engine/node.js';
import type { AtlasDef } from '../engine/atlas.js';
import { loadAtlas, regionByName } from '../engine/atlas.js';
import { type AnimState, advanceFrame, createAnimState, resolveAnimation } from '../engine/animation.js';

type Ctx = ReturnType<Canvas['getContext']>;

export class SpriteRenderer {
  private ctx: Ctx;
  private projectDir: string;
  private textureCache = new Map<string, Image>();
  private atlasCache = new Map<string, AtlasDef>();
  private animTimers = new Map<string, { elapsed: number; frame: number }>();
  private atlasAnimState = new Map<string, AnimState>();

  constructor(ctx: Ctx, projectDir = '.') {
    this.ctx = ctx;
    this.projectDir = resolve(projectDir);
  }

  private resolvePath(p: string): string {
    if (p.startsWith('/')) return p;
    return resolve(this.projectDir, p);
  }

  drawSprite(node: Node, x: number, y: number, dt: number): void {
    const atlasRel = (node.getProperty('atlas') as string) ?? '';
    const regionName = (node.getProperty('region') as string) ?? '';

    if (atlasRel) {
      this.drawAtlasRegion(node, x, y, this.resolvePath(atlasRel), regionName);
      return;
    }

    const texture = (node.getProperty('texture') as string) ?? '';
    const flipH = node.getProperty('flip_h') === true;
    const flipV = node.getProperty('flip_v') === true;
    const hframes = (node.getProperty('hframes') as number) ?? 1;
    const frame = (node.getProperty('frame') as number) ?? 0;

    if (!texture) {
      this.ctx.fillStyle = '#ff00ff';
      this.ctx.fillRect(x - 16, y - 16, 32, 32);
      return;
    }

    const absTex = this.resolvePath(texture);
    const img = this.getTextureSync(absTex);
    if (!img) return;

    const ctx = this.ctx;
    ctx.save();

    if (hframes > 1) {
      const frameWidth = img.width / hframes;
      const sx = frame * frameWidth;
      if (flipH || flipV) {
        ctx.translate(x, y);
        ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
        ctx.drawImage(img, sx, 0, frameWidth, img.height, -frameWidth / 2, -img.height / 2, frameWidth, img.height);
      } else {
        ctx.drawImage(img, sx, 0, frameWidth, img.height, x - frameWidth / 2, y - img.height / 2, frameWidth, img.height);
      }
    } else {
      if (flipH || flipV) {
        ctx.translate(x, y);
        ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
        ctx.drawImage(img, -img.width / 2, -img.height / 2);
      } else {
        ctx.drawImage(img, x - img.width / 2, y - img.height / 2);
      }
    }

    ctx.restore();
  }

  drawAnimatedSprite(node: Node, x: number, y: number, dt: number): void {
    const atlasRel = (node.getProperty('atlas') as string) ?? '';

    if (atlasRel) {
      this.drawAtlasAnimation(node, x, y, dt, this.resolvePath(atlasRel));
      return;
    }

    const frames = node.getProperty('frames') as string[] | undefined;
    const playing = node.getProperty('playing') === true;
    const speed = (node.getProperty('speed') as number) ?? 10;
    const flipH = node.getProperty('flip_h') === true;
    const flipV = node.getProperty('flip_v') === true;

    if (!frames || frames.length === 0) {
      const texture = (node.getProperty('texture') as string) ?? '';
      if (texture) {
        node.setProperty('hframes', 1);
        node.setProperty('frame', 0);
        this.drawSprite(node, x, y, dt);
      } else {
        this.ctx.fillStyle = '#00ffff';
        this.ctx.fillRect(x - 16, y - 16, 32, 32);
      }
      return;
    }

    // Advance animation frame
    let currentFrame = (node.getProperty('frame') as number) ?? 0;
    if (playing && speed > 0) {
      let timer = this.animTimers.get(node.id);
      if (!timer) {
        timer = { elapsed: 0, frame: currentFrame };
        this.animTimers.set(node.id, timer);
      }
      timer.elapsed += dt;
      const frameDuration = 1000 / speed;
      while (timer.elapsed >= frameDuration) {
        timer.elapsed -= frameDuration;
        timer.frame = (timer.frame + 1) % frames.length;
      }
      currentFrame = timer.frame;
      node.setProperty('frame', currentFrame);
    }

    const texture = frames[currentFrame] ?? frames[0];
    if (!texture) return;

    const absTex = this.resolvePath(texture);
    const img = this.getTextureSync(absTex);
    if (!img) return;

    const ctx = this.ctx;
    ctx.save();
    if (flipH || flipV) {
      ctx.translate(x, y);
      ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
      ctx.drawImage(img, -img.width / 2, -img.height / 2);
    } else {
      ctx.drawImage(img, x - img.width / 2, y - img.height / 2);
    }
    ctx.restore();
  }

  private drawAtlasRegion(node: Node, x: number, y: number, atlasPath: string, regionName: string): void {
    const atlas = this.atlasCache.get(atlasPath);
    if (!atlas) return;

    const region = regionName ? regionByName(atlas, regionName) : null;
    if (!region) {
      this.ctx.fillStyle = '#ff00ff';
      this.ctx.fillRect(x - 16, y - 16, 32, 32);
      return;
    }

    const img = this.getTextureSync(atlas.texture);
    if (!img) return;

    const flipH = node.getProperty('flip_h') === true;
    const flipV = node.getProperty('flip_v') === true;
    const ctx = this.ctx;
    ctx.save();

    if (flipH || flipV) {
      ctx.translate(x, y);
      ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
      ctx.drawImage(img, region.x, region.y, region.width, region.height, -region.width / 2, -region.height / 2, region.width, region.height);
    } else {
      ctx.drawImage(img, region.x, region.y, region.width, region.height, x - region.width / 2, y - region.height / 2, region.width, region.height);
    }

    ctx.restore();
  }

  private drawAtlasAnimation(node: Node, x: number, y: number, dt: number, atlasPath: string): void {
    const atlas = this.atlasCache.get(atlasPath);
    if (!atlas) return;

    const animName = (node.getProperty('animation') as string) ?? '';
    const animations = (node.getProperty('animations') as Record<string, unknown>) ?? {};
    const animDef = resolveAnimation(animations, animName);

    if (!animDef || animDef.frames.length === 0) {
      // Fallback: draw a single region if set
      const regionName = (node.getProperty('region') as string) ?? '';
      this.drawAtlasRegion(node, x, y, atlasPath, regionName);
      return;
    }

    const playing = node.getProperty('playing') === true;
    let state = this.atlasAnimState.get(node.id);
    if (!state) {
      state = createAnimState();
      this.atlasAnimState.set(node.id, state);
    }

    if (playing) {
      advanceFrame(state, animDef.frames.length, dt, animDef.speed, animDef.loop, animDef.ping_pong);
    }

    const regionName = animDef.frames[state.frame];
    const region = regionByName(atlas, regionName);
    if (!region) return;

    const img = this.getTextureSync(atlas.texture);
    if (!img) return;

    const flipH = node.getProperty('flip_h') === true;
    const flipV = node.getProperty('flip_v') === true;
    const ctx = this.ctx;
    ctx.save();

    if (flipH || flipV) {
      ctx.translate(x, y);
      ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
      ctx.drawImage(img, region.x, region.y, region.width, region.height, -region.width / 2, -region.height / 2, region.width, region.height);
    } else {
      ctx.drawImage(img, region.x, region.y, region.width, region.height, x - region.width / 2, y - region.height / 2, region.width, region.height);
    }

    ctx.restore();
    node.setProperty('frame', state.frame);
  }

  getTextureSync(path: string): Image | null {
    return this.textureCache.get(path) ?? null;
  }

  async loadTexture(path: string): Promise<Image | null> {
    const abs = this.resolvePath(path);
    if (this.textureCache.has(abs)) return this.textureCache.get(abs)!;
    try {
      const img = await loadImage(abs);
      this.textureCache.set(abs, img);
      return img;
    } catch (err) {
      console.error(`[renderer] failed to load texture: ${abs}`, err instanceof Error ? err.message : err);
      return null;
    }
  }

  async loadAtlasFile(jsonPath: string): Promise<AtlasDef | null> {
    const abs = this.resolvePath(jsonPath);
    if (this.atlasCache.has(abs)) return this.atlasCache.get(abs)!;
    try {
      const atlas = await loadAtlas(abs);
      this.atlasCache.set(abs, atlas);
      // Pre-load the atlas texture image
      await this.loadTexture(atlas.texture);
      return atlas;
    } catch (err) {
      console.error(`[renderer] failed to load atlas: ${abs}`, err instanceof Error ? err.message : err);
      return null;
    }
  }

  hasAtlas(jsonPath: string): boolean {
    return this.atlasCache.has(this.resolvePath(jsonPath));
  }

  clearAnimTimer(nodeId: string): void {
    this.animTimers.delete(nodeId);
    this.atlasAnimState.delete(nodeId);
  }
}
