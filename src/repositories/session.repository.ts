import 'server-only';
import type { Db } from './types';
import type { Database, PracticeSessionRow, SessionStatus } from '@/types/database';
import { AppError } from '@/lib/errors';

type Insert = Database['public']['Tables']['practice_sessions']['Insert'];
type Patch = Database['public']['Tables']['practice_sessions']['Update'];
const fail = (e: unknown): never => { throw new AppError('INTERNAL', undefined, e); };

export const sessionRepository = {
  async insert(db: Db, row: Insert): Promise<PracticeSessionRow> {
    const { data, error } = await db.from('practice_sessions').insert(row).select('*').single();
    return error ? fail(error) : data;
  },
  async findOwned(db: Db, userId: string, id: string): Promise<PracticeSessionRow | null> {
    const { data, error } = await db.from('practice_sessions').select('*').eq('id', id).eq('user_id', userId).maybeSingle();
    return error ? fail(error) : data;
  },
  /**
   * Chuyển trạng thái có điều kiện (optimistic concurrency): chỉ cập nhật khi trạng thái hiện tại nằm trong `from`.
   * Trả về null nếu một request khác đã chuyển trạng thái trước → tránh xử lý trùng.
   */
  async transition(db: Db, userId: string, id: string, from: readonly SessionStatus[], patch: Patch): Promise<PracticeSessionRow | null> {
    const { data, error } = await db.from('practice_sessions').update(patch).eq('id', id).eq('user_id', userId).in('status', [...from]).select('*').maybeSingle();
    return error ? fail(error) : data;
  },
  async byLibraryItems(db: Db, userId: string, itemIds: string[]) {
    if (!itemIds.length) return [];
    const { data, error } = await db.from('practice_sessions').select('id,library_item_id,status,blocked_reason,goal,speaking_language,lesson_id,is_placement,created_at,completed_at,last_error_code')
      .eq('user_id', userId).in('library_item_id', itemIds).order('created_at', { ascending: false });
    return error ? fail(error) : data;
  },
  async placementTaken(db: Db, userId: string) {
    const { count, error } = await db.from('practice_sessions').select('id', { count: 'exact', head: true })
      .eq('user_id', userId).eq('is_placement', true).in('status', ['queued', 'processing', 'completed']);
    return error ? fail(error) : (count ?? 0) > 0;
  },
  async activeForItem(db: Db, itemId: string) {
    const { count, error } = await db.from('practice_sessions').select('id', { count: 'exact', head: true }).eq('library_item_id', itemId).in('status', ['queued', 'processing']);
    return error ? fail(error) : (count ?? 0) > 0;
  },
  async cancelPendingForItem(db: Db, itemId: string) {
    const { error } = await db.from('practice_sessions').update({ status: 'cancelled', blocked_reason: null }).eq('library_item_id', itemId).in('status', ['pending_premium', 'pending_quota', 'uploaded', 'failed']);
    if (error) fail(error);
  },
  async staleUploads(db: Db, before: string, limit: number) {
    const { data, error } = await db.from('practice_sessions').select('id,user_id,library_item_id').eq('status', 'uploading').lt('created_at', before).limit(limit);
    return error ? fail(error) : data;
  },
  async resultsForSessions(db: Db, userId: string, sessionIds: string[]) {
    if (!sessionIds.length) return [];
    const { data, error } = await db.from('analysis_results').select('session_id,status,overall_score').eq('user_id', userId).in('session_id', sessionIds);
    return error ? fail(error) : data;
  },
  async result(db: Db, userId: string, sessionId: string) {
    const { data, error } = await db.from('analysis_results').select('*').eq('user_id', userId).eq('session_id', sessionId).maybeSingle();
    return error ? fail(error) : data;
  },
};
