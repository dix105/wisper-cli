#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { loadConfig, updateConfig, type Config, type Provider } from './config.js';
import { createPrompt } from './prompt.js';
import { startRecording, stopRecording } from './audio.js';
import { transcribeFile } from './transcribe.js';
import { verifyProviderKey } from './verify.js';
import { analyzeMeeting } from './notebot-ai.js';
import { clearActiveMeeting, loadActiveMeeting, loadMeetings, notebotAudioDir, notebotDir, saveActiveMeeting, saveMeeting, type ActiveMeeting } from './notebot-storage.js';
import { startNoteBotWebApp } from './notebot-server.js';
import { openUrl } from './open.js';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const [command, ...args] = process.argv.slice(2);

async function main() {
  if (command === 'setup') return setup();
  if (command === 'model' || command === 'provider') return chooseModel();
  if (command === 'meeting') return meeting(args);
  if (command === 'audio') return processAudioCommand(args);
  if (command === 'open' || command === 'app') return openDashboard(args);
  if (command === 'stop') return stopDashboard();
  if (command === 'restart') return restartDashboard(args);
  if (command === 'history') return history();
  if (command === 'tasks') return tasks();
  if (command === '_record') return recordWorker(args[0]);
  return help();
}

/** Providers NoteBot can transcribe with, and the model each uses. */
const MEETING_PROVIDERS: Array<{ provider: Provider; model: string; label: string }> = [
  { provider: 'sarvam', model: 'saaras:v3', label: 'Sarvam Saaras v3 — long audio, speaker labels (recommended)' },
  { provider: 'groq', model: 'whisper-large-v3-turbo', label: 'Groq Whisper — fast, no speaker labels, 25 MiB limit' },
  { provider: 'nextbase-codex', model: 'codex-transcribe', label: 'Nextbase Codex — subscription gateway, 25 MiB limit' }
];

function modelFor(provider: Provider) {
  return MEETING_PROVIDERS.find((entry) => entry.provider === provider)?.model
    ?? (provider === 'elevenlabs' ? 'scribe_v2' : 'saaras:v3');
}

/**
 * The provider and model NoteBot should use — never Wisper's.
 *
 * Falls back to Sarvam when a key for it exists, because there was previously no way to
 * choose separately: NoteBot simply used whatever dictation was set to. Sarvam is the
 * only configured provider with a Batch API, so it is the only one that handles a long
 * meeting or returns speaker labels at all.
 */
function meetingConfig(config: Config): Config {
  const provider = config.meetingProvider
    ?? (config.keys?.sarvam ? 'sarvam' : config.provider);
  if (!provider) return config;
  return { ...config, provider, model: config.meetingModel ?? modelFor(provider) };
}

async function chooseModel() {
  const config = await loadConfig();
  const effective = meetingConfig(config);
  console.log('NoteBot transcription providers:');
  for (const entry of MEETING_PROVIDERS) {
    const current = effective.provider === entry.provider;
    const key = config.keys?.[entry.provider] ? 'key saved' : 'no key';
    console.log(`  ${current ? '->' : '  '} ${entry.provider.padEnd(15)} ${entry.model.padEnd(24)} ${key}`);
  }
  console.log('');
  console.log(`Wisper dictation keeps its own: ${config.provider ?? 'not set'} / ${config.model ?? 'not set'}`);
  console.log('');

  const prompt = createPrompt();
  try {
    const chosen = await prompt.choose('Provider for meetings:', MEETING_PROVIDERS.map((entry) => entry.label));
    const entry = MEETING_PROVIDERS.find((option) => option.label === chosen) ?? MEETING_PROVIDERS[0];

    if (!config.keys?.[entry.provider]) {
      const key = await prompt.ask(`Paste ${entry.provider} API key: `);
      const result = await verifyProviderKey(entry.provider, key);
      console.log(result.message);
      if (!result.ok) throw new Error(`Could not verify ${entry.provider} key. Nothing was changed.`);
      await updateConfig({ keys: { [entry.provider]: key } });
    }

    // Only the meeting fields: writing provider/model here is what broke dictation.
    await updateConfig({ meetingProvider: entry.provider, meetingModel: entry.model });
    console.log(`Meetings will use ${entry.provider} / ${entry.model}.`);
    if (entry.provider !== 'sarvam') {
      console.log('Note: only Sarvam handles audio over 25 MiB and returns speaker labels.');
    }
  } finally {
    prompt.close();
  }
}

function help() {
  console.log(`Nextbase NoteBot

Commands:
  notebot setup                  Configure transcription and meeting-summary keys
  notebot model                  Choose NoteBot's transcription provider (not Wisper's)
  notebot meeting start          Start background meeting recording
  notebot meeting stop           Stop, transcribe, and create meeting notes
  notebot meeting status         Show active meeting state
  notebot audio <path-or-url>    Process an existing local or remote audio file
  notebot open                   Open local NoteBot dashboard
  notebot stop                   Stop local NoteBot dashboard
  notebot restart                Restart local NoteBot dashboard
  notebot history                Show saved meetings
  notebot tasks                  Show open extracted tasks
`);
}

