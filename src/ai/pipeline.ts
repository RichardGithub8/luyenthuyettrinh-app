import 'server-only';
import type { Db } from '@/repositories/types';
import type { Json } from '@/types/database';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { PLANS } from '@/config/plans';
import { sttCost, llmCost } from '@/config/ai-pricing';
import { PipelineError, type Goal, type Lang, type Persona } from '@/ai/core/types';
import { STT_PROMPT } from '@/ai/core/lexicon';
import { speechMetrics, scriptStats } from '@/ai/core/metrics';
import { BodyMetricsSchema, type BodyMetrics } from '@/ai/core/body';
import { GOAL_TARGET_MIN } from '@/ai/core/rubric';
import { SpeechScoringSchema, ScriptScoringSchema, groundIssues } from '@/ai/core/schema';
import { buildSpeechMessages, buildScriptMessages, PROMPT_VERSION } from '@/ai/core/prompts/scoring.v1';
import { buildSpeechReport, buildScriptReport } from '@/ai/core/report';
import { mockSpeechScoring, mockScriptScoring } from '@/ai/core/mock';
import { sttProvider } from '@/ai/providers/stt';
import { llmProvider } from '@/ai/providers/llm';
import { prepareAudio, cleanupTemp } from '@/ai/providers/audio';
import { scoreWithRepair } from '@/ai/scoring';
import { jobEvents } from '@/ai/events';
import { isPremium } from '@/services/profile.service';

const MIN_WORDS = 10;
const GOAL_NAME: Record<Goal, string> = { presentation: 'presentation', reporting: 'progress report', interview: 'job interview', pitching: 'investor pitch', debating: 'debate' };
const pick = (j: Json | null | undefined, lang: Lang) => { const o = (j ?? {}) as Record<string, string>; return o[lang] ?? o.vi ?? ''; };

type Outcome = { status: 'completed'; overall: number } | { status: 'skipped'; reason: string } | { status: 'blocked'; reason: 'over_free_duration' };

/**
 * Phân tích một buổi luyện. Dùng chung cho Trigger.dev task và hàng đợi inline.
 * An toàn khi chạy lại (retry): trạng thái được kiểm tra đầu job, tệp âm thanh đã tách được cache.
 * Lỗi tạm thời (mạng, 429, 5xx, JSON sai) → ném PipelineError(retryable=true) để Trigger.dev thử lại.
 * Lỗi vĩnh viễn (không có giọng nói, tệp hỏng) → retryable=false, dừng ngay.
 */
