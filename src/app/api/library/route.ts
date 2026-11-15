import { z } from 'zod';
import { handler, ok, parse } from '@/lib/http';
import { requireUser } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { libraryService } from '@/services/library.service';

const Query = z.object({
  filter: z.enum(['all', 'audio', 'video', 'script', 'pending']).default('all'),
  q: z.string().trim().max(100).optional(),
  before: z.iso.datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

/** GET /api/library?filter=&q=&before=&limit= → { items, nextCursor } */
export const GET = handler(async (req) => {
  const { user } = await requireUser();
  return ok(await libraryService.list(supabaseAdmin(), user.id, parse(Query, Object.fromEntries(req.nextUrl.searchParams))));
});
