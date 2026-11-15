import { handler, ok, parse } from '@/lib/http';
import { zGoal } from '@/lib/validation';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { contentRepository } from '@/repositories/content.repository';

/** GET /api/public/prompts?goal= → bộ đề bài theo loại hình (công khai, cache 1 giờ). */
export const GET = handler(async (req) => {
  const g = req.nextUrl.searchParams.get('goal');
  const prompts = await contentRepository.prompts(supabaseAdmin(), g ? parse(zGoal, g) : undefined);
  return ok(prompts, { headers: { 'cache-control': 'public, s-maxage=3600, stale-while-revalidate=86400' } });
});
