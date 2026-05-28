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

// --- Types ---

export type StretchMode = 'disabled' | 'canvas_items' | 'viewport';
export type StretchAspect = 'ignore' | 'keep' | 'keep_width' | 'keep_height' | 'expand';
export type ScaleRounding = 'fractional' | 'integer';

export interface WindowConfig {
	width: number;
	height: number;
	resizable: boolean;
	hidpi: boolean;
	stretch_mode: StretchMode;
	stretch_aspect: StretchAspect;
	scale_mode: ScaleRounding;
	scale: number;
}

type KeyHandler = (key: string, down: boolean) => void;
type TouchHandler = (phase: 'start' | 'move' | 'end', x: number, y: number, pointerId: number) => void;

/** Snap a coordinate to the nearest grid unit (defaults to 1 = design pixel). */
function snapToGrid(v: number, grid: number): number {
	return Math.round(v / grid) * grid;
}

// --- Helpers ---

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

/** Compute the destination rectangle for stretching design resolution into a target area. */
export function computeStretch(
	designW: number,
	designH: number,
	targetW: number,
	targetH: number,
	aspect: StretchAspect,
	rounding: ScaleRounding,
): { x: number; y: number; w: number; h: number } {
	const scaleX = targetW / designW;
	const scaleY = targetH / designH;
	let effX: number;
	let effY: number;

	switch (aspect) {
		case 'ignore':
			effX = scaleX;
			effY = scaleY;
			break;
		case 'keep': {
			const s = Math.min(scaleX, scaleY);
			effX = s;
			effY = s;
			break;
		}
		case 'keep_width':
			effX = scaleX;
			effY = scaleX;
			break;
		case 'keep_height':
			effX = scaleY;
			effY = scaleY;
			break;
		case 'expand': {
			const s = Math.max(scaleX, scaleY);
			effX = s;
			effY = s;
			break;
		}
	}

	if (rounding === 'integer') {
		if (aspect === 'ignore') {
			effX = Math.max(1, Math.floor(effX));
			effY = Math.max(1, Math.floor(effY));
		} else {
			const s = Math.max(1, Math.floor(Math.min(effX, effY)));
			effX = s;
			effY = s;
		}
	}

	const w = Math.round(designW * effX);
	const h = Math.round(designH * effY);
	const x = Math.round((targetW - w) / 2);
	const y = Math.round((targetH - h) / 2);
	return { x, y, w, h };
}

export function migrateWindowConfig(raw: Record<string, unknown>): WindowConfig {
	return {
		width: (raw.width as number) ?? 800,
		height: (raw.height as number) ?? 600,
		resizable: (raw.resizable as boolean) ?? true,
		hidpi: (raw.hidpi as boolean) ?? true,
		stretch_mode: (raw.stretch_mode as StretchMode) ?? 'disabled',
		stretch_aspect: (raw.stretch_aspect as StretchAspect) ?? 'keep',
		scale_mode: (raw.scale_mode as ScaleRounding) ?? 'fractional',
		scale: (raw.scale as number) ?? 1,
	};
}

// --- Renderer ---

export class Renderer {
	private window: ReturnType<typeof sdl.video.createWindow> | null = null;
	private canvas: Canvas;
	private ctx: ReturnType<Canvas['getContext']>;
	private running = false;
	private lastTime = 0;
	private onKey: KeyHandler | null = null;
	private onTouch: TouchHandler | null = null;
	private projectDir: string;
	private debugPhysics: boolean;
	private debugBodies: Array<{
		x: number; y: number;
		width: number; height: number;
		isSensor: boolean; isStatic: boolean;
		label: string;
		parts?: Array<{ x: number; y: number; width: number; height: number }>;
	}> = [];

	// Immutable config
	private readonly config: WindowConfig;
	private readonly designWidth: number;
	private readonly designHeight: number;

	// Computed once at open
	private dpiScale = 1;

