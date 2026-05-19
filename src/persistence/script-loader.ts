import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export async function loadScriptSource(projectDir: string, scriptPath: string): Promise<string> {
  const absPath = resolve(projectDir, scriptPath);
  return readFile(absPath, 'utf-8');
}
