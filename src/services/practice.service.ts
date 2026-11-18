import 'server-only';
import type { Db } from '@/repositories/types';
import type { GoalType, LangCode, LibraryItemRow, PracticeSessionRow, SubmissionKind } from '@/types/database';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { serverEnv } from '@/lib/env';
import { MAX_RECORD_SEC } from '@/config/plans';
import { BUCKETS, MAX_UPLOAD_BYTES, MEDIA_TYPES, SIGNED_UPLOAD_TTL_SEC, baseMime, fileNameOf, mediaPath } from '@/lib/storage';
import { decideAnalysis, canRequestAnalysis, PLACEMENT_MAX_SEC, wordCount } from '@/domain/session.policy';
import { libraryRepository } from '@/repositories/library.repository';
import { sessionRepository } from '@/repositories/session.repository';
import { contentRepository } from '@/repositories/content.repository';
import { profileService, type Me } from '@/services/profile.service';
import { analysisQueue } from '@/jobs/queue';
import type { BodyMetrics } from '@/ai/core/body';
import type { Json } from '@/types/database';

const log = logger.child({ module: 'practice' });
const MIN_SCRIPT_WORDS = 40;
const GOAL_NAME: Record<GoalType, { vi: string; en: string }> = {
  presentation: { vi: 'Thuyết trình', en: 'Presentation' }, reporting: { vi: 'Báo cáo', en: 'Reporting' },
  interview: { vi: 'Phỏng vấn', en: 'Interview' }, pitching: { vi: 'Gọi vốn', en: 'Pitching' }, debating: { vi: 'Tranh biện', en: 'Debating' },
};

export interface PracticeContextInput {
  goal?: GoalType;                 // đổi nhanh cho buổi này; bỏ trống = mục tiêu mặc định
  speakingLanguage?: LangCode;     // bỏ trống = ngôn ngữ bài nói mặc định
  promptId?: string;
  customTitle?: string;
  lessonSlug?: string;
  isPlacement?: boolean;
}

/** Xác định mục tiêu, ngôn ngữ, đề bài, bài học và tiêu đề cho một buổi luyện. */
/** Gói Miễn phí chỉ mở 2 loại hình (thuyết trình, báo cáo); bài test đầu vào không bị giới hạn. */
function assertGoalAllowed(me: Me, goal: GoalType, isPlacement: boolean) {
  if (!isPlacement && !me.limits.goals.includes(goal)) throw new AppError('PLAN_REQUIRED', { feature: 'goal', goal });
}

async function resolveContext(db: Db, me: Me, i: PracticeContextInput) {
  const lang = i.speakingLanguage ?? me.speakingLanguage;
  if (i.isPlacement) {
    if (await sessionRepository.placementTaken(db, me.id)) throw new AppError('PLACEMENT_DONE');
    return { goal: me.defaultGoal, lang, lessonId: null, promptId: null, title: lang === 'en' ? 'Self-introduction (placement test)' : 'Giới thiệu bản thân (bài test đầu vào)' };
  }
  if (i.lessonSlug) {
    const lesson = await contentRepository.lessonBySlug(db, i.lessonSlug);
    if (!lesson) throw new AppError('NOT_FOUND', { resource: 'lesson' });
    const title = (lesson.title as Record<string, string>)[me.uiLanguage] ?? (lesson.title as Record<string, string>).vi ?? 'Lesson';
    return { goal: lesson.goal, lang, lessonId: lesson.id, promptId: null, title };
  }
  const goal = i.goal ?? me.defaultGoal;
  if (i.promptId) {
    const prompt = await contentRepository.promptById(db, i.promptId);
    if (!prompt || prompt.goal !== goal) throw new AppError('VALIDATION_FAILED', { fields: { promptId: ['PROMPT_GOAL_MISMATCH'] } });
    const text = prompt.text as Record<string, string>;
    return { goal, lang, lessonId: null, promptId: prompt.id, title: i.customTitle?.trim() || text[lang] || text.vi || 'Practice' };
  }
  return { goal, lang, lessonId: null, promptId: null, title: i.customTitle?.trim() || `${GOAL_NAME[goal][me.uiLanguage]} ${new Date().toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}` };
}