	// Computed by computeLayout()
	private canvasW: number;
	private canvasH: number;
	private targetX = 0;
	private targetY = 0;
	private targetW: number;
	private targetH: number;
	private dstRect: { x: number; y: number; width: number; height: number } | null = null;
	private drawScaleX = 1;
	private drawScaleY = 1;
	private drawOffsetX = 0;
	private drawOffsetY = 0;
	private presentScaling: 'nearest' | 'linear' = 'nearest';
	// Snap grid in design-space units: 1 / (design-to-canvas pixel ratio).
	// viewport/disabled: 1 (canvas = design resolution).
	// canvas_items: 1/drawScaleX (canvas = screen resolution, snap to screen pixels).
	private snapGrid = 1;
	private spriteRenderer: SpriteRenderer;
	private tilemapRenderer: TilemapRenderer;
	private labelRenderer: LabelRenderer;
	private guiRenderer: GuiRenderer;
	private cameraCache: { node: Node | null; cam: CameraState } = { node: null, cam: { x: 0, y: 0, zoom: 1 } };

	constructor(config: WindowConfig, projectDir = '.', debugPhysics = false) {
		this.config = config;
		this.designWidth = config.width;
		this.designHeight = config.height;
		this.projectDir = resolve(projectDir);
		this.debugPhysics = debugPhysics;
		this.canvasW = config.width;
		this.canvasH = config.height;
		this.targetW = config.width;
		this.targetH = config.height;
		this.canvas = createCanvas(config.width, config.height);
		this.ctx = this.canvas.getContext('2d');
		this.spriteRenderer = new SpriteRenderer(this.ctx, this.projectDir);
		this.tilemapRenderer = new TilemapRenderer(this.ctx);
		this.tilemapRenderer.setProjectDir(this.projectDir);
		this.labelRenderer = new LabelRenderer(this.ctx);
		this.guiRenderer = new GuiRenderer(this.ctx, this.projectDir);
	}

	private initCanvas(w: number, h: number): void {
		this.canvasW = w;
		this.canvasH = h;
		this.canvas = createCanvas(w, h);
		this.ctx = this.canvas.getContext('2d');
		// Swap ctx on existing sub-renderers — preserves texture/atlas/tileset caches
		this.spriteRenderer.ctx = this.ctx;
		this.tilemapRenderer.ctx = this.ctx;
		this.labelRenderer.ctx = this.ctx;
		this.guiRenderer.ctx = this.ctx;
	}

	setKeyHandler(handler: KeyHandler): void {
		this.onKey = handler;
	}

	setDebugBodies(bodies: Array<{
		x: number; y: number;
		width: number; height: number;
		isSensor: boolean; isStatic: boolean;
		label: string;
		parts?: Array<{ x: number; y: number; width: number; height: number }>;
	}>): void {
		this.debugBodies = bodies;
	}

	setTouchHandler(handler: TouchHandler): void {
		this.onTouch = handler;
	}

