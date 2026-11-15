import 'server-only';
import type { Db } from './types';
import type { Database, LibraryItemRow } from '@/types/database';
import { AppError } from '@/lib/errors';

type Insert = Database['public']['Tables']['library_items']['Insert'];
type Patch = Database['public']['Tables']['library_items']['Update'];
const fail = (e: unknown): never => { throw new AppError('INTERNAL', undefined, e); };

/** Mọi truy vấn đều lọc theo user_id: dù dùng service_role, người dùng không chạm được dữ liệu của người khác. */
export const libraryRepository = {
  async insert(db: Db, row: Insert): Promise<LibraryItemRow> {
    const { data, error } = await db.from('library_items').insert(row).select('*').single();
    return error ? fail(error) : data;
  },
  async findOwned(db: Db, userId: string, id: string): Promise<LibraryItemRow | null> {
    const { data, error } = await db.from('library_items').select('*').eq('id', id).eq('user_id', userId).is('deleted_at', null).maybeSingle();
    return error ? fail(error) : data;
  },
  async update(db: Db, userId: string, id: string, patch: Patch): Promise<LibraryItemRow> {
    const { data, error } = await db.from('library_items').update(patch).eq('id', id).eq('user_id', userId).select('*').single();
    return error ? fail(error) : data;
  },
  async remove(db: Db, userId: string, id: string) {
    const { error } = await db.from('library_items').delete().eq('id', id).eq('user_id', userId);
    if (error) fail(error);
  },
  /** Danh sách thư viện, mới nhất trước, phân trang bằng con trỏ created_at. */
  async list(db: Db, userId: string, o: { kind?: 'audio' | 'video' | 'script'; q?: string; before?: string; limit: number }) {
    let query = db.from('library_items')
      .select('id,user_id,kind,title,storage_path,mime_type,size_bytes,duration_sec,word_count,created_at,media_expires_at,media_deleted_at,media_delete_reason')
      .eq('user_id', userId).is('deleted_at', null).order('created_at', { ascending: false }).limit(o.limit);
    if (o.kind) query = query.eq('kind', o.kind);
    if (o.q) query = query.ilike('title', `%${o.q.replace(/[\\%_]/g, (c) => '\\' + c)}%`);
    if (o.before) query = query.lt('created_at', o.before);
    const { data, error } = await query;
    return error ? fail(error) : data;
  },
  /** Tệp đến hạn xóa theo chính sách lưu trữ. */
  async expiredMedia(db: Db, now: string, limit: number) {
    const { data, error } = await db.from('library_items').select('id,user_id,storage_path')
      .not('storage_path', 'is', null).is('media_deleted_at', null).lt('media_expires_at', now).limit(limit);
    return error ? fail(error) : data;
  },
  async expiringSoon(db: Db, from: string, to: string, limit: number) {
    const { data, error } = await db.from('library_items').select('id,user_id,title,media_expires_at')
      .not('storage_path', 'is', null).is('media_deleted_at', null).is('retention_warned_at', null)
      .gte('media_expires_at', from).lt('media_expires_at', to).limit(limit);
    return error ? fail(error) : data;
  },
  async markMediaDeleted(db: Db, ids: string[], reason: 'user' | 'retention' | 'account' | 'upload_abandoned') {
    if (!ids.length) return;
    const { error } = await db.from('library_items').update({ media_deleted_at: new Date().toISOString(), media_delete_reason: reason }).in('id', ids);
    if (error) fail(error);
  },
};
