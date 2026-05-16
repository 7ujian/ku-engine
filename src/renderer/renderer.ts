import sdl from '@kmamal/sdl';
import { createCanvas, loadImage, type Canvas, type Image } from '@napi-rs/canvas';
import { SceneTree } from '../engine/scene-tree.js';
import { Node } from '../engine/node.js';
import { findCamera, type CameraState } from './camera.js';
import { SpriteRenderer } from './sprite-renderer.js';
import { TilemapRenderer } from './tilemap-renderer.js';
import { LabelRenderer } from './label-renderer.js';
import type { PropertyMap } from '../engine/types.js';

type KeyHandler = (key: string, down: boolean) => void;

function normalizeKeyName(key: string): string {
  const map: Record<string, string> = {
    ' ': 'SPACE',
    'ArrowUp': 'UP',
    'ArrowDown': 'DOWN',
    'ArrowLeft': 'LEFT',
    'ArrowRight': 'RIGHT',
    'Enter': 'ENTER',
    'Escape': 'ESCAPE',
    'Shift': 'SHIFT',
    'Control': 'CONTROL',
    'Alt': 'ALT',
    'Tab': 'TAB',
    'Backspace': 'BACKSPACE',
  };
  return map[key] ?? key.toUpperCase();
}

export class Renderer {
  private window: ReturnType<typeof sdl.video.createWindow> | null = null;
  private canvas: Canvas;
  private ctx: ReturnType<Canvas['getContext']>;
  private running = false;
  private width: number;
  private height: number;
  private spriteRenderer: SpriteRenderer;
  private tilemapRenderer: TilemapRenderer;
  private labelRenderer: LabelRenderer;
  private lastTime = 0;
  private onKey: KeyHandler | null = null;

  constructor(width = 640, height = 480) {
    this.width = width;
    this.height = height;
    this.canvas = createCanvas(width, height);
    this.ctx = this.canvas.getContext('2d');
    this.spriteRenderer = new SpriteRenderer(this.ctx);
    this.tilemapRenderer = new TilemapRenderer(this.ctx);
    this.labelRenderer = new LabelRenderer(this.ctx);
  }

  setKeyHandler(handler: KeyHandler): void {
    this.onKey = handler;
  }

  async open(title = 'ku'): Promise<void> {
    this.window = sdl.video.createWindow({
      title,
      width: this.width,
      height: this.height,
    });
    this.running = true;
    this.lastTime = Date.now();

    this.window.on('close', () => {
      this.running = false;
    });

    (this.window as any).on('keyDown', (event: { key: string | null; repeat: number }) => {
      if (this.onKey && event.key && !event.repeat) {
        this.onKey(normalizeKeyName(event.key), true);
      }
    });

    (this.window as any).on('keyUp', (event: { key: string | null }) => {
      if (this.onKey && event.key) {
        this.onKey(normalizeKeyName(event.key), false);
      }
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

  async draw(tree: SceneTree): Promise<void> {
    if (!this.isOpen()) return;

    const now = Date.now();
    const dt = now - this.lastTime;
    this.lastTime = now;

    const ctx = this.ctx;
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, this.width, this.height);

    // Find active camera
    const cam = findCamera(tree);

    ctx.save();
    ctx.translate(this.width / 2, this.height / 2);
    ctx.scale(cam.zoom, cam.zoom);
    ctx.translate(-cam.x - this.width / 2, -cam.y - this.height / 2);

    // Pre-load textures for visible sprites/tilemaps
    const loadPromises: Promise<void>[] = [];
    tree.traverse((node) => {
      if (node.type === 'Sprite' || node.type === 'AnimatedSprite') {
        const texture = (node.getProperty('texture') as string) ?? '';
        if (texture && !this.spriteRenderer.getTextureSync(texture)) {
          loadPromises.push(this.spriteRenderer.loadTexture(texture).then(() => {}));
        }
        // Also load frames for AnimatedSprite
        if (node.type === 'AnimatedSprite') {
          const frames = node.getProperty('frames') as string[] | undefined;
          if (frames) {
            for (const f of frames) {
              if (f && !this.spriteRenderer.getTextureSync(f)) {
                loadPromises.push(this.spriteRenderer.loadTexture(f).then(() => {}));
              }
            }
          }
        }
      } else if (node.type === 'TileMap') {
        const tileset = (node.getProperty('tileset') as string) ?? '';
        const cellSize = (node.getProperty('cell_size') as number) ?? 16;
        if (tileset) {
          loadPromises.push(this.tilemapRenderer.loadTileset(tileset, cellSize, cellSize));
        }
      }
    });

    if (loadPromises.length > 0) {
      await Promise.all(loadPromises);
    }

    // Draw nodes
    tree.traverse((node) => {
      this.drawNode(node, dt);
    });

    ctx.restore();
    this.present();
  }

  private drawNode(node: Node, dt: number): void {
    const visible = node.getProperty('visible');
    if (visible === false) return;

    const x = (node.getProperty('x') as number) ?? 0;
    const y = (node.getProperty('y') as number) ?? 0;

    switch (node.type) {
      case 'Sprite':
        this.spriteRenderer.drawSprite(node, x, y, dt);
        break;
      case 'AnimatedSprite':
        this.spriteRenderer.drawAnimatedSprite(node, x, y, dt);
        break;
      case 'Label':
        this.labelRenderer.drawLabel(node, x, y);
        break;
      case 'TileMap':
        this.tilemapRenderer.drawTilemap(node, x, y);
        break;
      case 'RigidBody':
        // Draw as colored rect for debug/standalone visibility
        this.ctx.fillStyle = '#ffff00';
        const rbW = 30;
        const rbH = 24;
        this.ctx.fillRect(x - rbW / 2, y - rbH / 2, rbW, rbH);
        break;
      case 'CollisionShape':
        // Draw pipes/ground as colored rects
        this.ctx.fillStyle = '#33cc33';
        const csW = (node.getProperty('width') as number) ?? 32;
        const csH = (node.getProperty('height') as number) ?? 32;
        this.ctx.fillRect(x - csW / 2, y - csH / 2, csW, csH);
        break;
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
