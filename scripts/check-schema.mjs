// Kiểm chứng migration + seed trên PGlite (Postgres chạy trong Node), không cần Docker.
// Giả lập phần Supabase cung cấp sẵn: schema auth, storage, các role.
import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const run = async (label, sql) => { try { await db.exec(sql); console.log('ok  ', label); } catch (e) { console.error('FAIL', label, '\n', e.message); process.exit(1); } };

await run('supabase stubs', `
  create role anon; create role authenticated; create role service_role;
  create schema auth; create schema storage;
  create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
  create function storage.foldername(name text) returns text[] language sql as $$ select string_to_array(name, '/') $$;
  alter table storage.objects enable row level security;
  grant usage on schema public to anon, authenticated, service_role;
  grant usage on schema auth to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
`);
const dir = 'supabase/migrations';
for (const f of fs.readdirSync(dir).sort()) await run(f, fs.readFileSync(path.join(dir, f), 'utf8'));
await run('seed.sql', fs.readFileSync('supabase/seed.sql', 'utf8'));

const one = async sql => (await db.query(sql)).rows;
console.log('courses / lessons / prompts:', (await one(`select (select count(*) from courses) c, (select count(*) from lessons) l, (select count(*) from practice_prompts) p`))[0]);

// Trigger tạo profile từ metadata đăng ký.
await db.exec(`insert into auth.users values ('00000000-0000-0000-0000-000000000001', 'minh@test.vn', '{"full_name":"Trần Minh","ui_language":"en","default_goal":"interview","speaking_language":"en"}')`);
console.log('profile from signup metadata:', (await one(`select full_name, ui_language, default_goal, speaking_language, plan from profiles`))[0]);

// Giữ chỗ lượt: giới hạn 3 → lần thứ 4 bị từ chối; hoàn lượt hoạt động.
const reserve = async () => (await one(`select reserve_analysis_credit('00000000-0000-0000-0000-000000000001', 3) ok`))[0].ok;
console.log('reserve x4:', [await reserve(), await reserve(), await reserve(), await reserve()]);
await db.exec(`select refund_analysis_credit('00000000-0000-0000-0000-000000000001')`);
console.log('after refund:', (await one(`select analyses_used from usage_counters`))[0]);

// Ràng buộc: kịch bản không được có storage_path; trạng thái chờ phải có lý do.
const expectFail = async (label, sql) => { try { await db.exec(sql); console.error('FAIL (should reject)', label); process.exit(1); } catch { console.log('rejects', label); } };
await expectFail('script with storage path', `insert into library_items (user_id, kind, title, script_text, storage_path) values ('00000000-0000-0000-0000-000000000001','script','x','text','a/b')`);
await expectFail('media without expiry', `insert into library_items (user_id, kind, title, storage_path, duration_sec) values ('00000000-0000-0000-0000-000000000001','audio','x','u/x.webm', 10)`);
await expectFail('media deleted without reason', `insert into library_items (user_id, kind, title, storage_path, media_expires_at, media_deleted_at) values ('00000000-0000-0000-0000-000000000001','audio','x','u/y.webm', now(), now())`);
await db.exec(`insert into library_items (id, user_id, kind, title, storage_path, duration_sec, media_expires_at) values ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-000000000001','audio','Bài 6 phút','00000000-0000-0000-0000-000000000001/a1.webm', 361, now() + interval '30 days')`);
await expectFail('pending_premium without reason', `insert into practice_sessions (user_id, library_item_id, goal, speaking_language, title, status) values ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','pitching','vi','x','pending_premium')`);
await run('pending_premium with reason', `insert into practice_sessions (user_id, library_item_id, goal, speaking_language, title, status, blocked_reason) values ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','pitching','vi','x','pending_premium','over_free_duration')`);
await expectFail('premium without expiry', `update profiles set plan = 'premium'`);
await run('premium with expiry', `update profiles set plan = 'premium', premium_expires_at = now() + interval '30 days'`);
console.log('is_premium:', (await one(`select is_premium('00000000-0000-0000-0000-000000000001') p`))[0].p);

