import { WebSocketServer, WebSocket } from 'ws';
import { SceneTree } from '../engine/scene-tree.js';
import { Node } from '../engine/node.js';
import { handleMessage, type Message, type Response } from './message-handler.js';
import { writeDiscovery, cleanDiscovery, type InstanceType } from './discovery.js';

export class Instance {
  mode: InstanceType;
  tree: SceneTree;
  projectDir: string;
  port: number;
  wss: WebSocketServer | null = null;

  constructor(mode: InstanceType, tree: SceneTree, projectDir: string, port: number) {
    this.mode = mode;
    this.tree = tree;
    this.projectDir = projectDir;
    this.port = port;
  }

  async start(): Promise<void> {
    this.wss = new WebSocketServer({ port: this.port });

    this.wss.on('connection', (ws: WebSocket) => {
      ws.on('message', (data: Buffer) => {
        let msg: Message;
        try {
          msg = JSON.parse(data.toString()) as Message;
        } catch {
          const resp: Response = {
            type: 'response',
            id: 'unknown',
            payload: { ok: false, error: 'invalid JSON' },
          };
          ws.send(JSON.stringify(resp));
          return;
        }
        const response = handleMessage(this.tree, this.mode, msg);
        ws.send(JSON.stringify(response));
      });
    });

    await new Promise<void>((resolve, reject) => {
      this.wss!.on('listening', resolve);
      this.wss!.on('error', reject);
    });

    await writeDiscovery(this.projectDir, this.mode, process.pid, this.port);
  }

  async stop(): Promise<void> {
    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }
    await cleanDiscovery(this.projectDir, this.mode);
  }

  snapshot(): Node {
    return this.tree.root.clone();
  }
}

export async function startInstance(
  mode: InstanceType,
  tree: SceneTree,
  projectDir: string,
  port: number,
): Promise<Instance> {
  const instance = new Instance(mode, tree, projectDir, port);
  await instance.start();
  return instance;
}
