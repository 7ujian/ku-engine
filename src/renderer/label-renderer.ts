import { type Canvas } from '@napi-rs/canvas';
import { Node } from '../engine/node.js';

type Ctx = ReturnType<Canvas['getContext']>;

export class LabelRenderer {
  private ctx: Ctx;

  constructor(ctx: Ctx) {
    this.ctx = ctx;
  }

  drawLabel(node: Node, x: number, y: number): void {
    const text = (node.getProperty('text') as string) ?? '';
    const fontSize = (node.getProperty('font_size') as number) ?? 16;
    const color = (node.getProperty('color') as string) ?? '#ffffff';

    if (!text) return;

    this.ctx.font = `${fontSize}px monospace`;
    this.ctx.fillStyle = color;
    this.ctx.fillText(text, x, y);
  }
}
