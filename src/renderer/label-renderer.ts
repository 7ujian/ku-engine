import { type Canvas } from '@napi-rs/canvas';
import { Node } from '../engine/node.js';

type Ctx = ReturnType<Canvas['getContext']>;

export class LabelRenderer {
  ctx: Ctx;

  constructor(ctx: Ctx) {
    this.ctx = ctx;
  }

  drawLabel(node: Node, x: number, y: number): void {
    const text = (node.getProperty('text') as string) ?? '';
    const fontSize = (node.getProperty('font_size') as number) ?? 16;
    const color = (node.getProperty('color') as string) ?? '#ffffff';
    const align = (node.getProperty('align') as string) ?? 'left';
    const valign = (node.getProperty('valign') as string) ?? 'top';
    const maxWidth = (node.getProperty('max_width') as number) ?? 0;
    const font = (node.getProperty('font') as string) ?? 'monospace';

    if (!text) return;

    const ctx = this.ctx;
    ctx.save();
    ctx.font = `${fontSize}px ${font}`;
    ctx.fillStyle = color;
    ctx.textBaseline = 'top';

    const lines = this.wrapText(ctx, text, maxWidth > 0 ? maxWidth : Infinity);
    const lineHeight = fontSize * 1.2;
    const totalHeight = lines.length * lineHeight;

    // Vertical alignment offset
    let yOffset = 0;
    if (valign === 'center') yOffset = -totalHeight / 2;
    else if (valign === 'bottom') yOffset = -totalHeight;

    for (let i = 0; i < lines.length; i++) {
      let lineX = x;
      ctx.textAlign = 'left';

      if (align === 'center') {
        const metrics = ctx.measureText(lines[i]);
        lineX = x - metrics.width / 2;
      } else if (align === 'right') {
        const metrics = ctx.measureText(lines[i]);
        lineX = x - metrics.width;
      }

      ctx.fillText(lines[i], lineX, y + yOffset + i * lineHeight);
    }

    ctx.restore();
  }

  private wrapText(ctx: Ctx, text: string, maxWidth: number): string[] {
    if (!isFinite(maxWidth) || maxWidth <= 0) return text.split('\n');

    const paragraphs = text.split('\n');
    const lines: string[] = [];

    for (const paragraph of paragraphs) {
      if (paragraph === '') {
        lines.push('');
        continue;
      }
      const words = paragraph.split(' ');
      let line = '';
      for (const word of words) {
        const test = line ? `${line} ${word}` : word;
        if (ctx.measureText(test).width > maxWidth && line) {
          lines.push(line);
          line = word;
        } else {
          line = test;
        }
      }
      if (line) lines.push(line);
    }

    return lines;
  }
}
