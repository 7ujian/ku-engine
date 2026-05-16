export interface PropertyMap {
  [key: string]: string | number | boolean | null | PropertyMap | unknown[];
}

export interface ScriptFilter {
  [key: string]: unknown;
}

export interface ScriptAction {
  set?: string;
  to?: unknown;
  move?: { x?: number; y?: number };
  spawn?: string;
  at?: { x?: number; y?: number };
  as?: string;
  destroy?: string;
  emit?: string;
  data?: Record<string, unknown>;
  play?: string;
  from?: number;
  stop?: string;
  log?: string;
  call?: string;
}

export interface ScriptRule {
  event: string;
  name?: string;
  filter?: ScriptFilter;
  condition?: Record<string, Record<string, unknown>>;
  actions: ScriptAction[];
}

export interface NodeData {
  id: string;
  type: string;
  properties: PropertyMap;
  children: NodeData[];
  scripts: ScriptRule[];
  instance?: string;
}

export interface SceneFile {
  scene: string;
  root: NodeData;
}
