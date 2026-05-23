import sdl from '@kmamal/sdl';
import { createCanvas, loadImage, type Canvas, type Image } from '@napi-rs/canvas';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';
import { SceneTree } from '../engine/scene-tree.js';
import { Node } from '../engine/node.js';
import { findCamera, type CameraState } from './camera.js';
import { SpriteRenderer } from './sprite-renderer.js';
import { TilemapRenderer } from './tilemap-renderer.js';
import { LabelRenderer } from './label-renderer.js';
import { GuiRenderer, isGuiType } from './gui-renderer.js';
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

/** Detect the system display scale factor from Linux desktop environment.
 *  SDL reports physical pixels on Wayland/macOS/Windows but not X11,
 *  so we fall back to env vars and X resources when SDL's ratio is 1. */
function detectSystemScale(): number {
  const kuScale = Number(process.env.KU_SCALE);
  if (kuScale > 0) return kuScale;

  const gdkScale = Number(process.env.GDK_SCALE);
  const gdkDpiScale = Number(process.env.GDK_DPI_SCALE);

  if (gdkScale > 0) {
    const fractional = gdkDpiScale > 0 ? gdkDpiScale : 1;
    return gdkScale * fractional;
  }

  const qtScale = Number(process.env.QT_SCALE_FACTOR);
  if (qtScale > 0) return qtScale;

  try {
    const xrdb = execSync('xrdb -query 2>/dev/null', { encoding: 'utf8', timeout: 3000 });
    const match = xrdb.match(/^Xft\.dpi:\s*(\d+(?:\.\d+)?)/m);
    if (match) {
      const dpi = parseFloat(match[1]);
      if (dpi > 0) return Math.round((dpi / 96) * 100) / 100;
    }
  } catch {
    // xrdb not available or timed out
  }

  return 1;
}

export type ScaleMode = 'fixed' | 'system';

export class Renderer {
  private window: ReturnType<typeof sdl.video.createWindow> | null = null;
  private canvas: Canvas;
  private ctx: ReturnType<Canvas['getContext']>;
  private running = false;
  private width: number;
  private height: number;
  private pixelWidth: number;
  private pixelHeight: number;
  // pixelRatio: internal canvas multiplier for HDPI (system mode).
  // In fixed mode this is 1 — the window itself is scaled instead.
  private pixelRatio: number;
  // windowScale: multiplies the SDL window size. >1 in fixed mode, 1 in system mode.
  private windowScale: number;
  private configScale: number;
  private scaleMode: ScaleMode;
  private spriteRenderer: SpriteRenderer;
  private tilemapRenderer: TilemapRenderer;
  private labelRenderer: LabelRenderer;
  private guiRenderer: GuiRenderer;
  private lastTime = 0;
  private onKey: KeyHandler | null = null;
  private onTouch: TouchHandler | null = null;
  private projectDir: string;
  private debugPhysics: boolean;
  private resizable: boolean;

  constructor(
    width = 800,
    height = 600,
    projectDir = '.',
    debugPhysics = false,
    configScale = 1,
    scaleMode: ScaleMode = 'system',
    resizable = true,
  ) {
    this.width = width;
    this.height = height;
    this.resizable = resizable;
    this.pixelWidth = width;
    this.pixelHeight = height;
    this.pixelRatio = 1;
    this.windowScale = 1;
    this.configScale = configScale;
    this.scaleMode = scaleMode;
    this.projectDir = resolve(projectDir);
    this.debugPhysics = debugPhysics;
    this.canvas = createCanvas(width, height);
    this.ctx = this.canvas.getContext('2d');
    this.spriteRenderer = new SpriteRenderer(this.ctx, this.projectDir);
    this.tilemapRenderer = new TilemapRenderer(this.ctx);
    this.labelRenderer = new LabelRenderer(this.ctx);
    this.guiRenderer = new GuiRenderer(this.ctx, this.projectDir);
  }

  private initCanvas(w: number, h: number): void {
    this.canvas = createCanvas(w, h);
    this.ctx = this.canvas.getContext('2d');
    this.spriteRenderer = new SpriteRenderer(this.ctx, this.projectDir);
    this.tilemapRenderer = new TilemapRenderer(this.ctx);
    this.labelRenderer = new LabelRenderer(this.ctx);
    this.guiRenderer = new GuiRenderer(this.ctx, this.projectDir);
  }

  setKeyHandler(handler: KeyHandler): void {
    this.onKey = handler;
  }

  setTouchHandler(handler: TouchHandler): void {
    this.onTouch = handler;
  }

