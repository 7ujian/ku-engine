type EventHandler = (data: Record<string, unknown>) => void;

export class EventBus {
  private handlers = new Map<string, Set<EventHandler>>();

  on(name: string, handler: EventHandler): void {
    let set = this.handlers.get(name);
    if (!set) {
      set = new Set();
      this.handlers.set(name, set);
    }
    set.add(handler);
  }

  off(name: string, handler: EventHandler): void {
    this.handlers.get(name)?.delete(handler);
  }

  emit(name: string, data: Record<string, unknown> = {}): void {
    this.handlers.get(name)?.forEach(h => h(data));
  }

  clear(): void {
    this.handlers.clear();
  }
}