/** Dữ liệu buổi luyện trả về cho client. */
export function sessionView(s: PracticeSessionRow, item: LibraryItemRow) {
  const nextAction =
    s.status === 'uploading' ? 'upload'
    : s.status === 'pending_premium' ? 'upgrade'
    : s.status === 'pending_quota' ? 'upgrade_or_wait'
    : s.status === 'failed' ? 'retry'
    : s.status === 'queued' || s.status === 'processing' ? 'wait'
    : s.status === 'completed' ? 'view_report' : 'none';
  return {
    id: s.id, status: s.status, blockedReason: s.blocked_reason, nextAction,
    title: s.title, goal: s.goal, speakingLanguage: s.speaking_language, lessonId: s.lesson_id, isPlacement: s.is_placement,
    error: s.last_error_code ? { code: s.last_error_code, message: s.last_error_message } : null,
    createdAt: s.created_at, queuedAt: s.queued_at, completedAt: s.completed_at,
    libraryItem: { id: item.id, kind: item.kind, durationSec: item.duration_sec, sizeBytes: item.size_bytes, wordCount: item.word_count, mediaExpiresAt: item.media_expires_at, mediaDeletedAt: item.media_deleted_at },
  };
}

/**
 * Áp quy tắc rồi đưa vào hàng đợi. Lượt phân tích được GIỮ CHỖ nguyên tử trước khi enqueue
 * (Phase 3 sẽ hoàn lượt nếu AI lỗi). Mọi trường hợp đều trả về buổi luyện đã cập nhật.
 */
async function decideAndEnqueue(db: Db, me: Me, s: PracticeSessionRow, item: LibraryItemRow): Promise<PracticeSessionRow> {
  const from = ['uploaded', 'pending_premium', 'pending_quota', 'failed'] as const;
  const decision = decideAnalysis({
    kind: item.kind, durationSec: item.duration_sec, isPlacement: s.is_placement,
    maxAnalyzeSec: me.limits.maxAnalyzeSec, remainingCredits: me.usage.remaining,
  });
  if (decision.action === 'block') {
    log.info('session blocked', { sessionId: s.id, reason: decision.reason, durationSec: item.duration_sec });
    return (await sessionRepository.transition(db, me.id, s.id, from, { status: decision.status, blocked_reason: decision.reason })) ?? s;
  }
  if (!s.is_placement && !s.credit_reserved) {
    const { data: reserved, error } = await db.rpc('reserve_analysis_credit', { p_user: me.id, p_limit: me.limits.analysesPerPeriod });
    if (error) throw new AppError('INTERNAL', undefined, error);
    if (!reserved) return (await sessionRepository.transition(db, me.id, s.id, from, { status: 'pending_quota', blocked_reason: 'no_quota' })) ?? s;
  }
  const queued = await sessionRepository.transition(db, me.id, s.id, from, {
    status: 'queued', blocked_reason: null, credit_reserved: !s.is_placement, queued_at: new Date().toISOString(),
    attempt_count: s.attempt_count + 1, last_error_code: null, last_error_message: null,
  });
  if (!queued) { // request khác đã xử lý bài này trước → trả lại lượt vừa giữ
    if (!s.is_placement && !s.credit_reserved) await db.rpc('refund_analysis_credit', { p_user: me.id });
    return (await sessionRepository.findOwned(db, me.id, s.id)) ?? s;
  }
  try {
    const { runId } = await analysisQueue().enqueue(s.id, queued.attempt_count);
    log.info('session queued', { sessionId: s.id, runId, queue: analysisQueue().name });
    return queued;
  } catch (e) {
    log.error('enqueue failed', { sessionId: s.id, error: String(e) });
    if (!s.is_placement) await db.rpc('refund_analysis_credit', { p_user: me.id });
    await sessionRepository.transition(db, me.id, s.id, ['queued'], { status: 'failed', credit_reserved: false, last_error_code: 'QUEUE_UNAVAILABLE', last_error_message: String(e).slice(0, 500) });
    throw new AppError('QUEUE_UNAVAILABLE', undefined, e);
  }
}

