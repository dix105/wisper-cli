import { mkdir, readFile, rm, stat } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { basename, join } from 'node:path';
import { homedir } from 'node:os';
import type { Config } from './config.js';

export async function transcribeFile(file: string, config: Config): Promise<string> {
  if (!config.provider) throw new Error('No provider configured. Run wisper setup.');
  const key = config.keys?.[config.provider];
  if (!key) throw new Error(`No API key saved for ${config.provider}. Run wisper setup.`);

  if (config.provider === 'groq') return transcribeGroq(file, key, config.model || 'whisper-large-v3-turbo');
  if (config.provider === 'elevenlabs') return transcribeElevenLabs(file, key, config.model || 'scribe_v2');
  if (config.provider === 'nextbase-codex') return transcribeNextbaseCodex(file, key);
  // No fallback to another provider. This used to catch anything mentioning "batch
  // api", "upload", "download" or "job" and quietly re-send the file to Groq Whisper —
  // which caps at 25 MiB and does not diarize, so a long meeting became either a 413 or
  // a transcript silently missing its speaker labels. A Sarvam failure now surfaces with
  // its own reason, which is the only thing that leads to fixing the actual cause.
  if (config.provider === 'sarvam') {
    return transcribeSarvamAuto(file, key, config.model || 'saaras:v3');
  }
  throw new Error('Unsupported provider');
}

async function audioForm(file: string) {
  const bytes = await readFile(file);
  const name = basename(file).match(/\.(wav|mp3|flac|m4a|ogg|opus|webm|mp4|mpeg|mpga)$/i)
    ? basename(file)
    : `${basename(file)}.wav`;
  const audioFile = new File([bytes], name, { type: 'audio/wav' });
  return { audioFile, name };
}

