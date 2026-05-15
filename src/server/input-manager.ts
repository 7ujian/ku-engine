import { EventBus } from '../engine/event-bus.js';

export class InputManager {
  private bus: EventBus;
  private keys = new Set<string>();

  constructor(bus: EventBus) {
    this.bus = bus;
  }

  keyDown(key: string): void {
    if (this.keys.has(key)) return;
    this.keys.add(key);
    this.bus.emit('on_key', { key });
  }

  keyUp(key: string): void {
    this.keys.delete(key);
    this.bus.emit('on_key_up', { key });
  }

  click(x: number, y: number): void {
    this.bus.emit('on_click', { x, y });
  }

  setAxis(name: string, value: number): void {
    this.bus.emit('on_axis', { name, value });
  }

  isKeyDown(key: string): boolean {
    return this.keys.has(key);
  }
}
