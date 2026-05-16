import { type Canvas, loadImage, type Image } from '@napi-rs/canvas';
import { Node } from '../engine/node.js';

type Ctx = ReturnType<Canvas['getContext']>;

export class SpriteRenderer {
  private ctx: Ctx;
  private textureCache = new Map<string, Image>();
  private animTimers = new Map<string, { elapsed: number; frame: number }>();

  constructor(ctx: Ctx) {
    this.ctx = ctx;
  }

  drawSprite(node: Node, x: number, y: number, dt: number): void {
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

    const img = this.getTextureSync(texture);
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

    const img = this.getTextureSync(texture);
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

  getTextureSync(path: string): Image | null {
    return this.textureCache.get(path) ?? null;
  }

  async loadTexture(path: string): Promise<Image | null> {
    if (this.textureCache.has(path)) return this.textureCache.get(path)!;
    try {
      const img = await loadImage(path);
      this.textureCache.set(path, img);
      return img;
    } catch {
      return null;
    }
  }

  clearAnimTimer(nodeId: string): void {
    this.animTimers.delete(nodeId);
  }
}
