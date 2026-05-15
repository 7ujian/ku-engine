import sdl from '@kmamal/sdl';
import { createCanvas, loadImage, type Canvas, type Image } from '@napi-rs/canvas';
import { SceneTree } from '../engine/scene-tree.js';
import { Node } from '../engine/node.js';
import type { PropertyMap } from '../engine/types.js';

export class Renderer {
  private window: ReturnType<typeof sdl.video.createWindow> | null = null;
  private canvas: Canvas;
  private ctx: ReturnType<Canvas['getContext']>;
  private textureCache = new Map<string, Image>();
  private running = false;
  private width: number;
  private height: number;

  constructor(width = 640, height = 480) {
    this.width = width;
    this.height = height;
    this.canvas = createCanvas(width, height);
    this.ctx = this.canvas.getContext('2d');
  }

  async open(title = 'ku'): Promise<void> {
    this.window = sdl.video.createWindow({
      title,
      width: this.width,
      height: this.height,
    });
    this.running = true;

    this.window.on('close', () => {
      this.running = false;
    });
  }

  isOpen(): boolean {
    return this.running && this.window !== null && !this.window.destroyed;
  }

  close(): void {
    this.running = false;
    if (this.window && !this.window.destroyed) {
      this.window.destroy();
    }
    this.window = null;
  }

  draw(tree: SceneTree): void {
    if (!this.isOpen()) return;

    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);

    // Find active camera
    let camX = 0;
    let camY = 0;
    let camZoom = 1;
    tree.traverse((node) => {
      if (node.type === 'Camera2D') {
        camX = (node.getProperty('offset_x') as number) ?? 0;
        camY = (node.getProperty('offset_y') as number) ?? 0;
        camZoom = (node.getProperty('zoom') as number) ?? 1;
      }
    });

    ctx.save();
    ctx.translate(this.width / 2, this.height / 2);
    ctx.scale(camZoom, camZoom);
    ctx.translate(-camX - this.width / 2, -camY - this.height / 2);

    // Draw nodes
    tree.traverse((node, _path) => {
      this.drawNode(node);
    });

    ctx.restore();
    this.present();
  }

  private async drawNode(node: Node): Promise<void> {
    const visible = node.getProperty('visible');
    if (visible === false) return;

    const x = (node.getProperty('x') as number) ?? 0;
    const y = (node.getProperty('y') as number) ?? 0;

    switch (node.type) {
      case 'Sprite':
      case 'AnimatedSprite':
        await this.drawSprite(node, x, y);
        break;
      case 'Label':
        this.drawLabel(node, x, y);
        break;
    }
  }

  private async drawSprite(node: Node, x: number, y: number): Promise<void> {
    const texture = (node.getProperty('texture') as string) ?? '';
    const flipH = node.getProperty('flip_h') === true;
    const flipV = node.getProperty('flip_v') === true;

    if (!texture) {
      // Draw placeholder rect
      this.ctx.fillStyle = '#ff00ff';
      this.ctx.fillRect(x - 16, y - 16, 32, 32);
      return;
    }

    const img = await this.getTexture(texture);
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

  private drawLabel(node: Node, x: number, y: number): void {
    const text = (node.getProperty('text') as string) ?? '';
    const fontSize = (node.getProperty('font_size') as number) ?? 16;
    const color = (node.getProperty('color') as string) ?? '#ffffff';

    if (!text) return;

    this.ctx.font = `${fontSize}px monospace`;
    this.ctx.fillStyle = color;
    this.ctx.fillText(text, x, y);
  }

  private async getTexture(path: string): Promise<Image | null> {
    if (this.textureCache.has(path)) {
      return this.textureCache.get(path)!;
    }
    try {
      const img = await loadImage(path);
      this.textureCache.set(path, img);
      return img;
    } catch {
      return null;
    }
  }

  private present(): void {
    if (!this.window || this.window.destroyed) return;

    const imageData = this.ctx.getImageData(0, 0, this.width, this.height);
    const buffer = Buffer.from(imageData.data);

    this.window.render(this.width, this.height, this.width * 4, 'rgba32', buffer);
  }

  getWidth(): number { return this.width; }
  getHeight(): number { return this.height; }
}