async function setup() {
  const prompt = createPrompt();
  try {
    const config = await loadConfig();
    const provider = await prompt.choose('Meeting transcription provider:', [
      'Sarvam (best for long Hindi/Gujarati/English meetings + speaker labels)',
      'Groq (fast general fallback)',
      'Nextbase Codex Transcribe (subscription gateway, files up to 25 MiB)'
    ]);
    const selected: Provider = provider.startsWith('Sarvam') ? 'sarvam' : provider.startsWith('Nextbase') ? 'nextbase-codex' : 'groq';
    const existingSttKey = config.keys?.[selected];
    if (!existingSttKey) {
      const key = await prompt.ask(selected === 'nextbase-codex' ? 'Paste Nextbase gateway key (nbmg_...): ' : `Paste ${selected} API key: `);
      const result = await verifyProviderKey(selected, key);
      console.log(result.message);
      if (!result.ok) throw new Error(`Could not verify ${selected} key. Setup stopped.`);
      // meetingProvider/meetingModel, never provider/model: those belong to Wisper.
      await updateConfig({ meetingProvider: selected, meetingModel: modelFor(selected), keys: { [selected]: key } });
    } else {
      await updateConfig({ meetingProvider: selected, meetingModel: modelFor(selected) });
      console.log(`${selected} key already saved.`);
    }

    const refreshed = await loadConfig();
    if (!refreshed.keys?.groq) {
      const groqKey = await prompt.ask('Paste Groq API key for summaries/tasks: ');
      const result = await verifyProviderKey('groq', groqKey);
      console.log(result.message);
      if (!result.ok) throw new Error('Could not verify Groq key. Setup stopped.');
      await updateConfig({ keys: { groq: groqKey }, polishModel: 'llama-3.3-70b-versatile' });
    } else {
      console.log('Groq summary key already saved.');
    }

    console.log('NoteBot setup complete. Start with: notebot meeting start');
  } finally {
    prompt.close();
  }
}

async function meeting(args: string[]) {
  const action = args[0]?.toLowerCase();
  if (action === 'start') return startMeeting();
  if (action === 'stop') return stopMeeting();
  if (action === 'status') return meetingStatus();
  throw new Error('Usage: notebot meeting start/stop/status');
}

async function ensureConfigured() {
  let config = await loadConfig();
  const usable = (candidate: Config) => {
    const effective = meetingConfig(candidate);
    return Boolean(effective.provider && effective.keys?.[effective.provider] && candidate.keys?.groq);
  };
  if (!usable(config)) {
    if (!process.stdin.isTTY) throw new Error('NoteBot keys are not configured. Run: notebot setup');
    console.log('NoteBot needs transcription and Groq summary keys. Starting setup...');
    await setup();
    config = await loadConfig();
  }
  if (!usable(config)) {
    throw new Error('NoteBot keys are not configured. Run: notebot setup');
  }
  return config;
}

