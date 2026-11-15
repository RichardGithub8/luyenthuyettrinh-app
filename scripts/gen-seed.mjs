// Sinh supabase/seed.sql từ nội dung frontend (js/data.js) để hai bên dùng chung một nguồn.
// Cách dùng: node scripts/gen-seed.mjs ../luyenthuyettrinh/js/data.js > supabase/seed.sql
import fs from 'node:fs';
import vm from 'node:vm';

const src = fs.readFileSync(process.argv[2], 'utf8');
const { GOALS, COURSES } = vm.runInNewContext(src.replace(/^'use strict';/, '') + '\n;({ GOALS, COURSES })');
const q = s => `'${String(s).replace(/'/g, "''")}'`;
const j = o => `${q(JSON.stringify(o))}::jsonb`;
const out = ['-- Sinh tự động bởi scripts/gen-seed.mjs. Không sửa tay.', 'begin;'];
Object.entries(GOALS).forEach(([goal, g], i) => {
  out.push(`insert into public.courses (goal, slug, title, description, ai_persona, cover_image, sort_order) values ('${goal}', ${q(goal)}, ${j({ vi: 'Khóa luyện ' + g.name.vi.toLowerCase(), en: g.name.en + ' course' })}, ${j(g.desc)}, ${j({ name: g.persona, role: g.role, focus: g.focus, questions: g.questions })}, ${q(g.img)}, ${i}) on conflict (goal) do update set title = excluded.title, description = excluded.description, ai_persona = excluded.ai_persona, cover_image = excluded.cover_image, sort_order = excluded.sort_order;`);
  g.prompts.forEach((p, k) => out.push(`insert into public.practice_prompts (goal, key, text, sort_order) values ('${goal}', ${q(goal + '-' + (k + 1))}, ${j(p)}, ${k}) on conflict (key) do update set text = excluded.text, sort_order = excluded.sort_order;`));
  COURSES[goal].forEach((l, k) => out.push(`insert into public.lessons (course_id, slug, position, skill, title, theory, tip, task, suggested_kind, target_sec, est_minutes) select id, ${q(l.id)}, ${k + 1}, '${l.skill}', ${j(l.title)}, ${j(l.theory)}, ${j(l.tip)}, ${j(l.task)}, '${l.kind}', ${l.target}, ${l.mins} from public.courses where goal = '${goal}' on conflict (slug) do update set position = excluded.position, skill = excluded.skill, title = excluded.title, theory = excluded.theory, tip = excluded.tip, task = excluded.task, suggested_kind = excluded.suggested_kind, target_sec = excluded.target_sec, est_minutes = excluded.est_minutes;`));
});
out.push('commit;');
process.stdout.write(out.join('\n') + '\n');
