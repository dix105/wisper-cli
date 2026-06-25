import type { Provider } from './config.js';

export type VerifyResult = {
  ok: boolean;
  message: string;
};

export async function verifyProviderKey(provider: Provider, key: string): Promise<VerifyResult> {
  if (!key.trim()) return { ok: false, message: 'No key entered, skipped verification.' };

  try {
    if (provider === 'groq') {
      const response = await fetch('https://api.groq.com/openai/v1/models', {
        headers: { authorization: `Bearer ${key}` }
      });
      return response.ok
        ? { ok: true, message: 'Groq key verified.' }
        : { ok: false, message: `Groq verification failed: HTTP ${response.status}` };
    }

    if (provider === 'elevenlabs') {
      const response = await fetch('https://api.elevenlabs.io/v1/user', {
        headers: { 'xi-api-key': key }
      });
      return response.ok
        ? { ok: true, message: 'ElevenLabs key verified.' }
        : { ok: false, message: `ElevenLabs verification failed: HTTP ${response.status}` };
    }

    if (provider === 'sarvam') {
      const response = await fetch('https://api.sarvam.ai/models', {
        headers: { 'api-subscription-key': key }
      });
      return response.ok
        ? { ok: true, message: 'Sarvam key verified.' }
        : { ok: false, message: `Sarvam verification failed: HTTP ${response.status}` };
    }
  } catch (error) {
    return { ok: false, message: `Verification error: ${error instanceof Error ? error.message : String(error)}` };
  }

  return { ok: false, message: `Verification not implemented for ${provider}.` };
}
