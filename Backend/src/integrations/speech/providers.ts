import { env } from '../../config/env.js';
import { AppError, requireCondition } from '../../errors/app-error.js';
import { boundedBytes } from '../assessment-interview/provider.js';
export function validateWav(buffer: Buffer) {
  requireCondition(
    buffer.length >= 44 &&
      buffer.toString('ascii', 0, 4) === 'RIFF' &&
      buffer.toString('ascii', 8, 12) === 'WAVE',
    415,
    'AUDIO_FORMAT_UNSUPPORTED',
    'Upload a PCM WAV audio file',
  );
  let byteRate = 0,
    dataLength = 0,
    fmt = false;
  for (let offset = 12; offset + 8 <= buffer.length;) {
    const size = buffer.readUInt32LE(offset + 4),
      next = offset + 8 + size;
    requireCondition(
      next <= buffer.length,
      415,
      'AUDIO_INVALID',
      'Audio contains a truncated WAV chunk',
    );
    const type = buffer.toString('ascii', offset, offset + 4);
    if (type === 'fmt ') {
      requireCondition(
        size >= 16 && buffer.readUInt16LE(offset + 8) === 1,
        415,
        'AUDIO_FORMAT_UNSUPPORTED',
        'Use uncompressed PCM WAV audio',
      );
      const channels = buffer.readUInt16LE(offset + 10),
        sampleRate = buffer.readUInt32LE(offset + 12),
        bits = buffer.readUInt16LE(offset + 22);
      byteRate = buffer.readUInt32LE(offset + 16);
      requireCondition(
        channels >= 1 &&
          channels <= 2 &&
          sampleRate >= 8000 &&
          sampleRate <= 48000 &&
          bits === 16 &&
          byteRate === sampleRate * channels * 2,
        415,
        'AUDIO_INVALID',
        'Use 16-bit PCM WAV at 8–48 kHz with one or two channels',
      );
      fmt = true;
    }
    if (type === 'data') dataLength += size;
    offset = next + (size % 2);
  }
  requireCondition(
    fmt && byteRate > 0 && dataLength > 0,
    415,
    'AUDIO_INVALID',
    'The WAV file contains no valid audio',
  );
  const durationMs = Math.ceil((dataLength / byteRate) * 1000);
  requireCondition(
    durationMs <= env.MAX_AUDIO_SECONDS * 1000,
    413,
    'AUDIO_TOO_LONG',
    `Audio must not exceed ${env.MAX_AUDIO_SECONDS} seconds`,
  );
  return durationMs;
}
export const speechProviders = {
  configuration() {
    return {
      stt: env.STT_PROVIDER,
      tts: env.TTS_PROVIDER,
      language: env.STT_LANGUAGE,
      maxAudioBytes: env.MAX_AUDIO_MB * 1024 * 1024,
      maxAudioSeconds: env.MAX_AUDIO_SECONDS,
      formats: ['audio/wav'],
      rawAudioRetained: false,
      videoTransmitted: false,
    };
  },
  async transcribe(buffer: Buffer, language: string) {
    requireCondition(
      env.STT_PROVIDER === 'compatible' && env.STT_BASE_URL && env.STT_MODEL,
      503,
      'STT_UNAVAILABLE',
      'Server transcription is unavailable; use browser transcription or type your response',
    );
    try {
      const form = new FormData();
      form.set('file', new Blob([new Uint8Array(buffer)], { type: 'audio/wav' }), 'response.wav');
      form.set('model', env.STT_MODEL);
      form.set('language', language);
      const response = await fetch(`${env.STT_BASE_URL.replace(/\/$/, '')}/audio/transcriptions`, {
        method: 'POST',
        signal: AbortSignal.timeout(60000),
        headers: env.STT_API_KEY ? { Authorization: `Bearer ${env.STT_API_KEY}` } : {},
        body: form,
      });
      requireCondition(
        response.ok,
        503,
        'STT_UNAVAILABLE',
        'Transcription failed; retry or type your response',
      );
      const body = JSON.parse((await boundedBytes(response, 100000)).toString()) as {
        text?: string;
      };
      requireCondition(
        typeof body.text === 'string' && body.text.trim().length > 0 && body.text.length <= 12000,
        503,
        'STT_RESPONSE_INVALID',
        'Transcription returned no usable text',
      );
      return body.text.trim();
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        503,
        'STT_UNAVAILABLE',
        'Transcription failed; retry or type your response',
      );
    }
  },
  async synthesize(text: string) {
    requireCondition(
      env.TTS_PROVIDER === 'compatible' && env.TTS_BASE_URL && env.TTS_MODEL,
      503,
      'TTS_UNAVAILABLE',
      'Server speech is unavailable; read the displayed text or use browser speech',
    );
    try {
      const response = await fetch(`${env.TTS_BASE_URL.replace(/\/$/, '')}/audio/speech`, {
        method: 'POST',
        signal: AbortSignal.timeout(60000),
        headers: {
          'Content-Type': 'application/json',
          ...(env.TTS_API_KEY ? { Authorization: `Bearer ${env.TTS_API_KEY}` } : {}),
        },
        body: JSON.stringify({
          model: env.TTS_MODEL,
          voice: env.TTS_VOICE,
          input: text,
          response_format: 'wav',
        }),
      });
      requireCondition(
        response.ok,
        503,
        'TTS_UNAVAILABLE',
        'Speech playback is unavailable; continue using the displayed text',
      );
      return await boundedBytes(response, 8 * 1024 * 1024);
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        503,
        'TTS_UNAVAILABLE',
        'Speech playback failed; continue using the displayed text',
      );
    }
  },
};
