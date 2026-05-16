import { type Canvas, loadImage, type Image } from '@napi-rs/canvas';
import { Node } from '../engine/node.js';

type Ctx = ReturnType<Canvas['getContext']>;

export class TilemapRenderer {
  private ctx: Ctx;
  private tilesetCache = new Map<string, { img: Image; tileWidth: number; tileHeight: number }>();

  constructor(ctx: Ctx) {
    this.ctx = ctx;
  }

  drawTilemap(node: Node, x: number, y: number): void {
    const tileset = (node.getProperty('tileset') as string) ?? '';
    const cellSize = (node.getProperty('cell_size') as number) ?? 16;
    const columns = (node.getProperty('columns') as number) ?? 0;
    const rows = (node.getProperty('rows') as number) ?? 0;
    const data = (node.getProperty('data') as string) ?? '';

    if (!tileset || columns === 0 || rows === 0 || !data) return;

    const cached = this.tilesetCache.get(tileset);
    if (!cached) return;

    const { img, tileWidth, tileHeight } = cached;
    const tilesPerRow = Math.floor(img.width / tileWidth);
    const ctx = this.ctx;

    // Parse tile data: comma-separated tile indices, -1 = empty
    const tileIndices = data.split(',').map(s => parseInt(s.trim(), 10));

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < columns; col++) {
        const idx = tileIndices[row * columns + col];
        if (idx === undefined || idx < 0) continue;

        const srcCol = idx % tilesPerRow;
        const srcRow = Math.floor(idx / tilesPerRow);
        const sx = srcCol * tileWidth;
        const sy = srcRow * tileHeight;
        const dx = x + col * cellSize;
        const dy = y + row * cellSize;

        ctx.drawImage(img, sx, sy, tileWidth, tileHeight, dx, dy, cellSize, cellSize);
      }
    }
  }

  async loadTileset(path: string, tileWidth: number, tileHeight: number): Promise<void> {
    if (this.tilesetCache.has(path)) return;
    try {
      const img = await loadImage(path);
      this.tilesetCache.set(path, { img, tileWidth, tileHeight });
    } catch {
      // ignore
    }
  }
}
