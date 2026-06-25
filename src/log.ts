import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

export const logFile = join(homedir(), '.wisper-cli', 'wisper.log');

export async function log(message: string) {
  await mkdir(join(homedir(), '.wisper-cli'), { recursive: true });
  const line = `[${new Date().toISOString()}] ${message}\n`;
  await appendFile(logFile, line).catch(() => undefined);
  console.log(message);
}

export async function readLogs() {
  try {
    return await readFile(logFile, 'utf8');
  } catch {
    return 'No logs yet.';
  }
}
