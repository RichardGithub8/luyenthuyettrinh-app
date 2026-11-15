import 'server-only';
import { serverEnv } from '@/lib/env';
import { logger } from '@/lib/logger';
import { PipelineError, type Lang, type Transcript, type Goal } from '@/ai/core/types';
import { mockTranscript } from '@/ai/core/mock';

export interface SttRequest { audio: Blob; filename: string; language: Lang; prompt: string; hint: { goal: Goal; durationSec: number; placement: boolean } }
export interface SttProvider { readonly name: string; readonly model: string; transcribe(r: SttRequest): Promise<Transcript> }

/** Groq Whisper (OpenAI-compatible): https://console.groq.com/docs/speech-to-text. Giới hạn ~25 MB mỗi file. */
class GroqStt implements SttProvider {
  readonly name = 'groq';
  constructor(private key: string, readonly model: string) {}
  async transcribe(r: SttRequest): Promise<Transcript> {
    const fd = new FormData();
    fd.append('file', r.audio, r.filename);
    fd.append('model', this.model);
    fd.append('response_format', 'verbose_json');
    fd.append('timestamp_granularities[]', 'word');
    fd.append('timestamp_granularities[]', 'segment');
    fd.append('language', r.language);
    fd.append('temperature', '0');
    fd.append('prompt', r.prompt);
    let res: Response;
    try {
      res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${this.key}` }, body: fd, signal: AbortSignal.timeout(180_000) });
    } catch (e) { throw new PipelineError('STT_FAILED', true, `network/timeout: ${String(e)}`); }
    if (res.status === 429) throw new PipelineError('STT_RATE_LIMITED', true, `Groq 429, retry-after ${res.headers.get('retry-after')}`);
    if (res.status >= 500) throw new PipelineError('STT_FAILED', true, `Groq ${res.status}`);
    if (!res.ok) throw new PipelineError('AUDIO_UNREADABLE', false, `Groq ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const j = await res.json() as { text: string; duration: number; language: string; segments?: { start: number; end: number; text: string }[]; words?: { word: string; start: number; end: number }[] };
    return {
      text: j.text ?? '', durationSec: Number(j.duration ?? 0), language: j.language ?? r.language,
      segments: (j.segments ?? []).map((s) => ({ start: s.start, end: s.end, text: s.text.trim() })).filter((s) => s.text),
      words: (j.words ?? []).map((w) => ({ word: w.word.trim(), start: w.start, end: w.end })).filter((w) => w.word),
    };
  }
}

class MockStt implements SttProvider {
  readonly name = 'mock'; readonly model = 'mock-stt';
  async transcribe(r: SttRequest) { return mockTranscript(r.hint.goal, r.language, r.hint.durationSec, r.hint.placement); }
}

let stt: SttProvider | null = null;
export function sttProvider(): SttProvider {
  if (stt) return stt;
  const env = serverEnv(), want = env.STT_PROVIDER ?? (env.GROQ_API_KEY ? 'groq' : 'mock');
  stt = want === 'groq' && env.GROQ_API_KEY ? new GroqStt(env.GROQ_API_KEY, env.GROQ_STT_MODEL) : new MockStt();
  if (want === 'groq' && !env.GROQ_API_KEY) logger.warn('STT_PROVIDER=groq nhưng thiếu GROQ_API_KEY → dùng mock');
  return stt;
}
