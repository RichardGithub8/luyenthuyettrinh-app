import 'server-only';
import type { Db } from './types';
import type { Database, PaymentProvider, PaymentRow, PaymentStatus } from '@/types/database';
import { AppError } from '@/lib/errors';

type Insert = Database['public']['Tables']['payments']['Insert'];
type Patch = Database['public']['Tables']['payments']['Update'];
const fail = (e: unknown): never => { throw new AppError('INTERNAL', undefined, e); };

export const paymentRepository = {
  async insert(db: Db, row: Insert): Promise<PaymentRow> {
    const { data, error } = await db.from('payments').insert(row).select('*').single();
    return error ? fail(error) : data;
  },
  async findOwned(db: Db, userId: string, id: string): Promise<PaymentRow | null> {
    const { data, error } = await db.from('payments').select('*').eq('id', id).eq('user_id', userId).maybeSingle();
    return error ? fail(error) : data;
  },
  async byOrderCode(db: Db, provider: PaymentProvider, orderCode: string): Promise<PaymentRow | null> {
    const { data, error } = await db.from('payments').select('*').eq('provider', provider).eq('order_code', orderCode).maybeSingle();
    return error ? fail(error) : data;
  },
  async byId(db: Db, id: string): Promise<PaymentRow | null> {
    const { data, error } = await db.from('payments').select('*').eq('id', id).maybeSingle();
    return error ? fail(error) : data;
  },
  async list(db: Db, userId: string, limit = 50): Promise<PaymentRow[]> {
    const { data, error } = await db.from('payments').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(limit);
    return error ? fail(error) : data;
  },
  /** Conditional update: only when the current status is in `from` (avoids racing an IPN). */
  async transition(db: Db, id: string, from: readonly PaymentStatus[], patch: Patch): Promise<PaymentRow | null> {
    const { data, error } = await db.from('payments').update(patch).eq('id', id).in('status', [...from]).select('*').maybeSingle();
    return error ? fail(error) : data;
  },
  async cancelOpen(db: Db, userId: string, code: string) {
    const { error } = await db.from('payments').update({ status: 'cancelled', failure_code: code }).eq('user_id', userId).eq('status', 'pending');
    if (error) fail(error);
  },
};
