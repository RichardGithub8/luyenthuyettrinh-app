import 'server-only';
import type { z } from 'zod';
import { PipelineError } from '@/ai/core/types';
import { parseLlmJson } from '@/ai/core/schema';
import { repairMessage, type ChatMessage } from '@/ai/core/prompts/scoring.v1';
import type { LlmProvider } from '@/ai/providers/llm';

/**
 * Gọi LLM và kiểm tra JSON. Sai định dạng → gửi lại một lần kèm lỗi để mô hình tự sửa (rẻ hơn chạy lại cả job).
 * Vẫn sai → ném lỗi có thể thử lại (Trigger.dev retry cả bước).
 */
export async function scoreWithRepair<S extends z.ZodType>(llm: LlmProvider, messages: ChatMessage[], schema: S) {
  const usage = { input: 0, cachedInput: 0, output: 0 };
  let convo = messages, model = llm.model;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const r = await llm.complete(convo);
    usage.input += r.inputTokens; usage.cachedInput += r.cachedInputTokens; usage.output += r.outputTokens; model = r.model;
    try { return { data: parseLlmJson(r.content, schema), usage, model, repaired: attempt > 1 }; }
    catch (e) {
      if (!(e instanceof PipelineError) || attempt === 2) throw e;
      convo = [...messages, { role: 'assistant', content: r.content }, repairMessage(e.message)];
    }
  }
  throw new PipelineError('SCORING_INVALID', true);
}