export const practiceService = {
  /** Bước 1 (ghi âm/video/tải file): tạo buổi luyện + mục thư viện, cấp signed upload URL. */
  async createUpload(db: Db, userId: string, i: PracticeContextInput & { kind: 'audio' | 'video'; mimeType: string; sizeBytes: number; source?: 'recording' | 'upload' }) {
    const me = await profileService.getMe(db, userId);
    if (!me.onboarded && !i.isPlacement) throw new AppError('ONBOARDING_REQUIRED');
    if (i.kind === 'video' && !me.limits.video) throw new AppError('PLAN_REQUIRED', { feature: 'video' });
    // Gói Miễn phí: chỉ ghi âm trực tiếp (không tải file có sẵn). Bài test đầu vào luôn được phép.
    if (!i.isPlacement && !me.limits.upload && i.source !== 'recording') throw new AppError('PLAN_REQUIRED', { feature: 'upload' });
    const mime = baseMime(i.mimeType), media = MEDIA_TYPES[mime];
    if (!media) throw new AppError('UNSUPPORTED_FILE', { mimeType: mime });
    if (i.kind === 'video' && media.kind !== 'video') throw new AppError('UNSUPPORTED_FILE', { mimeType: mime, expected: 'video' });
    if (i.sizeBytes > MAX_UPLOAD_BYTES) throw new AppError('FILE_TOO_LARGE', { maxBytes: MAX_UPLOAD_BYTES });

    const ctx = await resolveContext(db, me, i);
    assertGoalAllowed(me, ctx.goal, !!i.isPlacement);
    const itemId = crypto.randomUUID(), path = mediaPath(userId, itemId, mime);
    const retentionDays = serverEnv().MEDIA_RETENTION_DAYS;
    const item = await libraryRepository.insert(db, {
      id: itemId, user_id: userId, kind: i.kind, title: ctx.title, storage_path: path, mime_type: mime, size_bytes: i.sizeBytes,
      media_expires_at: new Date(Date.now() + retentionDays * 86400_000).toISOString(),
    });
    const s = await sessionRepository.insert(db, {
      user_id: userId, library_item_id: itemId, lesson_id: ctx.lessonId, prompt_id: ctx.promptId, goal: ctx.goal,
      speaking_language: ctx.lang, title: ctx.title, is_placement: !!i.isPlacement, status: 'uploading',
    });
    const { data: signed, error } = await db.storage.from(BUCKETS.recordings).createSignedUploadUrl(path);
    if (error || !signed) {
      await libraryRepository.remove(db, userId, itemId);
      throw new AppError('INTERNAL', undefined, error);
    }
    if (ctx.lessonId) await contentRepository.markLessonStarted(db, userId, ctx.lessonId);
    log.info('upload session created', { sessionId: s.id, kind: i.kind, sizeBytes: i.sizeBytes });
    return { session: sessionView(s, item), upload: { bucket: BUCKETS.recordings, path, token: signed.token, signedUrl: signed.signedUrl, expiresInSec: SIGNED_UPLOAD_TTL_SEC } };
  },

  /**
   * Bước 2: client báo đã tải xong + thời lượng đo được. Server kiểm tra tệp thật sự có trong Storage,
   * rồi áp quy tắc > 5 phút / hết lượt. Phase 3: job đo lại thời lượng từ STT và áp lại quy tắc nếu lệch (chống sửa số liệu).
   */
  async completeUpload(db: Db, userId: string, sessionId: string, durationSec: number) {
    const s = await sessionRepository.findOwned(db, userId, sessionId);
    if (!s) throw new AppError('NOT_FOUND', { resource: 'session' });
    const item = await libraryRepository.findOwned(db, userId, s.library_item_id);
    if (!item || !item.storage_path) throw new AppError('NOT_FOUND', { resource: 'library_item' });
    if (s.status !== 'uploading') return sessionView(s, item);   // gọi lại (retry mạng) → trả trạng thái hiện tại

    const folder = item.storage_path.split('/')[0]!, name = fileNameOf(item.storage_path);
    const { data: objects, error } = await db.storage.from(BUCKETS.recordings).list(folder, { search: name, limit: 1 });
    if (error) throw new AppError('INTERNAL', undefined, error);
    const obj = objects?.find((o) => o.name === name);
    if (!obj) throw new AppError('UPLOAD_NOT_FOUND');
    const size = Number((obj.metadata as Record<string, unknown> | null)?.size ?? item.size_bytes ?? 0);
    const maxSec = s.is_placement ? PLACEMENT_MAX_SEC : MAX_RECORD_SEC;
    const tooBig = size > MAX_UPLOAD_BYTES, tooLong = durationSec > maxSec;
    if (tooBig || tooLong) {
      await db.storage.from(BUCKETS.recordings).remove([item.storage_path]);
      await libraryRepository.remove(db, userId, item.id);
      throw new AppError(tooBig ? 'FILE_TOO_LARGE' : 'FILE_TOO_LONG', { maxSec, durationSec });
    }
    const updatedItem = await libraryRepository.update(db, userId, item.id, { duration_sec: Math.round(durationSec * 100) / 100, size_bytes: size, upload_completed_at: new Date().toISOString() });
    const uploaded = await sessionRepository.transition(db, userId, s.id, ['uploading'], { status: 'uploaded' });
    if (!uploaded) return sessionView((await sessionRepository.findOwned(db, userId, s.id))!, updatedItem);
    const me = await profileService.getMe(db, userId);
    return sessionView(await decideAndEnqueue(db, me, uploaded, updatedItem), updatedItem);
  },

  /** Chấm kịch bản: dán văn bản hoặc nội dung file .txt/.md (client đọc file rồi gửi text). */
  async submitScript(db: Db, userId: string, i: PracticeContextInput & { text: string }) {
    const me = await profileService.getMe(db, userId);
    if (!me.onboarded) throw new AppError('ONBOARDING_REQUIRED');
    const text = i.text.replace(/\r\n/g, '\n').trim(), words = wordCount(text);
    if (words < MIN_SCRIPT_WORDS) throw new AppError('SCRIPT_TOO_SHORT', { words, min: MIN_SCRIPT_WORDS });
    const ctx = await resolveContext(db, me, { ...i, isPlacement: false });
    assertGoalAllowed(me, ctx.goal, false);
    const item = await libraryRepository.insert(db, { user_id: userId, kind: 'script', title: ctx.title, script_text: text, word_count: words, duration_sec: Math.round(words / 130 * 60) });
    const s = await sessionRepository.insert(db, { user_id: userId, library_item_id: item.id, lesson_id: ctx.lessonId, prompt_id: ctx.promptId, goal: ctx.goal, speaking_language: ctx.lang, title: ctx.title, status: 'uploaded' });
    if (ctx.lessonId) await contentRepository.markLessonStarted(db, userId, ctx.lessonId);
    return sessionView(await decideAndEnqueue(db, me, s, item), item);
  },

  /**
   * Yêu cầu phân tích lại: sau khi nâng cấp Premium (Phase 4 gọi tự động với payments.resume_session_id),
   * sang tháng mới có lượt, hoặc chạy lại sau lỗi.
   */
  async requestAnalysis(db: Db, userId: string, sessionId: string) {
    const s = await sessionRepository.findOwned(db, userId, sessionId);
    if (!s) throw new AppError('NOT_FOUND', { resource: 'session' });
    const item = await libraryRepository.findOwned(db, userId, s.library_item_id);
    if (!item) throw new AppError('NOT_FOUND', { resource: 'library_item' });
    if (!canRequestAnalysis(s.status)) {
      if (s.status === 'queued' || s.status === 'processing' || s.status === 'completed') return sessionView(s, item);
      throw new AppError('INVALID_STATE', { status: s.status });
    }
    if (item.kind !== 'script' && item.media_deleted_at) throw new AppError('MEDIA_EXPIRED', { reason: item.media_delete_reason });
    const me = await profileService.getMe(db, userId);
    return sessionView(await decideAndEnqueue(db, me, s, item), item);
  },

  /** Nhận chỉ số MediaPipe từ trình duyệt. Phải gửi TRƯỚC khi job bắt đầu chấm (lý tưởng: trước upload-complete). */
  async saveBodyMetrics(db: Db, userId: string, sessionId: string, metrics: BodyMetrics) {
    const s = await sessionRepository.findOwned(db, userId, sessionId);
    if (!s) throw new AppError('NOT_FOUND', { resource: 'session' });
    const item = await libraryRepository.findOwned(db, userId, s.library_item_id);
    if (item?.kind !== 'video') throw new AppError('INVALID_STATE', { reason: 'not_video' });
    const updated = await sessionRepository.transition(db, userId, s.id, ['uploading', 'uploaded', 'queued', 'pending_premium', 'pending_quota', 'failed'],
      { client_body_metrics: metrics as unknown as Json, body_metrics_received_at: new Date().toISOString() });
    if (!updated) throw new AppError('INVALID_STATE', { status: s.status, reason: 'analysis_started' });
    return { received: true };
  },

  /** Danh sách buổi luyện đã chấm xong (tóm tắt), dùng dựng Tổng quan, Tiến bộ và lộ trình. */
  async listCompleted(db: Db, userId: string, limit: number) {
    const rows = await sessionRepository.completedSummaries(db, userId, limit);
    return rows.map((r) => {
      const fillers = (r.result?.speech_metrics as { fillerCount?: number } | null)?.fillerCount ?? null;
      return {
        id: r.id, libraryItemId: r.library_item_id, title: r.title, goal: r.goal, speakingLanguage: r.speaking_language, isPlacement: r.is_placement,
        lessonSlug: r.lessonSlug, kind: r.item?.kind ?? 'audio', durationSec: r.item?.duration_sec ?? 0, wordCount: r.item?.word_count ?? null,
        createdAt: r.created_at, completedAt: r.completed_at,
        score: r.result?.overall_score ?? null, criteria: (r.result?.criteria_scores ?? {}) as Record<string, number | null>, fillerCount: fillers,
      };
    }).filter((r) => r.score != null);
  },

  async get(db: Db, userId: string, sessionId: string) {
    const s = await sessionRepository.findOwned(db, userId, sessionId);
    if (!s) throw new AppError('NOT_FOUND', { resource: 'session' });
    const item = await libraryRepository.findOwned(db, userId, s.library_item_id);
    if (!item) throw new AppError('NOT_FOUND', { resource: 'library_item' });
    const result = s.status === 'completed' ? await sessionRepository.result(db, userId, s.id) : null;
    return { ...sessionView(s, item), result };
  },
};

export type SubmissionKindInput = Exclude<SubmissionKind, 'script'>;
