import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const mic = require('mic') as (options: Record<string, unknown>) => MicInstance;

type MicInstance = {
  getAudioStream(): NodeJS.ReadableStream;
  start(): void;
  stop(): void;
};

type ActiveRecording = {
  instance: MicInstance;
  file: string;
  startedAt: number;
  done: Promise<string>;
};

let active: ActiveRecording | undefined;

export function isRecording() {
  return Boolean(active);
}

export async function startRecording(): Promise<string> {
  if (active) throw new Error('Recording already active');

  const dir = join(homedir(), '.wisper-cli', 'tmp');
  await mkdir(dir, { recursive: true });
  const file = join(dir, `recording-${Date.now()}.wav`);

  const instance = mic({
    rate: '16000',
    channels: '1',
    debug: false,
    exitOnSilence: 0,
    fileType: 'wav'
  });

  const stream = instance.getAudioStream();
  const output = createWriteStream(file);
  stream.pipe(output);

  const done = new Promise<string>((resolve, reject) => {
    stream.once('error', reject);
    output.once('error', reject);
    output.once('finish', () => resolve(file));
  });

  active = { instance, file, startedAt: Date.now(), done };
  instance.start();
  return file;
}

export async function stopRecording(): Promise<{ file: string; durationMs: number }> {
  if (!active) throw new Error('Recording is not active');

  const current = active;
  active = undefined;
  current.instance.stop();
  const file = await current.done;
  return { file, durationMs: Date.now() - current.startedAt };
}