  async open(title = 'ku'): Promise<void> {
    // Create window at logical size first so we can query SDL's HDPI behaviour.
    this.window = sdl.video.createWindow({
      title,
      width: this.width,
      height: this.height,
      vsync: false,
      resizable: this.resizable,
    });
    this.running = true;
    this.lastTime = Date.now();

    const sdlRatio = this.window.pixelWidth / this.width;

    if (this.scaleMode === 'fixed') {
      // Fixed mode: window enlarged by configScale, canvas stays at logical size.
      // Uses nearest-neighbor upscaling in present() for crisp pixel art.
      this.windowScale = this.configScale;
      this.pixelRatio = 1;
    } else if (sdlRatio > 1) {
      // Wayland / macOS: compositor handles HDPI natively.
      // Window stays at logical size; canvas enlarged for supersampling.
      this.windowScale = 1;
      this.pixelRatio = sdlRatio;
    } else {
      // X11 (no compositor HDPI): detect system scale from env / X resources
      // and enlarge both window and canvas.
      const systemScale = detectSystemScale();
      this.windowScale = systemScale;
      this.pixelRatio = systemScale;
    }

    // Resize window if we're using a windowScale > 1 (fixed mode or X11 system scale)
    const winW = Math.round(this.width * this.windowScale);
    const winH = Math.round(this.height * this.windowScale);
    if (winW !== this.width || winH !== this.height) {
      this.window.setSize(winW, winH);
    }

    this.pixelWidth = Math.round(this.width * this.pixelRatio);
    this.pixelHeight = Math.round(this.height * this.pixelRatio);
    if (this.pixelRatio !== 1) {
      this.initCanvas(this.pixelWidth, this.pixelHeight);
    } else if (this.canvas.width !== this.width || this.canvas.height !== this.height) {
      this.initCanvas(this.width, this.height);
    }

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

    // Mouse as pointer (desktop fallback).
    // Window may be scaled (fixed mode), so divide by windowScale to get logical coords.
    (this.window as any).on('mouseMove', (event: { x: number; y: number }) => {
      if (this.onTouch) this.onTouch('move', event.x / this.windowScale, event.y / this.windowScale, 0);
    });

    (this.window as any).on('mouseButtonDown', (event: { x: number; y: number; button: number }) => {
      if (this.onTouch) this.onTouch('start', event.x / this.windowScale, event.y / this.windowScale, 0);
    });

    (this.window as any).on('mouseButtonUp', (event: { x: number; y: number; button: number }) => {
      if (this.onTouch) this.onTouch('end', event.x / this.windowScale, event.y / this.windowScale, 0);
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

    // HDPI: scale canvas drawing so logical coords map to physical pixels
    if (this.pixelRatio !== 1) {
      ctx.save();
      ctx.scale(this.pixelRatio, this.pixelRatio);
    }

    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, this.width, this.height);

    // Find active camera
    const cam = findCamera(tree);

    ctx.save();
    ctx.translate(this.width / 2, this.height / 2);
    ctx.scale(cam.zoom, cam.zoom);
    ctx.translate(-cam.x, -cam.y);

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

      if (node.type === 'ImageRect') {
        const texture = (node.getProperty('texture') as string) ?? '';
        if (texture) {
          const abs = texture.startsWith('/') ? texture : resolve(this.projectDir, texture);
          if (!this.guiRenderer.hasTexture(abs)) {
            loadPromises.push(this.guiRenderer.loadTexture(abs).then(() => {}));
          }
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

    ctx.restore(); // camera transform

    // GUI pass: draw GUI nodes in screen space (no camera transform)
    this.drawGuiPass(tree, dt);

    if (this.pixelRatio !== 1) {
      ctx.restore(); // HDPI scale
    }

    this.present();
  }

  private drawNodeRecursive(node: Node, parentWorld: Transform2D, dt: number): void {
    const visible = node.getProperty('visible');
    if (visible === false) return;

    // Skip GUI nodes in game pass — they render in the GUI pass
    if (isGuiType(node.type) && node.parent?.type === 'Node' && node.parent?.parent === null) {
      return;
    }

    const local = getLocalTransform(node);
    const world = composeTransform(parentWorld, local);

    // ScrollView: clip + scroll offset for children
    if (node.type === 'ScrollView') {
      this.drawNode(node, world.x, world.y, world.scaleX, world.scaleY, dt);
      this.guiRenderer.beginScrollView(node, world.x, world.y);
      for (const child of node.children) {
        this.drawNodeRecursive(child, IDENTITY, dt);
      }
      this.guiRenderer.endScrollView();
      return;
    }

    this.drawNode(node, world.x, world.y, world.scaleX, world.scaleY, dt);

    for (const child of node.children) {
      this.drawNodeRecursive(child, world, dt);
    }
  }

  /** Draw GUI nodes in screen space (after camera transform is restored) */
  private drawGuiPass(tree: SceneTree, dt: number): void {
    for (const child of tree.root.children) {
      if (!isGuiType(child.type)) continue;
      this.drawGuiRecursive(child, IDENTITY, dt);
    }
  }

  private drawGuiRecursive(node: Node, parentWorld: Transform2D, dt: number): void {
    const visible = node.getProperty('visible');
    if (visible === false) return;

    const local = getLocalTransform(node);
    const world = composeTransform(parentWorld, local);

    // ScrollView: clip + scroll offset for children
    if (node.type === 'ScrollView') {
      this.drawNode(node, world.x, world.y, world.scaleX, world.scaleY, dt);
      this.guiRenderer.beginScrollView(node, world.x, world.y);
      for (const child of node.children) {
        this.drawGuiRecursive(child, IDENTITY, dt);
      }
      this.guiRenderer.endScrollView();
      return;
    }

    this.drawNode(node, world.x, world.y, world.scaleX, world.scaleY, dt);

    for (const child of node.children) {
      this.drawGuiRecursive(child, world, dt);
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
      case 'Panel':
        this.guiRenderer.drawPanel(node, wx, wy);
        break;
      case 'Button':
        this.guiRenderer.drawButton(node, wx, wy);
        break;
      case 'ImageRect':
        this.guiRenderer.drawImageRect(node, wx, wy);
        break;
      case 'ScrollView':
        // Background only — children drawn in drawNodeRecursive
        this.guiRenderer.drawPanel(node, wx, wy);
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
        } else {
          // Draw a yellow placeholder for RigidBody without atlas
          const w = (node.getProperty('width') as number) ?? 32;
          const h = (node.getProperty('height') as number) ?? 32;
          const color = (node.getProperty('color') as string) ?? '#ffff00';
          ctx.fillStyle = color;
          ctx.fillRect(wx - w / 2, wy - h / 2, w, h);
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

    const bufW = this.pixelWidth;
    const bufH = this.pixelHeight;
    const imageData = this.ctx.getImageData(0, 0, bufW, bufH);
    const buffer = Buffer.from(imageData.data);

    const winW = Math.round(this.width * this.windowScale);
    // Use nearest-neighbor when upscaling (pixel-art style: buffer smaller than window).
    // When buffer is same size or larger (HDPI downscale), use default linear.
    if (bufW < winW) {
      this.window.render(bufW, bufH, bufW * 4, 'rgba32', buffer, { scaling: 'nearest' });
    } else {
      this.window.render(bufW, bufH, bufW * 4, 'rgba32', buffer);
    }
  }

  getWidth(): number { return this.width; }
  getHeight(): number { return this.height; }

  /** Set a fixed rendering scale. Switches scale mode to "fixed". */
  setScale(scale: number): void {
    this.scaleMode = 'fixed';
    this.configScale = scale;
    if (this.window && !this.window.destroyed) {
      this.windowScale = scale;
      this.pixelRatio = 1;
      this.pixelWidth = this.width;
      this.pixelHeight = this.height;
      this.initCanvas(this.width, this.height);
    }
  }

  /** Set the scale mode ("fixed" or "system").
   *  Updates canvas immediately; window resize requires reopen. */
  setScaleMode(mode: ScaleMode): void {
    this.scaleMode = mode;
    if (!this.window || this.window.destroyed) return;

    if (mode === 'fixed') {
      this.windowScale = this.configScale;
      this.pixelRatio = 1;
    } else {
      const sdlRatio = this.window.pixelWidth / this.width;
      if (sdlRatio > 1) {
        this.windowScale = 1;
        this.pixelRatio = sdlRatio;
      } else {
        const systemScale = detectSystemScale();
        this.windowScale = systemScale;
        this.pixelRatio = systemScale;
      }
    }
    this.pixelWidth = Math.round(this.width * this.pixelRatio);
    this.pixelHeight = Math.round(this.height * this.pixelRatio);
    if (this.pixelRatio !== 1) {
      this.initCanvas(this.pixelWidth, this.pixelHeight);
    } else {
      this.initCanvas(this.width, this.height);
    }
  }

  getScale(): number { return this.scaleMode === 'fixed' ? this.windowScale : this.pixelRatio; }
  getScaleMode(): ScaleMode { return this.scaleMode; }
}
