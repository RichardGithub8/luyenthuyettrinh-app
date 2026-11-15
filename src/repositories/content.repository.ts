import 'server-only';
import type { Db } from './types';
import { AppError } from '@/lib/errors';
import type { GoalType } from '@/types/database';

const fail = (e: unknown): never => { throw new AppError('INTERNAL', undefined, e); };

export const contentRepository = {
  async lessonBySlug(db: Db, slug: string) {
    const { data, error } = await db.from('lessons').select('id,slug,title,suggested_kind,target_sec,course_id').eq('slug', slug).eq('is_published', true).maybeSingle();
    if (error) fail(error);
    if (!data) return null;
    const { data: course, error: e2 } = await db.from('courses').select('goal').eq('id', data.course_id).single();
    return e2 ? fail(e2) : { ...data, goal: course.goal as GoalType };
  },
  async promptById(db: Db, id: string) {
    const { data, error } = await db.from('practice_prompts').select('id,goal,text').eq('id', id).eq('is_active', true).maybeSingle();
    return error ? fail(error) : data;
  },
  async prompts(db: Db, goal?: GoalType) {
    let q = db.from('practice_prompts').select('id,goal,key,text,sort_order').eq('is_active', true).order('goal').order('sort_order');
    if (goal) q = q.eq('goal', goal);
    const { data, error } = await q;
    return error ? fail(error) : data;
  },
  async markLessonStarted(db: Db, userId: string, lessonId: string) {
    const { error } = await db.from('user_lesson_progress').upsert({ user_id: userId, lesson_id: lessonId, status: 'in_progress' }, { onConflict: 'user_id,lesson_id', ignoreDuplicates: true });
    if (error) fail(error);
  },
};
