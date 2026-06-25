import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

export type Provider = 'groq' | 'elevenlabs' | 'sarvam';

export type Config = {
  provider?: Provider;
  shortcut?: string;
  keys?: Partial<Record<Provider, string>>;
  autostart?: boolean;
};

const dataDir = join(homedir(), '.wisper-cli');
const configFile = join(dataDir, 'config.json');

export const providers: Provider[] = ['groq', 'elevenlabs', 'sarvam'];
export const defaultShortcut = 'Ctrl+Alt+Space';

export async function loadConfig(): Promise<Config> {
  await mkdir(dataDir, { recursive: true });
  try {
    return JSON.parse(await readFile(configFile, 'utf8')) as Config;
  } catch {
    return {};
  }
}

export async function saveConfig(config: Config): Promise<void> {
  await mkdir(dataDir, { recursive: true });
  await writeFile(configFile, JSON.stringify(config, null, 2));
}

export async function updateConfig(patch: Config): Promise<Config> {
  const current = await loadConfig();
  const next: Config = {
    ...current,
    ...patch,
    keys: { ...current.keys, ...patch.keys }
  };
  await saveConfig(next);
  return next;
}
