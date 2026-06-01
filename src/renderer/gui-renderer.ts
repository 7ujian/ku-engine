import { type Canvas, loadImage, type Image } from '@napi-rs/canvas';
import { resolve } from 'node:path';
import type { Node } from '../engine/node.js';

type Ctx = ReturnType<Canvas['getContext']>;

const GUI_TYPES = new Set([
  'Panel', 'Button', 'ImageRect', 'ScrollView', 'ProfilerGui',
  'Slider', 'Toggle',
  'VBoxContainer', 'HBoxContainer', 'MarginContainer', 'CenterContainer',
  'Control', 'Label',
]);

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
    const w = node._computed?.width  ?? (node.getProperty('width') as number)  ?? 100;
    const h = node._computed?.height ?? (node.getProperty('height') as number) ?? 100;
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
    const w = node._computed?.width  ?? (node.getProperty('width') as number)  ?? 120;
    const h = node._computed?.height ?? (node.getProperty('height') as number) ?? 40;
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
    const w = node._computed?.width  ?? (node.getProperty('width') as number)  ?? 100;
    const h = node._computed?.height ?? (node.getProperty('height') as number) ?? 100;
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
    const w = node._computed?.width  ?? (node.getProperty('width') as number)  ?? 400;
    const h = node._computed?.height ?? (node.getProperty('height') as number) ?? 300;
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

  drawSlider(node: Node, wx: number, wy: number): void {
    const w = node._computed?.width  ?? (node.getProperty('width') as number)  ?? 200;
    const h = node._computed?.height ?? (node.getProperty('height') as number) ?? 20;
    const minVal = (node.getProperty('min_value') as number) ?? 0;
    const maxVal = (node.getProperty('max_value') as number) ?? 100;
    const value = (node.getProperty('value') as number) ?? 0;
    const trackColor = (node.getProperty('track_color') as string) ?? '#3a3a5e';
    const fillColor = (node.getProperty('fill_color') as string) ?? '#6a6aff';
    const handleColor = (node.getProperty('handle_color') as string) ?? '#ffffff';
    const handleSize = (node.getProperty('handle_size') as number) ?? 12;
    const orientation = (node.getProperty('orientation') as string) ?? 'horizontal';

    const ctx = this.ctx;
    ctx.save();

    const trackH = orientation === 'horizontal' ? 4 : w;
    const trackW = orientation === 'horizontal' ? w : 4;
    const trackX = orientation === 'horizontal' ? wx : wx + (w - 4) / 2;
    const trackY = orientation === 'horizontal' ? wy + (h - 4) / 2 : wy;

    // Track
    ctx.fillStyle = trackColor;
    ctx.fillRect(trackX, trackY, trackW, trackH);

    // Fill
    const t = maxVal > minVal ? (value - minVal) / (maxVal - minVal) : 0;
    ctx.fillStyle = fillColor;
    if (orientation === 'horizontal') {
      ctx.fillRect(trackX, trackY, trackW * t, trackH);
    } else {
      ctx.fillRect(trackX, trackY + trackH * (1 - t), trackW, trackH * t);
    }

    // Handle
    ctx.fillStyle = handleColor;
    if (orientation === 'horizontal') {
      const hx = wx + w * t - handleSize / 2;
      const hy = wy + h / 2 - handleSize / 2;
      ctx.fillRect(hx, hy, handleSize, handleSize);
    } else {
      const hx = wx + w / 2 - handleSize / 2;
      const hy = wy + h * (1 - t) - handleSize / 2;
      ctx.fillRect(hx, hy, handleSize, handleSize);
    }

    ctx.restore();
  }

  drawToggle(node: Node, wx: number, wy: number): void {
    const w = node._computed?.width  ?? (node.getProperty('width') as number)  ?? 24;
    const h = node._computed?.height ?? (node.getProperty('height') as number) ?? 24;
    const pressed = node.getProperty('pressed') === true;
    const onColor = (node.getProperty('on_color') as string) ?? '#6a6aff';
    const offColor = (node.getProperty('off_color') as string) ?? '#3a3a5e';
    const label = (node.getProperty('label') as string) ?? '';

    const ctx = this.ctx;
    ctx.save();

    // Background
    ctx.fillStyle = pressed ? onColor : offColor;
    ctx.fillRect(wx, wy, w, h);

    // Check mark when pressed
    if (pressed) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(wx + w * 0.2, wy + h * 0.5);
      ctx.lineTo(wx + w * 0.4, wy + h * 0.7);
      ctx.lineTo(wx + w * 0.8, wy + h * 0.3);
      ctx.stroke();
    }

    // Label
    if (label) {
      ctx.fillStyle = '#ffffff';
      ctx.font = '12px monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, wx + w + 4, wy + h / 2);
    }

    ctx.restore();
  }

  drawScrollbar(node: Node, wx: number, wy: number): void {
    const vpW = node._computed?.width  ?? (node.getProperty('width') as number)  ?? 400;
    const vpH = node._computed?.height ?? (node.getProperty('height') as number) ?? 300;
    const scrollX = (node.getProperty('scroll_x') as number) ?? 0;
    const scrollY = (node.getProperty('scroll_y') as number) ?? 0;
    const trackColor = (node.getProperty('scrollbar_color') as string) ?? '#2a2a4a';
    const thumbColor = (node.getProperty('scrollbar_thumb_color') as string) ?? '#5a5a8e';
    const barWidth = 8;
    const minThumbSize = 20;

    // Estimate content size from children
    let contentW = 0;
    let contentH = 0;
    for (const child of node.children) {
      const cw = child._computed?.width  ?? (child.getProperty('width') as number)  ?? 0;
      const ch = child._computed?.height ?? (child.getProperty('height') as number) ?? 0;
      const cx = child._computed?.x ?? (child.getProperty('x') as number) ?? 0;
      const cy = child._computed?.y ?? (child.getProperty('y') as number) ?? 0;
      contentW = Math.max(contentW, cx + cw);
      contentH = Math.max(contentH, cy + ch);
    }

    const ctx = this.ctx;
    ctx.save();

    // Vertical scrollbar
    if (contentH > vpH) {
      const trackX = wx + vpW - barWidth;
      const trackY = wy;
      const trackH = vpH;
      const thumbH = Math.max(minThumbSize, (vpH / contentH) * trackH);
      const maxScroll = contentH - vpH;
      const thumbY = trackY + (scrollY / maxScroll) * (trackH - thumbH);

      // Track
      ctx.fillStyle = trackColor;
      ctx.fillRect(trackX, trackY, barWidth, trackH);
      // Thumb
      ctx.fillStyle = thumbColor;
      ctx.fillRect(trackX, thumbY, barWidth, thumbH);
    }

    // Horizontal scrollbar
    if (contentW > vpW) {
      const trackX = wx;
      const trackY = wy + vpH - barWidth;
      const trackW = vpW;
      const thumbW = Math.max(minThumbSize, (vpW / contentW) * trackW);
      const maxScroll = contentW - vpW;
      const thumbX = trackX + (scrollX / maxScroll) * (trackW - thumbW);

      ctx.fillStyle = trackColor;
      ctx.fillRect(trackX, trackY, trackW, barWidth);
      ctx.fillStyle = thumbColor;
      ctx.fillRect(thumbX, trackY, thumbW, barWidth);
    }

    ctx.restore();
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
