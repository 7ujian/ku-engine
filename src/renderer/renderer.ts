import sdl from '@kmamal/sdl';
import { createCanvas, loadImage, type Canvas, type Image } from '@napi-rs/canvas';
import { resolve } from 'node:path';
import { SceneTree } from '../engine/scene-tree.js';
import { Node } from '../engine/node.js';
import { findCamera, type CameraState } from './camera.js';
import { SpriteRenderer } from './sprite-renderer.js';
import { TilemapRenderer } from './tilemap-renderer.js';
import { LabelRenderer } from './label-renderer.js';
import type { PropertyMap } from '../engine/types.js';
import { type Transform2D, IDENTITY, getLocalTransform, composeTransform } from '../engine/transform.js';
import { pluginRegistry } from '../engine/plugin-registry.js';

type KeyHandler = (key: string, down: boolean) => void;
type TouchHandler = (phase: 'start' | 'move' | 'end', x: number, y: number, pointerId: number) => void;

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
  private onTouch: TouchHandler | null = null;
  private projectDir: string;
  private debugPhysics: boolean;

  constructor(width = 640, height = 480, projectDir = '.', debugPhysics = false) {
    this.width = width;
    this.height = height;
    this.projectDir = resolve(projectDir);
    this.debugPhysics = debugPhysics;
    this.canvas = createCanvas(width, height);
    this.ctx = this.canvas.getContext('2d');
    this.spriteRenderer = new SpriteRenderer(this.ctx, this.projectDir);
    this.tilemapRenderer = new TilemapRenderer(this.ctx);
    this.labelRenderer = new LabelRenderer(this.ctx);
  }

  setKeyHandler(handler: KeyHandler): void {
    this.onKey = handler;
  }

  setTouchHandler(handler: TouchHandler): void {
    this.onTouch = handler;
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

    // Touch / pointer events (SDL normalized 0-1 coordinates)
    (this.window as any).on('fingerDown', (event: { x: number; y: number; fingerId: number }) => {
      if (this.onTouch) this.onTouch('start', event.x * this.width, event.y * this.height, event.fingerId);
    });

    (this.window as any).on('fingerMove', (event: { x: number; y: number; fingerId: number }) => {
      if (this.onTouch) this.onTouch('move', event.x * this.width, event.y * this.height, event.fingerId);
    });

    (this.window as any).on('fingerUp', (event: { x: number; y: number; fingerId: number }) => {
      if (this.onTouch) this.onTouch('end', event.x * this.width, event.y * this.height, event.fingerId);
    });

    // Mouse as pointer (desktop fallback)
    (this.window as any).on('mouseMove', (event: { x: number; y: number }) => {
      if (this.onTouch) this.onTouch('move', event.x, event.y, 0);
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

    // Pre-load textures for visible sprites/tilemaps/atlas nodes
    const loadPromises: Promise<void>[] = [];
    tree.traverse((node) => {
      const atlas = (node.getProperty('atlas') as string) ?? '';
      if (atlas && !this.spriteRenderer.hasAtlas(atlas)) {
        loadPromises.push(this.spriteRenderer.loadAtlasFile(atlas).then(() => {}));
      }

      if (node.type === 'Sprite' || node.type === 'AnimatedSprite') {
        const texture = (node.getProperty('texture') as string) ?? '';
        if (texture && !atlas && !this.spriteRenderer.getTextureSync(texture)) {
          loadPromises.push(this.spriteRenderer.loadTexture(texture).then(() => {}));
        }
        if (node.type === 'AnimatedSprite' && !atlas) {
          const frames = node.getProperty('frames') as string[] | undefined;
          if (frames) {
            for (const f of frames) {
              if (f && !this.spriteRenderer.getTextureSync(f)) {
                loadPromises.push(this.spriteRenderer.loadTexture(f).then(() => {}));
              }
            }
          }
        }
      }

      if (node.type === 'TileMap') {
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

    // Draw nodes with world transform accumulation
    this.drawNodeRecursive(tree.root, IDENTITY, dt);

    // Debug physics overlay (on top of all sprites)
    this.drawDebugOverlay(tree);

    ctx.restore();
    this.present();
  }

  private drawNodeRecursive(node: Node, parentWorld: Transform2D, dt: number): void {
    const visible = node.getProperty('visible');
    if (visible === false) return;

    const local = getLocalTransform(node);
    const world = composeTransform(parentWorld, local);

    this.drawNode(node, world.x, world.y, world.scaleX, world.scaleY, dt);

    for (const child of node.children) {
      this.drawNodeRecursive(child, world, dt);
    }
  }

  private drawNode(node: Node, wx: number, wy: number, sx: number, sy: number, dt: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    ctx.save();
    ctx.translate(wx, wy);
    ctx.scale(sx, sy);
    ctx.translate(-wx, -wy);

    const pluginRenderer = pluginRegistry.getNodeRenderer(node.type);
    if (pluginRenderer) {
      pluginRenderer(ctx, node, wx, wy, sx, sy, dt, this.projectDir);
      ctx.restore();
      return;
    }
    switch (node.type) {
      case 'Sprite':
        this.spriteRenderer.drawSprite(node, wx, wy, dt);
        break;
      case 'AnimatedSprite':
        this.spriteRenderer.drawAnimatedSprite(node, wx, wy, dt);
        break;
      case 'Label':
        this.labelRenderer.drawLabel(node, wx, wy);
        break;
      case 'Block': {
        const w = (node.getProperty('width') as number) ?? 32;
        const h = (node.getProperty('height') as number) ?? 32;
        const color = (node.getProperty('color') as string) ?? '#ffffff';
        const ctx = this.ctx;
        ctx.fillStyle = color;
        ctx.fillRect(wx - w / 2, wy - h / 2, w, h);
        break;
      }
      case 'TileMap':
        this.tilemapRenderer.drawTilemap(node, wx, wy);
        break;
      case 'RigidBody':
      case 'CollisionShape': {
        const atlasPath = (node.getProperty('atlas') as string) ?? '';
        if (atlasPath) {
          const animName = (node.getProperty('animation') as string) ?? '';
          const animations = (node.getProperty('animations') as Record<string, unknown>) ?? {};
          if (animName && Object.keys(animations).length > 0) {
            this.spriteRenderer.drawAnimatedSprite(node, wx, wy, dt);
          } else {
            this.spriteRenderer.drawSprite(node, wx, wy, dt);
          }
        }
        break;
      }
      // Area nodes only render in debug overlay
    }
    ctx.restore();
  }

  private drawDebugOverlay(tree: SceneTree): void {
    if (!this.debugPhysics) return;
    this.drawDebugRecursive(tree.root, IDENTITY);
  }

  private drawDebugRecursive(node: Node, parentWorld: Transform2D): void {
    const visible = node.getProperty('visible');
    if (visible === false) return;

    const local = getLocalTransform(node);
    const world = composeTransform(parentWorld, local);

    switch (node.type) {
      case 'RigidBody':
      case 'CollisionShape': {
        const color = (node.getProperty('color') as string) ?? (node.type === 'RigidBody' ? '#ffff00' : '#33cc33');
        const w = (node.getProperty('width') as number) ?? (node.type === 'RigidBody' ? 30 : 32);
        const h = (node.getProperty('height') as number) ?? (node.type === 'RigidBody' ? 24 : 32);
        this.ctx.strokeStyle = color;
        this.ctx.lineWidth = 1;
        this.ctx.strokeRect(world.x - w / 2, world.y - h / 2, w, h);
        break;
      }
      case 'Area': {
        const color = (node.getProperty('color') as string) ?? 'rgba(0, 255, 255, 0.5)';
        const aW = (node.getProperty('width') as number) ?? 32;
        const aH = (node.getProperty('height') as number) ?? 32;
        this.ctx.strokeStyle = color;
        this.ctx.lineWidth = 1;
        this.ctx.strokeRect(world.x - aW / 2, world.y - aH / 2, aW, aH);
        break;
      }
    }

    for (const child of node.children) {
      this.drawDebugRecursive(child, world);
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