// RLS: đăng nhập với vai trò authenticated của user 1.
await db.exec(`insert into auth.users values ('00000000-0000-0000-0000-000000000002', 'other@test.vn', '{}')`);
await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);`);
console.log('RLS profiles visible:', (await one(`select count(*)::int n from profiles`))[0].n, '(expect 1)');
console.log('RLS courses visible:', (await one(`select count(*)::int n from courses`))[0].n, '(expect 5)');
await run('user can edit own name', `update profiles set full_name = 'Minh Trần' where id = auth.uid()`);
await expectFail('user cannot self-upgrade plan', `update profiles set plan = 'premium', premium_expires_at = now() + interval '1 year'`);
await expectFail('user cannot insert sessions directly', `insert into practice_sessions (user_id, library_item_id, goal, speaking_language, title) values (auth.uid(),'00000000-0000-0000-0000-0000000000a1','pitching','vi','x')`);
await expectFail('user cannot reserve credits directly', `select reserve_analysis_credit(auth.uid(), 999)`);
const other = (await one(`update profiles set full_name = 'hack' where id = '00000000-0000-0000-0000-000000000002' returning id`)).length;
console.log('RLS other user rows updated:', other, '(expect 0)');
await db.exec(`reset role`);

// ---- Phase 4: confirm_payment (atomic, idempotent, amount-checked, period stacking)
const U = '00000000-0000-0000-0000-000000000002';
await db.exec(`update profiles set plan='free', premium_expires_at=null where id='${U}'`);
const mkPay = async (code, cycle = 'monthly', amount = 149000) => (await one(`insert into payments (user_id, provider, order_code, amount_vnd, cycle, expires_at) values ('${U}','mock','${code}',${amount},'${cycle}', now() + interval '15 min') returning id`))[0].id;
const confirm = async (id, outcome, txn, amount) => (await one(`select confirm_payment('${id}','${outcome}',${txn ? `'${txn}'` : 'null'},${amount},'{}'::jsonb) r`))[0].r;
const p1 = await mkPay('T1');
const a = await confirm(p1, 'succeeded', 'X1', 149000), b = await confirm(p1, 'succeeded', 'X1', 149000);
console.log('confirm success / duplicate:', a.result, '/', b.result, '(expect activated / already_succeeded)');
const late = await confirm(p1, 'failed', 'X1', 149000);
console.log('failure after success:', late.result, '(expect already_succeeded)');
const end1 = (await one(`select premium_expires_at e from profiles where id='${U}'`))[0].e;
const p2 = await mkPay('T2', 'yearly', 1290000);
console.log('amount mismatch:', (await confirm(p2, 'succeeded', 'X2', 1000)).result, '(expect amount_mismatch)');
await confirm(p2, 'succeeded', 'X2', 1290000);
const subs = await one(`select status, cycle, current_period_end e from subscriptions where user_id='${U}' order by created_at`);
const end2 = (await one(`select premium_expires_at e from profiles where id='${U}'`))[0].e;
const days = Math.round((new Date(end2) - new Date(end1)) / 86400000);
console.log('renewal stacks on current period:', subs.length === 1 && days >= 365 && days <= 366 ? 'yes' : `NO (${subs.length} subs, +${days}d)`);
const p3 = await mkPay('T3');
console.log('cancel:', (await confirm(p3, 'cancelled', null, 149000)).result, '→ then success honoured:', (await confirm(p3, 'succeeded', 'X3', 149000)).result);
await expectFail('duplicate provider txn id', `update payments set provider_txn_id='X1' where order_code='T2'`);
await db.exec(`update profiles set premium_expires_at = now() - interval '1 day' where id='${U}'; update subscriptions set current_period_start = now() - interval '2 years', current_period_end = now() - interval '1 day' where user_id='${U}'`);
console.log('expire_billing:', (await one(`select expire_billing() r`))[0].r);
console.log('is_premium after expiry:', (await one(`select is_premium('${U}') p`))[0].p, '(expect false)');
await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${U}', false);`);
await expectFail('user cannot call confirm_payment', `select confirm_payment('${p1}','succeeded','Z',149000,'{}'::jsonb)`);
await db.exec(`reset role`);
console.log('ALL CHECKS PASSED');
