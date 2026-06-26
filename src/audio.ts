import { mkdir } from 'node:fs/promises';
import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { homedir } from 'node:os';

const activeSignals = ['SIGINT', 'SIGTERM'] as const;

type ActiveRecording = {
  process: ChildProcess;
  file: string;
  startedAt: number;
  done: Promise<void>;
};

let active: ActiveRecording | undefined;

export function isRecording() {
  return Boolean(active);
}

function soxCommand() {
  return process.platform === 'win32' ? 'sox.exe' : 'sox';
}

export async function startRecording(): Promise<string> {
  if (active) throw new Error('Recording already active');

  const dir = join(homedir(), '.wisper-cli', 'tmp');
  await mkdir(dir, { recursive: true });
  const file = join(dir, `recording-${Date.now()}.wav`);

  const child = spawn(soxCommand(), ['-d', '-r', '16000', '-c', '1', '-b', '16', file], {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => { stderr += chunk; });

  const done = new Promise<void>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0 || code === null || activeSignals.includes((child.signalCode || '') as typeof activeSignals[number])) {
        resolve();
        return;
      }
      reject(new Error(stderr.trim() || `SoX exited with code ${code}`));
    });
  });

  active = { process: child, file, startedAt: Date.now(), done };
  return file;
}

export async function stopRecording(): Promise<{ file: string; durationMs: number }> {
  if (!active) throw new Error('Recording is not active');

  const current = active;
  active = undefined;

  if (process.platform === 'win32') {
    spawn('taskkill.exe', ['/PID', String(current.process.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  } else {
    current.process.kill('SIGINT');
  }

  await current.done.catch(() => undefined);
  return { file: current.file, durationMs: Date.now() - current.startedAt };
}