	async open(title = 'ku'): Promise<void> {
		const initW = Math.round(this.designWidth * this.config.scale);
		const initH = Math.round(this.designHeight * this.config.scale);

		this.window = sdl.video.createWindow({
			title,
			width: initW,
			height: initH,
			vsync: false,
			resizable: this.config.resizable,
		});
		this.running = true;
		this.lastTime = Date.now();

		// Detect DPI scale
		if (this.config.hidpi) {
			const sdlRatio = this.window.pixelWidth / initW;
			this.dpiScale = sdlRatio > 1 ? sdlRatio : detectSystemScale();
		}

		this.computeLayout();

		this.window.on('close', () => {
			this.running = false;
		});

		this.window.on('resize', () => {
			this.computeLayout();
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

		// Touch / pointer events (SDL normalized 0-1 coordinates → design space)
		(this.window as any).on('fingerDown', (event: { x: number; y: number; fingerId: number }) => {
			if (this.onTouch) {
				const p = this.mapTouch(event.x, event.y);
				this.onTouch('start', p.x, p.y, event.fingerId);
			}
		});

		(this.window as any).on('fingerMove', (event: { x: number; y: number; fingerId: number }) => {
			if (this.onTouch) {
				const p = this.mapTouch(event.x, event.y);
				this.onTouch('move', p.x, p.y, event.fingerId);
			}
		});

		(this.window as any).on('fingerUp', (event: { x: number; y: number; fingerId: number }) => {
			if (this.onTouch) {
				const p = this.mapTouch(event.x, event.y);
				this.onTouch('end', p.x, p.y, event.fingerId);
			}
		});

		// Mouse as pointer (desktop fallback). SDL gives logical window coords.
		(this.window as any).on('mouseMove', (event: { x: number; y: number }) => {
			if (this.onTouch) {
				const p = this.mapMouse(event.x, event.y);
				this.onTouch('move', p.x, p.y, 0);
			}
		});

		(this.window as any).on('mouseButtonDown', (event: { x: number; y: number; button: number }) => {
			if (this.onTouch) {
				const p = this.mapMouse(event.x, event.y);
				this.onTouch('start', p.x, p.y, 0);
			}
		});

		(this.window as any).on('mouseButtonUp', (event: { x: number; y: number; button: number }) => {
			if (this.onTouch) {
				const p = this.mapMouse(event.x, event.y);
				this.onTouch('end', p.x, p.y, 0);
			}
		});
	}

	/** Convert SDL touch normalized coords (0-1) to design space. */
	private mapTouch(nx: number, ny: number): { x: number; y: number } {
		const logW = this.window?.width ?? this.designWidth;
		const logH = this.window?.height ?? this.designHeight;
		const wx = nx * logW;
		const wy = ny * logH;
		return this.windowToDesign(wx, wy);
	}

	/** Convert SDL mouse logical coords to design space. */
	private mapMouse(mx: number, my: number): { x: number; y: number } {
		return this.windowToDesign(mx, my);
	}

	/** Map logical window coordinates to design coordinates. */
	private windowToDesign(wx: number, wy: number): { x: number; y: number } {
		return {
			x: (wx - this.targetX) * this.designWidth / this.targetW,
			y: (wy - this.targetY) * this.designHeight / this.targetH,
		};
	}

	/** Recompute canvas size, stretch rect, draw transforms. Called on open and resize. */
	private computeLayout(): void {
		if (!this.window) return;

		const logW = this.window.width;
		const logH = this.window.height;
		const physW = this.window.pixelWidth;
		const physH = this.window.pixelHeight;
		const mode = this.config.stretch_mode;

		if (mode === 'disabled') {
			this.canvasW = this.designWidth;
			this.canvasH = this.designHeight;
			this.targetX = 0;
			this.targetY = 0;
			this.targetW = logW;
			this.targetH = logH;
			this.dstRect = null;
			this.drawScaleX = 1;
			this.drawScaleY = 1;
			this.drawOffsetX = 0;
			this.drawOffsetY = 0;
			this.presentScaling = 'nearest';
			this.snapGrid = 1;
		} else if (mode === 'viewport') {
			// Canvas = design size. SDL scales to dstRect in physical pixels.
			const s = computeStretch(
				this.designWidth, this.designHeight,
				physW, physH,
				this.config.stretch_aspect, this.config.scale_mode,
			);
			this.canvasW = this.designWidth;
			this.canvasH = this.designHeight;
			this.targetX = s.x / this.dpiScale;
			this.targetY = s.y / this.dpiScale;
			this.targetW = s.w / this.dpiScale;
			this.targetH = s.h / this.dpiScale;
			this.dstRect = { x: s.x, y: s.y, width: s.w, height: s.h };
			this.drawScaleX = 1;
			this.drawScaleY = 1;
			this.drawOffsetX = 0;
			this.drawOffsetY = 0;
			this.presentScaling = 'nearest';
			this.snapGrid = 1;
		} else {
			// canvas_items: canvas = window physical size, draw with scale transform.
			const s = computeStretch(
				this.designWidth, this.designHeight,
				logW, logH,
				this.config.stretch_aspect, this.config.scale_mode,
			);
			this.canvasW = physW;
			this.canvasH = physH;
			this.targetX = s.x;
			this.targetY = s.y;
			this.targetW = s.w;
			this.targetH = s.h;
			this.dstRect = null;
			this.drawScaleX = (s.w / this.designWidth) * this.dpiScale;
			this.drawScaleY = (s.h / this.designHeight) * this.dpiScale;
			this.drawOffsetX = s.x * this.dpiScale;
			this.drawOffsetY = s.y * this.dpiScale;
			this.presentScaling = 'linear';
			this.snapGrid = this.drawScaleX > 0 ? 1 / this.drawScaleX : 1;
		}

		if (this.canvas.width !== this.canvasW || this.canvas.height !== this.canvasH) {
			this.initCanvas(this.canvasW, this.canvasH);
		}
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
		const mode = this.config.stretch_mode;

		// canvas_items: black fill for letterbox areas, then apply stretch transform
		if (mode === 'canvas_items') {
			ctx.fillStyle = '#000000';
			ctx.fillRect(0, 0, this.canvasW, this.canvasH);
			ctx.save();
			ctx.translate(this.drawOffsetX, this.drawOffsetY);
			ctx.scale(this.drawScaleX, this.drawScaleY);
		}

		ctx.fillStyle = '#1a1a2e';
		ctx.fillRect(0, 0, this.designWidth, this.designHeight);

		// Find active camera
		const cam = findCamera(tree, this.cameraCache);

		ctx.save();
		ctx.translate(this.designWidth / 2, this.designHeight / 2);
		ctx.scale(cam.zoom, cam.zoom);
		// Snap camera to integer pixels at 1x zoom for pixel-perfect movement
		const camX = cam.zoom === 1 ? snapToGrid(cam.x, this.snapGrid) : cam.x;
		const camY = cam.zoom === 1 ? snapToGrid(cam.y, this.snapGrid) : cam.y;
		ctx.translate(-camX, -camY);

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
				// Tiled format: tiled_layers property
				const tiledLayers = node.getProperty('tiled_layers');
				if (Array.isArray(tiledLayers)) {
					for (const layer of tiledLayers as any[]) {
						// Spritesheet image
						if (layer.image) {
							const abs = layer.image.startsWith('/') ? layer.image : resolve(this.projectDir, layer.image);
							if (!this.tilemapRenderer.hasTexture(abs)) {
								loadPromises.push(
									loadImage(abs).then(img => { this.tilemapRenderer.cacheTexture(abs, img); }).catch(() => {}),
								);
							}
						}
						// Per-tile images (image collection tilesets)
						if (layer.tile_images) {
							for (const tileInfo of Object.values(layer.tile_images) as { image: string }[]) {
								const abs = tileInfo.image.startsWith('/') ? tileInfo.image : resolve(this.projectDir, tileInfo.image);
								if (!this.tilemapRenderer.hasTexture(abs)) {
									loadPromises.push(
										loadImage(abs).then(img => { this.tilemapRenderer.cacheTexture(abs, img); }).catch(() => {}),
									);
								}
							}
						}
					}
				} else {
					const tileset = (node.getProperty('tileset') as string) ?? '';
					const cellSize = (node.getProperty('cell_size') as number) ?? 16;
					if (tileset.endsWith('.tileset.json')) {
						loadPromises.push(
							this.tilemapRenderer.loadTilesetDef(tileset).then(def => {
								if (def) return this.tilemapRenderer.loadTilesetTextures(def);
							}),
						);
					} else if (tileset) {
						loadPromises.push(this.tilemapRenderer.loadTilesetImage(tileset, cellSize, cellSize));
					}
					const terrainMap = node.getProperty('terrain_map');
					if (terrainMap && typeof terrainMap === 'object') {
						loadPromises.push(this.tilemapRenderer.loadTerrainAtlases(node));
					}
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

		if (mode === 'canvas_items') {
			ctx.restore(); // stretch transform
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
		// Snap world position for pixel-perfect rendering
		const snapped: Transform2D = {
			...world,
			x: snapToGrid(world.x, this.snapGrid),
			y: snapToGrid(world.y, this.snapGrid),
		};

		// ScrollView: clip + scroll offset for children
		if (node.type === 'ScrollView') {
			this.drawNode(node, snapped.x, snapped.y, world.scaleX, world.scaleY, dt);
			this.guiRenderer.beginScrollView(node, snapped.x, snapped.y);
			for (const child of node.children) {
				this.drawNodeRecursive(child, IDENTITY, dt);
			}
			this.guiRenderer.endScrollView();
			return;
		}

		this.drawNode(node, snapped.x, snapped.y, world.scaleX, world.scaleY, dt);

		for (const child of node.children) {
			this.drawNodeRecursive(child, snapped, dt);
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
		const snapped: Transform2D = {
			...world,
			x: snapToGrid(world.x, this.snapGrid),
			y: snapToGrid(world.y, this.snapGrid),
		};

		// ScrollView: clip + scroll offset for children
		if (node.type === 'ScrollView') {
			this.drawNode(node, snapped.x, snapped.y, world.scaleX, world.scaleY, dt);
			this.guiRenderer.beginScrollView(node, snapped.x, snapped.y);
			for (const child of node.children) {
				this.drawGuiRecursive(child, IDENTITY, dt);
			}
			this.guiRenderer.endScrollView();
			return;
		}

		this.drawNode(node, snapped.x, snapped.y, world.scaleX, world.scaleY, dt);

		for (const child of node.children) {
			this.drawGuiRecursive(child, snapped, dt);
		}
	}

	private drawNode(node: Node, wx: number, wy: number, sx: number, sy: number, dt: number): void {
		const ctx = this.ctx;
		if (!ctx) return;
		// Snap to integer pixels when scale is uniform (pixel-perfect rendering)
		const px = (sx === 1 && sy === 1) ? snapToGrid(wx, this.snapGrid) : wx;
		const py = (sx === 1 && sy === 1) ? snapToGrid(wy, this.snapGrid) : wy;
		ctx.save();
		ctx.translate(px, py);
		ctx.scale(sx, sy);
		ctx.translate(-px, -py);

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
		// Draw physics bodies (includes tile collisions not in scene tree)
		for (const body of this.debugBodies) {
			const color = body.isSensor ? 'rgba(0, 255, 255, 0.8)' : body.isStatic ? '#ff6600' : '#ffff00';
			this.ctx.strokeStyle = color;
			this.ctx.lineWidth = 1;
			if (body.parts && body.parts.length > 0) {
				for (const part of body.parts) {
					this.ctx.strokeRect(part.x - part.width / 2, part.y - part.height / 2, part.width, part.height);
				}
			} else {
				this.ctx.strokeRect(body.x - body.width / 2, body.y - body.height / 2, body.width, body.height);
			}
		}
		// Draw scene tree debug shapes
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
				this.ctx.lineWidth = 2;
				this.ctx.strokeRect(world.x - w / 2, world.y - h / 2, w, h);
				break;
			}
			case 'Area': {
				const color = (node.getProperty('color') as string) ?? 'rgba(0, 255, 255, 0.5)';
				const aW = (node.getProperty('width') as number) ?? 32;
				const aH = (node.getProperty('height') as number) ?? 32;
				this.ctx.strokeStyle = color;
				this.ctx.lineWidth = 2;
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

		// canvas.data() returns a direct Buffer view into pixel memory — zero allocation
		const buffer = this.canvas.data();

		const opts: { scaling?: 'nearest' | 'linear'; dstRect?: { x: number; y: number; width: number; height: number } } = {
			scaling: this.presentScaling,
		};
		if (this.dstRect) {
			opts.dstRect = this.dstRect;
		}
		this.window.render(this.canvasW, this.canvasH, this.canvasW * 4, 'rgba32', buffer, opts);
	}

	getWidth(): number {
		return this.designWidth;
	}

	getHeight(): number {
		return this.designHeight;
	}

	clearAnimState(nodeId: string): void {
		this.spriteRenderer.clearAnimTimer(nodeId);
	}
}
