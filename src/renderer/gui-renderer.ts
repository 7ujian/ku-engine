import { type Canvas, loadImage, type Image } from '@napi-rs/canvas';
import { resolve } from 'node:path';
import type { Node } from '../engine/node.js';

type Ctx = ReturnType<Canvas['getContext']>;

const GUI_TYPES = new Set(['Panel', 'Button', 'ImageRect', 'ScrollView']);

export function isGuiType(type: string): boolean {
  return GUI_TYPES.has(type);
}

export class GuiRenderer {
  ctx: Ctx;
  private projectDir: string;
  private textureCache = new Map<string, Image>();

  constructor(ctx: Ctx, projectDir = '.') {
    this.ctx = ctx;
    this.projectDir = resolve(projectDir);
  }

  private resolvePath(p: string): string {
    if (p.startsWith('/')) return p;
    return resolve(this.projectDir, p);
  }

  private async getTexture(path: string): Promise<Image | null> {
    const abs = this.resolvePath(path);
    if (this.textureCache.has(abs)) return this.textureCache.get(abs)!;
    try {
      const img = await loadImage(abs);
      this.textureCache.set(abs, img);
      return img;
    } catch (err) {
      console.error(`[gui] failed to load texture: ${abs}`, err instanceof Error ? err.message : err);
      return null;
    }
  }

  async loadTexture(path: string): Promise<Image | null> {
    return this.getTexture(path);
  }

  hasTexture(absPath: string): boolean {
    return this.textureCache.has(absPath);
  }

  drawPanel(node: Node, wx: number, wy: number): void {
    const w = (node.getProperty('width') as number) ?? 100;
    const h = (node.getProperty('height') as number) ?? 100;
    const color = (node.getProperty('color') as string) ?? '#1a1a2e';
    const borderColor = (node.getProperty('border_color') as string) ?? '#ffffff';
    const borderWidth = (node.getProperty('border_width') as number) ?? 0;
    const radius = (node.getProperty('corner_radius') as number) ?? 0;

    const ctx = this.ctx;
    ctx.save();

    if (radius > 0) {
      this.roundedRect(wx, wy, w, h, radius);
      ctx.fillStyle = color;
      ctx.fill();
      if (borderWidth > 0) {
        ctx.strokeStyle = borderColor;
        ctx.lineWidth = borderWidth;
        ctx.stroke();
      }
    } else {
      ctx.fillStyle = color;
      ctx.fillRect(wx, wy, w, h);
      if (borderWidth > 0) {
        ctx.strokeStyle = borderColor;
        ctx.lineWidth = borderWidth;
        ctx.strokeRect(wx, wy, w, h);
      }
    }

    ctx.restore();
  }

  drawButton(node: Node, wx: number, wy: number): void {
    const w = (node.getProperty('width') as number) ?? 120;
    const h = (node.getProperty('height') as number) ?? 40;
    const text = (node.getProperty('text') as string) ?? '';
    const state = (node.getProperty('state') as string) ?? 'normal';
    const textColor = (node.getProperty('text_color') as string) ?? '#ffffff';
    const fontSize = (node.getProperty('font_size') as number) ?? 14;
    const radius = (node.getProperty('corner_radius') as number) ?? 4;

    let bgColor: string;
    switch (state) {
      case 'hover':
        bgColor = (node.getProperty('hover_color') as string) ?? '#4a4a6e';
        break;
      case 'pressed':
        bgColor = (node.getProperty('pressed_color') as string) ?? '#2a2a4e';
        break;
      default:
        bgColor = (node.getProperty('color') as string) ?? '#3a3a5e';
    }

    const ctx = this.ctx;
    ctx.save();

    if (radius > 0) {
      this.roundedRect(wx, wy, w, h, radius);
      ctx.fillStyle = bgColor;
      ctx.fill();
    } else {
      ctx.fillStyle = bgColor;
      ctx.fillRect(wx, wy, w, h);
    }

    if (text) {
      ctx.fillStyle = textColor;
      ctx.font = `${fontSize}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, wx + w / 2, wy + h / 2);
    }

    ctx.restore();
  }

  drawImageRect(node: Node, wx: number, wy: number): void {
    const w = (node.getProperty('width') as number) ?? 100;
    const h = (node.getProperty('height') as number) ?? 100;
    const texture = (node.getProperty('texture') as string) ?? '';
    const rw = (node.getProperty('region_w') as number) ?? 0;
    const rh = (node.getProperty('region_h') as number) ?? 0;
    const preserveAspect = node.getProperty('preserve_aspect') !== false;

    if (!texture) {
      this.ctx.fillStyle = '#333333';
      this.ctx.fillRect(wx, wy, w, h);
      this.ctx.strokeStyle = '#666666';
      this.ctx.strokeRect(wx, wy, w, h);
      return;
    }

    const img = this.textureCache.get(this.resolvePath(texture)) ?? null;
    if (!img) {
      this.getTexture(texture);
      this.ctx.fillStyle = '#333333';
      this.ctx.fillRect(wx, wy, w, h);
      return;
    }

    const ctx = this.ctx;
    ctx.save();

    // Pixel-perfect rendering: disable anti-aliasing
    ctx.imageSmoothingEnabled = false;

    if (rw > 0 && rh > 0) {
      const rx = (node.getProperty('region_x') as number) ?? 0;
      const ry = (node.getProperty('region_y') as number) ?? 0;
      if (preserveAspect) {
        const { dw, dh, dx, dy } = fitRect(rw, rh, w, h);
        ctx.drawImage(img, rx, ry, rw, rh, wx + dx, wy + dy, dw, dh);
      } else {
        ctx.drawImage(img, rx, ry, rw, rh, wx, wy, w, h);
      }
    } else {
      if (preserveAspect) {
        const { dw, dh, dx, dy } = fitRect(img.width, img.height, w, h);
        ctx.drawImage(img, wx + dx, wy + dy, dw, dh);
      } else {
        ctx.drawImage(img, wx, wy, w, h);
      }
    }

    ctx.restore();
  }

  beginScrollView(node: Node, wx: number, wy: number): void {
    const w = (node.getProperty('width') as number) ?? 400;
    const h = (node.getProperty('height') as number) ?? 300;
    const scrollX = (node.getProperty('scroll_x') as number) ?? 0;
    const scrollY = (node.getProperty('scroll_y') as number) ?? 0;
    const zoom = (node.getProperty('zoom') as number) ?? 1;
    const clip = node.getProperty('clip') !== false;

    const ctx = this.ctx;
    ctx.save();

    // Pixel-perfect rendering inside scroll view
    ctx.imageSmoothingEnabled = false;

    if (clip) {
      ctx.beginPath();
      ctx.rect(wx, wy, w, h);
      ctx.clip();
    }

    ctx.translate(wx, wy);
    ctx.scale(zoom, zoom);
    ctx.translate(-scrollX, -scrollY);
  }

  endScrollView(): void {
    this.ctx.restore();
  }

  private roundedRect(x: number, y: number, w: number, h: number, r: number): void {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }
}

/** Fit source dimensions into dest dimensions preserving aspect ratio */
function fitRect(srcW: number, srcH: number, destW: number, destH: number): { dw: number; dh: number; dx: number; dy: number } {
  const scale = Math.min(destW / srcW, destH / srcH);
  const dw = Math.floor(srcW * scale);
  const dh = Math.floor(srcH * scale);
  const dx = Math.floor((destW - dw) / 2);
  const dy = Math.floor((destH - dh) / 2);
  return { dw, dh, dx, dy };
}