async function startMeeting() {
  await ensureConfigured();
  const active = await loadActiveMeeting();
  if (active?.status === 'starting' || active?.status === 'recording') {
    throw new Error('A meeting is already recording. Run: notebot meeting stop');
  }

  const id = `meeting-${Date.now()}`;
  await saveActiveMeeting({ id, startedAt: Date.now(), status: 'starting' });
  const cliPath = fileURLToPath(new URL('./notebot-cli.js', import.meta.url));
  const child = spawn(process.execPath, [cliPath, '_record', id], { detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
  await saveActiveMeeting({ id, startedAt: Date.now(), status: 'starting', pid: child.pid });
  console.log(`Meeting recording started in background. ID: ${id}`);
  console.log('When the meeting ends, run: notebot meeting stop');
}

async function recordWorker(id?: string) {
  const active = await loadActiveMeeting();
  if (!id || !active || active.id !== id) process.exit(1);
  const config = await loadConfig();
  const file = await startRecording(config.audioDevice);
  await saveActiveMeeting({ ...active, status: 'recording', audioPath: file, pid: process.pid });

  const stop = async () => {
    try {
      const finished = await stopRecording();
      const current = await loadActiveMeeting();
      if (current?.id === id) await saveActiveMeeting({ ...current, status: 'recorded', audioPath: finished.file });
      process.exit(0);
    } catch {
      process.exit(1);
    }
  };
  process.once('SIGINT', () => { void stop(); });
  process.once('SIGTERM', () => { void stop(); });
  await new Promise(() => undefined);
}

async function stopMeeting() {
  const active = await loadActiveMeeting();
  if (!active || active.status === null) throw new Error('No active meeting. Run: notebot meeting start');
  if (active.status !== 'recorded' && active.pid) {
    try { process.kill(active.pid, 'SIGTERM'); } catch { /* recorder may already have stopped */ }
  }

  let recorded = active;
  for (let i = 0; i < 40; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    const latest = await loadActiveMeeting();
    if (latest?.status === 'recorded' && latest.audioPath && existsSync(latest.audioPath)) {
      recorded = latest;
      break;
    }
  }

  if (recorded.status !== 'recorded' || !recorded.audioPath || !existsSync(recorded.audioPath)) {
    throw new Error('Meeting recorder did not finalize audio. Try: notebot meeting status');
  }

  const info = await stat(recorded.audioPath);
  if (info.size < 1024) throw new Error('Meeting audio is empty. Check microphone/system-audio setup.');

  const note = await processAudioFile(recorded.audioPath, recorded.id, recorded.startedAt, Date.now() - recorded.startedAt);
  await clearActiveMeeting();

  console.log(`Saved: ${note.title}`);
  console.log(`Decisions: ${note.decisions.length} | Tasks: ${note.actionItems.length}`);
  for (const task of note.actionItems) console.log(`- [${task.confidence}] ${task.task}${task.owner ? ` — ${task.owner}` : ''}`);
}

async function processAudioCommand(args: string[]) {
  const source = args.join(' ').trim();
  if (!source) throw new Error('Usage: notebot audio <local-path-or-remote-url>');
  const audioPath = await resolveAudioSource(source);
  const note = await processAudioFile(audioPath, `audio-${Date.now()}`, Date.now(), 0);
  console.log(`Saved: ${note.title}`);
  console.log(`Decisions: ${note.decisions.length} | Tasks: ${note.actionItems.length}`);
  for (const task of note.actionItems) console.log(`- [${task.confidence}] ${task.task}${task.owner ? ` — ${task.owner}` : ''}`);
}

async function openDashboard(args: string[]) {
  const url = await startNoteBotWebApp(Number(args[0] || 3840));
  openUrl(url);
  console.log(`NoteBot dashboard running at ${url}`);
  console.log('Press Ctrl+C to stop, or run: notebot stop');
}

async function stopDashboard() {
  const pidFile = join(notebotDir, 'dashboard.pid');
  let pid: number | undefined;
  try {
    pid = Number((await readFile(pidFile, 'utf8')).trim());
  } catch {
    console.log('No NoteBot dashboard PID found. If it is still open, close the terminal/window that started it.');
    return;
  }
  if (!pid || !Number.isFinite(pid)) {
    await rm(pidFile, { force: true });
    console.log('Invalid NoteBot dashboard PID cleaned up.');
    return;
  }
  try {
    process.kill(pid, 'SIGTERM');
    console.log(`Stopped NoteBot dashboard process ${pid}.`);
  } catch {
    console.log('Dashboard process was not running. Cleaned up stale PID.');
  }
  await rm(pidFile, { force: true }).catch(() => undefined);
}

async function restartDashboard(args: string[]) {
  await stopDashboard();
  await openDashboard(args);
}

async function processAudioFile(audioPath: string, id: string, startedAt: number, durationMs: number) {
  const info = await stat(audioPath);
  if (info.size < 1024) throw new Error('Audio file is empty or too small.');

  console.log('Transcribing meeting audio...');
  const config = await ensureConfigured();
  // The meeting provider, never Wisper's.
  const transcript = await transcribeFile(audioPath, meetingConfig(config));
  if (!transcript) throw new Error('Meeting transcription returned no text.');

  console.log('Extracting summary, decisions, and action items...');
  const analysis = await analyzeMeeting(transcript, config);
  const note = {
    id,
    createdAt: new Date(startedAt).toISOString(),
    durationMs,
    audioPath,
    transcript,
    ...analysis
  };
  await saveMeeting(note);
  return note;
}

async function resolveAudioSource(source: string) {
  if (/^https?:\/\//i.test(source)) return downloadAudio(source);
  if (source.startsWith('file://')) source = fileURLToPath(source);
  if (!existsSync(source)) throw new Error(`Audio file not found: ${source}`);
  return source;
}

async function downloadAudio(url: string) {
  await mkdir(notebotAudioDir, { recursive: true });
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not download audio: HTTP ${response.status}`);
  const parsed = new URL(url);
  const extension = extname(parsed.pathname) || '.audio';
  const safeName = basename(parsed.pathname).replace(/[^a-z0-9._-]/gi, '-') || `remote-${Date.now()}${extension}`;
  const output = join(notebotAudioDir, `${Date.now()}-${safeName}`);
  await writeFile(output, Buffer.from(await response.arrayBuffer()));
  return output;
}

async function meetingStatus() {
  const active = await loadActiveMeeting();
  if (!active) return console.log('No active meeting.');
  const seconds = Math.round((Date.now() - active.startedAt) / 1000);
  console.log(`Meeting: ${active.id}`);
  console.log(`Status: ${active.status}`);
  console.log(`Duration: ${seconds}s`);
  console.log(`Audio: ${active.audioPath || 'initializing'}`);
}

async function history() {
  const meetings = await loadMeetings();
  if (!meetings.length) return console.log('No saved meetings.');
  for (const note of meetings.slice(0, 20)) console.log(`${note.createdAt}  ${note.title}  (${note.actionItems.length} tasks)`);
}

async function tasks() {
  const meetings = await loadMeetings();
  const items = meetings.flatMap((note) => note.actionItems.map((task) => ({ ...task, title: note.title })));
  if (!items.length) return console.log('No extracted tasks.');
  for (const task of items) console.log(`- [${task.confidence}] ${task.task}${task.owner ? ` — ${task.owner}` : ''} (${task.title})`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
