import { WebSocketServer, WebSocket } from 'ws';
import { SceneTree } from '../engine/scene-tree.js';
import { Node } from '../engine/node.js';
import { handleMessage, type Message, type Response, type SyncOp } from './message-handler.js';
import { writeDiscovery, cleanDiscovery, type InstanceType } from './discovery.js';

export class Instance {
  mode: InstanceType;
  tree: SceneTree;
  projectDir: string;
  port: number;
  sceneName = '';
  wss: WebSocketServer | null = null;
  private syncSubscribers = new Set<WebSocket>();

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

        const result = handleMessage(this.tree, this.mode, msg);
        ws.send(JSON.stringify(result.response));

        // Handle sync.subscribe — register this ws for delta pushes
        if (msg.payload.action === 'sync.subscribe' && result.response.payload.ok) {
          this.syncSubscribers.add(ws);
          ws.on('close', () => this.syncSubscribers.delete(ws));
        }

        // Broadcast sync ops to subscribers
        if (result.syncOps && result.syncOps.length > 0) {
          this.broadcastSync(result.syncOps);
        }
      });
    });

    await new Promise<void>((resolve, reject) => {
      this.wss!.on('listening', () => {
        const addr = this.wss!.address() as { port: number } | string | null;
        if (addr && typeof addr === 'object') this.port = addr.port;
        resolve();
      });
      this.wss!.on('error', reject);
    });

    await writeDiscovery(this.projectDir, this.mode, process.pid, this.port);
  }

  async stop(): Promise<void> {
    this.syncSubscribers.clear();
    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }
    await cleanDiscovery(this.projectDir, this.mode);
  }

  snapshot(): Node {
    return this.tree.root.clone();
  }

  private broadcastSync(ops: SyncOp[]): void {
    const msg = JSON.stringify({
      type: 'sync',
      id: `sync-${Date.now()}`,
      payload: { ops },
    });
    for (const ws of this.syncSubscribers) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(msg);
      }
    }
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
