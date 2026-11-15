import 'server-only';
import { serverEnv } from '@/lib/env';
import { logger } from '@/lib/logger';
import { PipelineError } from '@/ai/core/types';
import type { ChatMessage } from '@/ai/core/prompts/scoring.v1';

export interface LlmReply { content: string; model: string; inputTokens: number; cachedInputTokens: number; outputTokens: number }
export interface LlmProvider { readonly name: 'deepseek' | 'mock'; readonly model: string; complete(messages: ChatMessage[]): Promise<LlmReply> }

/** DeepSeek (OpenAI-compatible chat completions, chế độ JSON). */
class DeepSeekLlm implements LlmProvider {
  readonly name = 'deepseek' as const;
  constructor(private key: string, private baseUrl: string, readonly model: string) {}
  async complete(messages: ChatMessage[]): Promise<LlmReply> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST', headers: { Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.model, messages, response_format: { type: 'json_object' }, temperature: 0.3, max_tokens: 2500 }),
        signal: AbortSignal.timeout(120_000),
      });
    } catch (e) { throw new PipelineError('SCORING_FAILED', true, `network/timeout: ${String(e)}`); }
    if (res.status === 429 || res.status >= 500) throw new PipelineError('SCORING_FAILED', true, `DeepSeek ${res.status}`);
    if (!res.ok) throw new PipelineError('SCORING_FAILED', false, `DeepSeek ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const j = await res.json() as { model: string; choices: { message: { content: string }; finish_reason: string }[]; usage?: { prompt_tokens: number; completion_tokens: number; prompt_cache_hit_tokens?: number } };
    const choice = j.choices?.[0];
    if (!choice?.message?.content) throw new PipelineError('SCORING_INVALID', true, `empty reply (${choice?.finish_reason})`);
    return { content: choice.message.content, model: j.model ?? this.model, inputTokens: j.usage?.prompt_tokens ?? 0, cachedInputTokens: j.usage?.prompt_cache_hit_tokens ?? 0, outputTokens: j.usage?.completion_tokens ?? 0 };
  }
}

/** Mock: pipeline gọi thẳng mockSpeechScoring/mockScriptScoring, nên complete() không được dùng. */
class MockLlm implements LlmProvider {
  readonly name = 'mock' as const; readonly model = 'mock-llm';
  async complete(): Promise<LlmReply> { throw new Error('MockLlm.complete không được gọi trực tiếp'); }
}

let llm: LlmProvider | null = null;
export function llmProvider(): LlmProvider {
  if (llm) return llm;
  const env = serverEnv(), want = env.LLM_PROVIDER ?? (env.DEEPSEEK_API_KEY ? 'deepseek' : 'mock');
  llm = want === 'deepseek' && env.DEEPSEEK_API_KEY ? new DeepSeekLlm(env.DEEPSEEK_API_KEY, env.DEEPSEEK_BASE_URL, env.DEEPSEEK_MODEL) : new MockLlm();
  if (want === 'deepseek' && !env.DEEPSEEK_API_KEY) logger.warn('LLM_PROVIDER=deepseek nhưng thiếu DEEPSEEK_API_KEY → dùng mock');
  return llm;
}
