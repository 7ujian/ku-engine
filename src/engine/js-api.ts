export interface JsNodeApi {
  get(prop: string): unknown;
  set(prop: string, value: unknown): void;
  id: string;
  type: string;
}

export interface JsSceneApi {
  get(path: string, prop: string): unknown;
  set(path: string, prop: string, value: unknown): void;
  spawn(type: string, id: string, props?: Record<string, unknown>): void;
  destroy(path: string): void;
  find(path: string): JsNodeApi | null;
}

export interface JsScriptContext {
  node: JsNodeApi;
  scene: JsSceneApi;
  data: Record<string, unknown>;
  emit(event: string, data?: Record<string, unknown>): void;
  log: (...args: unknown[]) => void;
}
