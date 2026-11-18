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

// ---- Pricing v2: Pass / Premium (monthly, 6 months) / Team (≤ 5 seats)
const must = (label, cond, got) => { if (!cond) { console.error('FAIL', label, got ?? ''); process.exit(1); } console.log('ok  ', label); };
const U3 = '00000000-0000-0000-0000-000000000003', U4 = '00000000-0000-0000-0000-000000000004', U5 = '00000000-0000-0000-0000-000000000005', U6 = '00000000-0000-0000-0000-000000000006';
await db.exec(`insert into auth.users values ('${U3}','pass@test.vn','{"full_name":"Lan"}'), ('${U4}','lead@test.vn','{"full_name":"Hùng"}'), ('${U5}','mem@test.vn','{}'), ('${U6}','other-lead@test.vn','{}')`);
let seq = 0;
const buy = async (user, product, cycle, amount) => {
  const id = (await one(`insert into payments (user_id, provider, order_code, amount_vnd, cycle, product, expires_at) values ('${user}','mock','V2${++seq}',${amount},'${cycle}','${product}', now() + interval '15 min') returning id`))[0].id;
  return confirm(id, 'succeeded', `V2TX${seq}`, amount);
};
const prof = async (u) => (await one(`select plan::text plan, pass_credits, extract(epoch from premium_expires_at - now())/86400 days, plan_started_at from profiles where id='${u}'`))[0];
const key = async (u) => (await one(`select scope, period::text period from usage_key('${u}')`))[0];

must('pass activates', (await buy(U3, 'pass', 'once', 59000)).result === 'activated');
let q3 = await prof(U3);
must('pass: plan pass, 15 credits, ~7 days', q3.plan === 'pass' && q3.pass_credits === 15 && Math.abs(q3.days - 7) < 0.01, q3);
must('pass: usage counted per pass window', (await key(U3)).scope === 'pass');
let okN = 0; for (let i = 0; i < 16; i++) if ((await one(`select reserve_analysis_credit('${U3}', 15) r`))[0].r) okN++;
must('pass: exactly 15 analyses reserved', okN === 15, okN);
const window1 = (await key(U3)).period;
must('pass again stacks', (await buy(U3, 'pass', 'once', 59000)).result === 'activated');
q3 = await prof(U3);
must('pass again: +7 days, 30 credits, same window', q3.pass_credits === 30 && Math.abs(q3.days - 14) < 0.01 && (await key(U3)).period === window1, q3);
must('premium monthly replaces pass', (await buy(U3, 'premium', 'monthly', 79000)).result === 'activated');
q3 = await prof(U3);
must('premium: plan premium, credits reset, back to monthly usage', q3.plan === 'premium' && q3.pass_credits === 0 && (await key(U3)).scope === 'month' && q3.days > 27 && q3.days < 32, q3);
must('one active subscription', (await one(`select count(*)::int n from subscriptions where user_id='${U3}' and status='active'`))[0].n === 1);
const before = (await prof(U3)).days;
must('pass while premium is honoured', (await buy(U3, 'pass', 'once', 59000)).result === 'activated');
q3 = await prof(U3);
must('pass while premium: extends premium by 7 days, stays premium', q3.plan === 'premium' && Math.abs(q3.days - before - 7) < 0.01, q3);

must('team activates', (await buy(U4, 'team', 'monthly', 690000)).result === 'activated');
const T = (await one(`select id from teams where owner_id='${U4}'`))[0]?.id;
must('team: team created with leader', !!T && (await one(`select role, status from team_members where team_id='${T}' and user_id='${U4}'`))[0]?.role === 'leader');
must('team: leader has team plan', (await prof(U4)).plan === 'team');
const inv = async (email) => (await one(`select team_invite('${T}','${email}',5) r`))[0].r.result;
must('invite member', (await inv('Mem@Test.vn')) === 'invited');
must('invite is case-insensitive / no duplicates', (await inv('mem@test.vn')) === 'already');
await inv('a@x.vn'); await inv('b@x.vn'); await inv('pass@test.vn');
must('sixth seat refused (leader + 4)', (await inv('c@x.vn')) === 'full');
must('member joins', (await one(`select team_join('${T}','${U5}','mem@test.vn') r`))[0].r.result === 'joined');
const q5 = await prof(U5), q4 = await prof(U4);
must('member gets team plan until the team ends', q5.plan === 'team' && Math.abs(q5.days - q4.days) < 0.01, q5);
must('premium user joins team, keeps the later end date', (await one(`select team_join('${T}','${U3}','pass@test.vn') r`))[0].r.result === 'joined' && (await prof(U3)).plan === 'team' && Math.abs((await prof(U3)).days - q3.days) < 0.01);
await db.exec(`insert into payments (user_id, provider, order_code, amount_vnd, cycle, product, expires_at) values ('${U6}','mock','V2X',690000,'monthly','team', now() + interval '15 min')`);
await confirm((await one(`select id from payments where order_code='V2X'`))[0].id, 'succeeded', 'V2XT', 690000);
const T6 = (await one(`select id from teams where owner_id='${U6}'`))[0].id;
await one(`select team_invite('${T6}','mem@test.vn',5)`);
must('a user is active in one team only', (await one(`select team_join('${T6}','${U5}','mem@test.vn') r`))[0].r.result === 'in_other_team');
must('leader cannot be removed', (await one(`select team_remove('${T}','lead@test.vn') r`))[0].r.result === 'is_leader');
must('remove member → back to free', (await one(`select team_remove('${T}','mem@test.vn') r`))[0].r.result === 'removed' && (await prof(U5)).plan === 'free');
must('remove premium member → back to own premium', (await one(`select team_remove('${T}','pass@test.vn') r`))[0].r.result === 'removed' && (await prof(U3)).plan === 'premium');
must('team renew stacks', (await buy(U4, 'team', 'semiannual', 3490000)).result === 'activated' && (await prof(U4)).days > 200);
must('premium 6 months ≈ 6 months', (await buy(U5, 'premium', 'semiannual', 399000)).result === 'activated' && (await prof(U5)).days > 179 && (await prof(U5)).days < 186);
await db.exec(`update profiles set premium_expires_at = now() - interval '1 minute' where id='${U3}'`);
await one(`select expire_billing()`);
must('expire_billing downgrades any paid plan', (await prof(U3)).plan === 'free');
await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${U5}', false);`);
must('users cannot read teams directly (RLS)', (await one(`select count(*)::int n from teams`))[0].n === 0);
await expectFail('user cannot call team_join', `select team_join('${T}','${U5}','mem@test.vn')`);
await db.exec(`reset role`);
console.log('ALL CHECKS PASSED');
