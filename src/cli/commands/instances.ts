import { readDiscovery, isAlive, type InstanceType } from '../../server/discovery.js';
import { sendCommand, makeMessage } from '../client.js';

export async function listInstances(projectDir: string): Promise<void> {
  const disc = await readDiscovery(projectDir);
  const results: Record<string, unknown>[] = [];

  for (const inst of ['edit', 'play'] as InstanceType[]) {
    const info = disc[inst];
    if (!info) {
      results.push({ instance: inst, status: 'stopped' });
      continue;
    }
    const alive = isAlive(info.pid);
    if (!alive) {
      results.push({ instance: inst, status: 'stopped (stale pid)' });
      continue;
    }
    try {
      const resp = await sendCommand('localhost', info.port, makeMessage('instance.info'));
      results.push({
        instance: inst,
        status: 'running',
        pid: info.pid,
        port: info.port,
        ...(resp.payload.ok ? resp.payload.data as Record<string, unknown> : {}),
      });
    } catch {
      results.push({ instance: inst, status: 'running', pid: info.pid, port: info.port });
    }
  }

  printJson({ ok: true, data: results });
}

export async function findInstancePort(projectDir: string, instance: InstanceType): Promise<number> {
  const disc = await readDiscovery(projectDir);
  const info = disc[instance];
  if (!info || !isAlive(info.pid)) {
    throw new Error(`${instance} instance is not running`);
  }
  return info.port;
}

function printJson(data: unknown): void {
  console.log(JSON.stringify(data));
}
