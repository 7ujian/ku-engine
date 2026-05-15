import WebSocket from 'ws';
import type { Message, Response } from '../server/message-handler.js';

export function sendCommand(host: string, port: number, msg: Message): Promise<Response> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://${host}:${port}`);
    ws.on('open', () => {
      ws.send(JSON.stringify(msg));
    });
    ws.on('message', (data: Buffer) => {
      const resp = JSON.parse(data.toString()) as Response;
      ws.close();
      resolve(resp);
    });
    ws.on('error', (err) => {
      reject(new Error(`connection failed: ${err.message}`));
    });
    setTimeout(() => {
      ws.close();
      reject(new Error('connection timed out'));
    }, 5000);
  });
}

export function makeMessage(action: string, extra: Record<string, unknown> = {}): Message {
  return {
    type: 'command',
    id: `cmd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    payload: { action, ...extra },
  };
}
