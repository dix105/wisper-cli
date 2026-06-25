import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

export type Transcript = {
  id: string;
  text: string;
  createdAt: string;
  source?: string;
};

const dataDir = join(homedir(), '.wisper-cli');
const historyFile = join(dataDir, 'history.json');

export async function ensureDataDir() {
  await mkdir(dataDir, { recursive: true });
}

export async function loadHistory(): Promise<Transcript[]> {
  await ensureDataDir();
  try {
    return JSON.parse(await readFile(historyFile, 'utf8')) as Transcript[];
  } catch {
    return [];
  }
}

export async function saveTranscript(text: string, source = 'manual'): Promise<Transcript> {
  const history = await loadHistory();
  const item: Transcript = {
    id: crypto.randomUUID(),
    text,
    source,
    createdAt: new Date().toISOString()
  };
  history.unshift(item);
  await writeFile(historyFile, JSON.stringify(history.slice(0, 500), null, 2));
  return item;
}