async function transcribeGroq(file: string, key: string, model: string) {
  const { audioFile } = await audioForm(file);
  const form = new FormData();
  form.set('file', audioFile);
  form.set('model', model);
  form.set('response_format', 'json');

  const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}` },
    body: form
  });
  const body = await response.json().catch(() => ({})) as { text?: string; error?: { message?: string } };
  if (!response.ok) throw new Error(body.error?.message || `Groq transcription failed: HTTP ${response.status}`);
  return (body.text || '').trim();
}

async function transcribeElevenLabs(file: string, key: string, model: string) {
  const { audioFile } = await audioForm(file);
  const form = new FormData();
  form.set('file', audioFile);
  form.set('model_id', model);

  const response = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
    method: 'POST',
    headers: { 'xi-api-key': key },
    body: form
  });
  const body = await response.json().catch(() => ({})) as { text?: string; detail?: string };
  if (!response.ok) throw new Error(body.detail || `ElevenLabs transcription failed: HTTP ${response.status}`);
  return (body.text || '').trim();
}

async function transcribeNextbaseCodex(file: string, key: string) {
  const size = (await stat(file)).size;
  const maxBytes = 25 * 1024 * 1024;
  if (size > maxBytes) throw new Error('Nextbase Codex Transcribe accepts audio files up to 25 MiB. Use Sarvam Batch for long meetings.');
  const { audioFile } = await audioForm(file);
  const form = new FormData();
  form.set('file', audioFile);
  form.set('model', 'codex-transcribe');
  form.set('response_format', 'json');

  const response = await fetch('https://nextbase-model-gateway.infinitycorp.tech/v1/openai-codex/audio/transcriptions', {
    method: 'POST',
    headers: { 'x-api-key': key },
    body: form
  });
  const body = await response.json().catch(() => ({})) as { text?: string; error?: { message?: string }; message?: string };
  if (!response.ok) throw new Error(body.error?.message || body.message || `Nextbase Codex transcription failed: HTTP ${response.status}`);
  return (body.text || '').trim();
}

function soxCommand() {
  return process.platform === 'win32' ? 'sox.exe' : 'sox';
}

function audioDurationSeconds(file: string): number | undefined {
  const result = spawnSync(soxCommand(), ['--i', '-D', file], { encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) return undefined;
  const duration = Number((result.stdout || '').trim());
  return Number.isFinite(duration) && duration > 0 ? duration : undefined;
}

function runSox(args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(soxCommand(), args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(stderr.trim() || `SoX failed with code ${code}`)));
  });
}

async function splitAudio(file: string, duration: number, chunkSeconds = 28) {
  const dir = join(homedir(), '.wisper-cli', 'tmp', `sarvam-chunks-${Date.now()}`);
  await mkdir(dir, { recursive: true });
  const chunks: string[] = [];
  for (let start = 0, index = 0; start < duration; start += chunkSeconds, index += 1) {
    const chunk = join(dir, `chunk-${String(index + 1).padStart(4, '0')}.wav`);
    const length = Math.min(chunkSeconds, Math.max(0.1, duration - start));
    await runSox([file, '-r', '16000', '-c', '1', '-b', '16', chunk, 'trim', String(start), String(length)]);
    chunks.push(chunk);
  }
  return { dir, chunks };
}

async function transcribeSarvamWithChunks(file: string, key: string, model: string) {
  const duration = audioDurationSeconds(file);
  if (!duration || duration <= 29) return transcribeSarvam(file, key, model);

  console.warn(`Sarvam REST supports audio under 30s. Splitting ${Math.round(duration)}s audio into 28s chunks...`);
  const { dir, chunks } = await splitAudio(file, duration);
  try {
    const transcripts: string[] = [];
    for (let index = 0; index < chunks.length; index += 1) {
      console.warn(`Sarvam chunk ${index + 1}/${chunks.length}...`);
      const text = await transcribeSarvam(chunks[index], key, model);
      if (text) transcripts.push(text);
    }
    return transcripts.join('\n').trim();
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

type SarvamErrorBody = { error?: { message?: string }; message?: string; detail?: string };

type SarvamJobStatus = {
  job_state?: string;
  job_id?: string;
  error_message?: string;
  job_details?: Array<{
    outputs?: Array<{ file_name?: string }>;
    state?: string;
    error_message?: string | null;
  }>;
};

function sarvamModel(model: string) {
  return model === 'saarika:v2' ? 'saarika:v2.5' : model;
}

async function sarvamJson<T>(url: string, key: string, options: RequestInit = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      'api-subscription-key': key,
      ...(options.body instanceof FormData ? {} : { 'content-type': 'application/json' }),
      ...(options.headers || {})
    }
  });
  const body = await response.json().catch(() => ({})) as T & SarvamErrorBody;
  if (!response.ok) throw new Error(body.error?.message || body.message || body.detail || `Sarvam request failed: HTTP ${response.status}`);
  return body as T;
}

function collectSpeakerTranscript(value: unknown): string {
  const data = value as {
    transcript?: string;
    text?: string;
    diarized_transcript?: { entries?: Array<{ transcript?: string; speaker_id?: string | number; start_time_seconds?: number; end_time_seconds?: number }> };
  };
  const entries = data.diarized_transcript?.entries;
  if (entries?.length) {
    return entries
      .filter((entry) => entry.transcript?.trim())
      .map((entry) => {
        const speaker = entry.speaker_id === undefined ? 'UNKNOWN' : `SPEAKER_${String(entry.speaker_id).padStart(2, '0')}`;
        const start = typeof entry.start_time_seconds === 'number' ? `[${Math.round(entry.start_time_seconds)}s] ` : '';
        return `${start}${speaker}: ${entry.transcript!.trim()}`;
      })
      .join('\n');
  }
  return (data.transcript || data.text || '').trim();
}

/**
 * The content type to store the uploaded blob as.
 *
 * Sarvam validates this and decodes according to it. A wrong value is not a rejection
 * you would notice: an mp3 stored as the wrong type came back as six noise fragments
 * with timestamps 4.7x the real duration, and the job still reported Completed. The
 * same file uploaded as audio/wav returned 152 diarized entries covering the whole
 * recording. Every value here is from the list Sarvam's own error message enumerates.
 */
function contentTypeFor(file: string) {
  const extension = file.split('.').pop()?.toLowerCase() ?? '';
  const types: Record<string, string> = {
    wav: 'audio/wav', wave: 'audio/wav', mp3: 'audio/mpeg', m4a: 'audio/x-m4a',
    mp4: 'audio/mp4', aac: 'audio/aac', aiff: 'audio/aiff', aif: 'audio/aiff',
    ogg: 'audio/ogg', opus: 'audio/opus', flac: 'audio/flac', amr: 'audio/amr',
    wma: 'audio/x-ms-wma', webm: 'audio/webm', pcm: 'audio/pcm_s16le', raw: 'audio/pcm_s16le'
  };
  // Accepted by Sarvam, and the honest answer when the format is unknown.
  return types[extension] ?? 'application/octet-stream';
}

async function uploadToSignedUrl(url: string, file: string, metadata?: Record<string, unknown> | null) {
  const bytes = await readFile(file);
  const headers: Record<string, string> = { 'content-type': contentTypeFor(file) };

  // Azure's Put Blob is mandatory-header: without x-ms-blob-type it answers 400, which
  // is why every long meeting died on "Sarvam signed upload failed: HTTP 400". Sarvam's
  // own examples use the Azure SDK, which sets it for you, so their docs never mention
  // it — a raw fetch has to send it itself.
  if (/\.blob\.core\.windows\.net/i.test(url)) headers['x-ms-blob-type'] = 'BlockBlob';

  for (const [key, value] of Object.entries(metadata || {})) {
    if (typeof value === 'string') headers[key] = value;
  }

  const response = await fetch(url, { method: 'PUT', headers, body: bytes });
  if (!response.ok) {
    // Azure explains the refusal in the body; the status alone was undiagnosable.
    const body = await response.text().catch(() => '');
    const detail = body.match(/<Message>([^<\n]+)/)?.[1]?.trim();
    throw new Error(`Sarvam signed upload failed: HTTP ${response.status}${detail ? ` — ${detail}` : ''}`);
  }
}

async function downloadJson(url: string) {
  const response = await fetch(url);
  const text = await response.text();
  if (!response.ok) throw new Error(`Sarvam signed download failed: HTTP ${response.status}`);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error('Sarvam downloaded transcript was not JSON.');
  }
}

async function transcribeSarvamBatch(file: string, key: string, model: string) {
  const name = basename(file).match(/\.(wav|mp3|flac|m4a|ogg|opus|webm|mp4|mpeg|mpga|aac)$/i) ? basename(file) : `${basename(file)}.wav`;
  console.warn('Using Sarvam Batch API with diarization for long meeting audio...');

  const init = await sarvamJson<{ job_id: string }>('https://api.sarvam.ai/speech-to-text/job/v1', key, {
    method: 'POST',
    body: JSON.stringify({
      model: 'saaras:v3',
      mode: 'transcribe',
      language_code: 'unknown',
      with_timestamps: true,
      with_diarization: true,
      job_parameters: {
        model: 'saaras:v3',
        mode: 'transcribe',
        language_code: 'unknown',
        with_timestamps: true,
        with_diarization: true
      }
    })
  });
  if (!init.job_id) throw new Error('Sarvam Batch did not return a job_id.');

  const upload = await sarvamJson<{ upload_urls: Record<string, { file_url: string; file_metadata?: Record<string, unknown> | null }> }>('https://api.sarvam.ai/speech-to-text/job/v1/upload-files', key, {
    method: 'POST',
    body: JSON.stringify({ job_id: init.job_id, files: [name] })
  });
  const uploadDetails = upload.upload_urls?.[name] || Object.values(upload.upload_urls || {})[0];
  if (!uploadDetails?.file_url) throw new Error('Sarvam Batch did not return an upload URL.');
  await uploadToSignedUrl(uploadDetails.file_url, file, uploadDetails.file_metadata);

  await sarvamJson<SarvamJobStatus>(`https://api.sarvam.ai/speech-to-text/job/v1/${init.job_id}/start`, key, { method: 'POST', body: '{}' });

  let status: SarvamJobStatus | undefined;
  for (let attempt = 0; attempt < 360; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    status = await sarvamJson<SarvamJobStatus>(`https://api.sarvam.ai/speech-to-text/job/v1/${init.job_id}/status`, key);
    console.warn(`Sarvam Batch status: ${status.job_state || 'unknown'}`);
    if (status.job_state === 'Completed' || status.job_state === 'PartiallyCompleted') break;
    if (status.job_state === 'Failed') throw new Error(status.error_message || 'Sarvam Batch job failed.');
  }
  if (!status || (status.job_state !== 'Completed' && status.job_state !== 'PartiallyCompleted')) {
    throw new Error('Sarvam Batch job timed out.');
  }

  const outputFiles = (status.job_details || [])
    .flatMap((detail) => detail.outputs || [])
    .map((output) => output.file_name)
    .filter((fileName): fileName is string => Boolean(fileName));
  if (!outputFiles.length) throw new Error(status.error_message || 'Sarvam Batch completed without output files.');

  const downloads = await sarvamJson<{ download_urls: Record<string, { file_url: string }> }>('https://api.sarvam.ai/speech-to-text/job/v1/download-files', key, {
    method: 'POST',
    body: JSON.stringify({ job_id: init.job_id, files: outputFiles })
  });
  const transcripts: string[] = [];
  for (const fileName of outputFiles) {
    const details = downloads.download_urls?.[fileName] || Object.values(downloads.download_urls || {})[0];
    if (!details?.file_url) continue;
    const json = await downloadJson(details.file_url);
    const transcript = collectSpeakerTranscript(json);
    if (transcript) transcripts.push(transcript);
  }
  const combined = transcripts.join('\n').trim();
  if (!combined) throw new Error('Sarvam Batch returned an empty transcript.');
  return combined;
}