export async function runAnalysis(sessionId: string, opts: { runId?: string; attempt?: number } = {}, db: Db = supabaseAdmin()): Promise<Outcome> {
  const ev = jobEvents(db, sessionId, opts.runId);
  const { data: s } = await db.from('practice_sessions').select('*').eq('id', sessionId).maybeSingle();
  if (!s) return { status: 'skipped', reason: 'not_found' };
  if (!['queued', 'processing'].includes(s.status)) return { status: 'skipped', reason: `status_${s.status}` };

  const now = new Date().toISOString();
  await db.from('practice_sessions').update({ status: 'processing', started_at: s.started_at ?? now }).eq('id', s.id).in('status', ['queued', 'processing']);
  await db.from('analysis_results').upsert({ session_id: s.id, user_id: s.user_id, status: 'transcribing', trigger_run_id: opts.runId ?? null, started_at: now, error_code: null, error_message: null }, { onConflict: 'session_id' });
  await ev.info('start', `attempt ${opts.attempt ?? 1}`, { stt: sttProvider().name, llm: llmProvider().name });

  const [{ data: item }, { data: profile }, { data: course }] = await Promise.all([
    db.from('library_items').select('*').eq('id', s.library_item_id).single(),
    db.from('profiles').select('*').eq('id', s.user_id).single(),
    db.from('courses').select('ai_persona').eq('goal', s.goal).maybeSingle(),
  ]);
  if (!item || !profile) throw new PipelineError('MEDIA_MISSING', false, 'library item or profile missing');
  const lesson = s.lesson_id ? (await db.from('lessons').select('task,pass_score').eq('id', s.lesson_id).maybeSingle()).data : null;
  const uiLang = profile.ui_language as Lang, lang = s.speaking_language as Lang, goal = s.goal as Goal;
  const p = (course?.ai_persona ?? {}) as { name?: string; role?: Json; focus?: Json; questions?: Json[] };
  const persona: Persona = { name: p.name ?? 'Coach', role: pick(p.role ?? null, 'en') || 'speaking coach', focus: pick(p.focus ?? null, 'en') || 'clarity', questions: (p.questions ?? []).map((q) => pick(q, uiLang)) };
  const lessonTask = lesson ? pick(lesson.task, lang) : null;
  const llm = llmProvider();
  let report: { overall: number; criteria: Record<string, number | null>; feedback: unknown; speechMetrics?: unknown; bodyMetrics?: unknown; transcript?: unknown };
  let usage = { input: 0, cachedInput: 0, output: 0 }, llmModel = llm.model, sttModel: string | null = null, sttSec = 0;

  if (item.kind === 'script') {
    const text = item.script_text ?? '';
    const stats = scriptStats(text, GOAL_TARGET_MIN[goal]);
    await setStatus(db, s.id, 'scoring');
    const scored = llm.name === 'mock'
      ? { data: mockScriptScoring({ text, title: s.title, uiLang, persona, target: GOAL_TARGET_MIN[goal] }), usage, model: llm.model }
      : await scoreWithRepair(llm, buildScriptMessages({ goalName: GOAL_NAME[goal], persona, title: s.title, lessonTask, uiLang, speechLang: lang, text, stats, targetMin: GOAL_TARGET_MIN[goal] }), ScriptScoringSchema);
    usage = scored.usage; llmModel = scored.model;
    const segments = text.split(/\n\s*\n/).map((t, i) => ({ start: i, end: i + 1, text: t.trim() }));
    report = buildScriptReport({ uiLang, stats, llm: groundIssues(scored.data, text, segments) });
  } else {
    // 1. Âm thanh → STT
    const audio = await prepareAudio(db, { userId: s.user_id, sessionId: s.id, storagePath: item.storage_path!, kind: item.kind, sizeBytes: item.size_bytes });
    const stt = sttProvider(); sttModel = stt.model;
    const transcript = await stt.transcribe({ audio: audio.blob, filename: audio.filename, language: lang, prompt: STT_PROMPT[lang], hint: { goal, durationSec: Number(item.duration_sec ?? 60), placement: s.is_placement } });
    sttSec = transcript.durationSec;
    await ev.info('stt', 'done', { durationSec: transcript.durationSec, words: transcript.words.length, segments: transcript.segments.length, transcoded: audio.transcoded });

    // 2. Chống sửa thời lượng: đo lại bằng STT, áp lại quy tắc > 5 phút của gói Miễn phí.
    const limits = PLANS[isPremium(profile) ? 'premium' : 'free'];
    if (!s.is_placement && transcript.durationSec > limits.maxAnalyzeSec + 5) {
      await db.from('library_items').update({ duration_sec: transcript.durationSec }).eq('id', item.id);
      const { data: blocked } = await db.from('practice_sessions').update({ status: 'pending_premium', blocked_reason: 'over_free_duration', credit_reserved: false })
        .eq('id', s.id).eq('status', 'processing').select('credit_reserved').maybeSingle();
      if (blocked && s.credit_reserved) await db.rpc('refund_analysis_credit', { p_user: s.user_id });
      await db.from('analysis_results').delete().eq('session_id', s.id);
      await cleanupTemp(db, s.user_id, s.id);
      await ev.warn('duration', 'actual duration exceeds plan limit, moved to pending_premium', { reported: item.duration_sec, actual: transcript.durationSec });
      return { status: 'blocked', reason: 'over_free_duration' };
    }
    if (transcript.words.length + transcript.segments.length === 0 || transcript.text.trim().split(/\s+/).length < MIN_WORDS) {
      throw new PipelineError('NO_SPEECH', false, `only ${transcript.text.trim().split(/\s+/).filter(Boolean).length} words detected`);
    }
    await db.from('library_items').update({ duration_sec: transcript.durationSec }).eq('id', item.id);

    // 3. Chỉ số đo bằng code + ngôn ngữ cơ thể từ MediaPipe (trình duyệt gửi lên trước).
    const metrics = speechMetrics(transcript, lang);
    let body: BodyMetrics | null = null;
    if (item.kind === 'video') {
      await setStatus(db, s.id, 'analyzing_body');
      const parsed = BodyMetricsSchema.safeParse(s.client_body_metrics);
      body = parsed.success ? parsed.data : null;
      await ev.info('body', body ? 'client metrics used' : 'no body metrics received', body ? { eye: body.eyeContactRatio } : undefined);
    }

    // 4. LLM chấm nội dung, cấu trúc, mức bám chủ đề + viết phản hồi.
    await setStatus(db, s.id, 'scoring');
    const scored = llm.name === 'mock'
      ? { data: mockSpeechScoring({ transcript, title: s.title, uiLang, persona }), usage, model: llm.model }
      : await scoreWithRepair(llm, buildSpeechMessages({ goalName: GOAL_NAME[goal], persona, title: s.title, lessonTask, uiLang, speechLang: lang, segments: transcript.segments, metrics, body }), SpeechScoringSchema);
    usage = scored.usage; llmModel = scored.model;
    report = buildSpeechReport({ goal, uiLang, transcript, metrics, body, llm: groundIssues(scored.data, transcript.text, transcript.segments) });
  }

  // 5. Lưu kết quả, hoàn tất buổi luyện, cập nhật tiến độ bài học, xóa tệp tạm.
  const cost = (sttModel ? sttCost(sttModel, sttSec) : 0) + llmCost(llmModel, usage);
  const finished = new Date().toISOString();
  const { error: saveErr } = await db.from('analysis_results').update({
    status: 'completed', overall_score: report.overall, criteria_scores: report.criteria as Json, feedback: report.feedback as Json,
    speech_metrics: (report.speechMetrics ?? null) as Json, body_metrics: (report.bodyMetrics ?? null) as Json, transcript: (report.transcript ?? null) as Json,
    stt_model: sttModel, llm_model: llmModel, prompt_version: PROMPT_VERSION, input_tokens: usage.input, output_tokens: usage.output,
    cost_usd: Math.round(cost * 1e6) / 1e6, finished_at: finished,
  }).eq('session_id', s.id);
  if (saveErr) throw new PipelineError('SAVE_FAILED', true, saveErr.message);
  await db.from('practice_sessions').update({ status: 'completed', completed_at: finished, credit_reserved: false }).eq('id', s.id).eq('status', 'processing');
  if (s.lesson_id) await updateLessonProgress(db, s.user_id, s.lesson_id, report.overall, lesson?.pass_score ?? 60);
  await cleanupTemp(db, s.user_id, s.id).catch(() => undefined);
  await ev.info('done', `overall ${report.overall}`, { costUsd: cost, inputTokens: usage.input, outputTokens: usage.output });
  return { status: 'completed', overall: report.overall };
}

async function setStatus(db: Db, sessionId: string, status: 'transcribing' | 'analyzing_body' | 'scoring') {
  await db.from('analysis_results').update({ status }).eq('session_id', sessionId);
}

async function updateLessonProgress(db: Db, userId: string, lessonId: string, score: number, pass: number) {
  const { data: cur } = await db.from('user_lesson_progress').select('*').eq('user_id', userId).eq('lesson_id', lessonId).maybeSingle();
  const best = Math.max(cur?.best_score ?? 0, score), done = best >= pass;
  await db.from('user_lesson_progress').upsert({
    user_id: userId, lesson_id: lessonId, attempts: (cur?.attempts ?? 0) + 1, best_score: best,
    status: done ? 'completed' : 'in_progress', completed_at: done ? (cur?.completed_at ?? new Date().toISOString()) : null,
  }, { onConflict: 'user_id,lesson_id' });
}