async function transcribeSarvamAuto(file: string, key: string, model: string) {
  const duration = audioDurationSeconds(file);
  if (!duration || duration <= 29) return transcribeSarvam(file, key, model);

  // Long audio goes to Batch and stays there. Falling back to 28 second REST chunks
  // produced a transcript with no speaker labels and a context break every 28 seconds,
  // while reporting success — so the reason Batch failed was never seen.
  try {
    return await transcribeSarvamBatch(file, key, model);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Sarvam Batch failed, and chunked transcription would lose speaker labels, so it was not attempted.\nReason: ${message}`);
  }
}

async function transcribeSarvam(file: string, key: string, model: string) {
  const { audioFile } = await audioForm(file);
  const form = new FormData();
  form.set('file', audioFile);
  const modelName = sarvamModel(model);
  form.set('model', modelName);
  if (modelName === 'saaras:v3') form.set('mode', 'transcribe');
  form.set('language_code', 'unknown');

  const response = await fetch('https://api.sarvam.ai/speech-to-text', {
    method: 'POST',
    headers: { 'api-subscription-key': key },
    body: form
  });
  const body = await response.json().catch(() => ({})) as { transcript?: string; text?: string; error?: { message?: string }; message?: string; detail?: string };
  if (!response.ok) throw new Error(body.error?.message || body.message || body.detail || `Sarvam transcription failed: HTTP ${response.status}`);
  return (body.transcript || body.text || '').trim();
}
