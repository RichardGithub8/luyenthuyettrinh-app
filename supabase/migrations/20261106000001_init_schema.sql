-- =====================================================================
-- luyenthuyettrinh.com · Schema khởi tạo (toàn bộ MVP, các phase sau dùng lại)
-- Nguyên tắc bảo mật:
--   * Bật RLS cho mọi bảng.
--   * Client (anon/authenticated) chủ yếu chỉ ĐỌC dữ liệu của chính mình.
--   * Mọi thao tác GHI có quy tắc nghiệp vụ (giới hạn 5 phút, lượt phân tích,
--     thanh toán, chấm điểm) đi qua API server dùng service_role, nên không thể
--     bị vượt qua bằng cách gọi thẳng PostgREST.
--   * Riêng profiles cho phép người dùng tự sửa một số cột (column privilege).
-- =====================================================================


-- ---------------------------------------------------------------------
-- Enum
-- ---------------------------------------------------------------------
create type public.goal_type          as enum ('presentation','reporting','interview','pitching','debating');
create type public.lang_code          as enum ('vi','en');
create type public.plan_tier          as enum ('free','premium');
create type public.submission_kind    as enum ('audio','video','script');
create type public.session_status     as enum (
  'draft',            -- đã tạo, chưa có tệp
  'uploading',        -- đã cấp URL tải lên, chờ client tải xong
  'uploaded',         -- tệp đã có, chờ quyết định đưa vào hàng đợi
  'pending_premium',  -- > 5 phút với gói Miễn phí: chỉ lưu thư viện
  'pending_quota',    -- hết lượt phân tích tháng
  'queued',           -- đã đưa vào hàng đợi Trigger.dev
  'processing',       -- job đang chạy
  'completed',
  'failed',
  'cancelled'
);
create type public.analysis_status    as enum ('queued','transcribing','analyzing_body','scoring','completed','failed','timed_out');
create type public.lesson_skill       as enum ('structure','opening','closing','pace','filler','body','content','qa');
create type public.lesson_status      as enum ('not_started','in_progress','completed');
create type public.payment_provider   as enum ('momo','vnpay');
create type public.payment_status     as enum ('pending','succeeded','failed','cancelled','expired');
create type public.billing_cycle      as enum ('monthly','yearly');
create type public.subscription_status as enum ('active','cancelled','expired');

-- ---------------------------------------------------------------------
-- Tiện ích
-- ---------------------------------------------------------------------
create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- Kỳ tính lượt theo giờ Việt Nam (đầu tháng).
create or replace function public.current_usage_period() returns date
language sql stable as $$
  select date_trunc('month', now() at time zone 'Asia/Ho_Chi_Minh')::date
$$;

-- ---------------------------------------------------------------------
-- profiles (mở rộng auth.users)
-- ---------------------------------------------------------------------
create table public.profiles (
  id                  uuid primary key references auth.users(id) on delete cascade,
  email               text not null,
  full_name           text not null default '' check (char_length(full_name) <= 120),
  organization        text check (char_length(organization) <= 160),
  avatar_url          text,
  default_goal        public.goal_type not null default 'presentation',
  ui_language         public.lang_code not null default 'vi',
  speaking_language   public.lang_code not null default 'vi',
  onboarded_at        timestamptz,
  plan                public.plan_tier not null default 'free',
  premium_expires_at  timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint premium_needs_expiry check (plan = 'free' or premium_expires_at is not null)
);
create index profiles_premium_expiry_idx on public.profiles (premium_expires_at) where plan = 'premium';
create trigger profiles_updated_at before update on public.profiles for each row execute function public.set_updated_at();

create or replace function public.is_premium(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select plan = 'premium' and premium_expires_at > now() from public.profiles where id = p_user),
    false)
$$;

-- Tạo profile khi có tài khoản mới; đọc lựa chọn lúc đăng ký từ user_metadata.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  m jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
begin
  insert into public.profiles (id, email, full_name, ui_language, speaking_language, default_goal)
  values (
    new.id,
    coalesce(new.email, ''),
    left(coalesce(nullif(m->>'full_name',''), nullif(m->>'name',''), split_part(coalesce(new.email,''), '@', 1)), 120),
    case when m->>'ui_language'       in ('vi','en') then (m->>'ui_language')::public.lang_code       else 'vi' end,
    case when m->>'speaking_language' in ('vi','en') then (m->>'speaking_language')::public.lang_code else 'vi' end,
    case when m->>'default_goal' in ('presentation','reporting','interview','pitching','debating')
         then (m->>'default_goal')::public.goal_type else 'presentation' end
  )
  on conflict (id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

create or replace function public.sync_user_email() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.email is distinct from old.email then
    update public.profiles set email = coalesce(new.email, '') where id = new.id;
  end if;
  return new;
end $$;
create trigger on_auth_user_email_changed after update of email on auth.users for each row execute function public.sync_user_email();

-- ---------------------------------------------------------------------
-- Lượt phân tích theo tháng
-- ---------------------------------------------------------------------
create table public.usage_counters (
  user_id         uuid not null references public.profiles(id) on delete cascade,
  period_start    date not null,
  analyses_used   integer not null default 0 check (analyses_used >= 0),
  updated_at      timestamptz not null default now(),
  primary key (user_id, period_start)
);
create trigger usage_counters_updated_at before update on public.usage_counters for each row execute function public.set_updated_at();

-- Giữ chỗ 1 lượt một cách nguyên tử (không vượt giới hạn khi có nhiều request song song).
create or replace function public.reserve_analysis_credit(p_user uuid, p_limit integer) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_period date := public.current_usage_period();
  v_used integer;
begin
  insert into public.usage_counters (user_id, period_start) values (p_user, v_period) on conflict do nothing;
  update public.usage_counters
     set analyses_used = analyses_used + 1
   where user_id = p_user and period_start = v_period and analyses_used < p_limit
  returning analyses_used into v_used;
  return v_used is not null;
end $$;

-- Hoàn lượt khi phân tích thất bại.
create or replace function public.refund_analysis_credit(p_user uuid) returns void
language sql security definer set search_path = public as $$
  update public.usage_counters
     set analyses_used = greatest(analyses_used - 1, 0)
   where user_id = p_user and period_start = public.current_usage_period()
$$;

-- ---------------------------------------------------------------------
-- Khóa học, bài học, đề bài
-- ---------------------------------------------------------------------
create table public.courses (
  id            uuid primary key default gen_random_uuid(),
  goal          public.goal_type not null unique,
  slug          text not null unique check (slug ~ '^[a-z0-9-]+$'),
  title         jsonb not null,          -- {"vi": "...", "en": "..."}
  description   jsonb not null,
  ai_persona    jsonb not null,          -- {"name": "...", "role": {...}, "focus": {...}, "questions": [...]}
  cover_image   text,
  sort_order    integer not null default 0,
  is_published  boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger courses_updated_at before update on public.courses for each row execute function public.set_updated_at();

create table public.lessons (
  id              uuid primary key default gen_random_uuid(),
  course_id       uuid not null references public.courses(id) on delete cascade,
  slug            text not null unique check (slug ~ '^[a-z0-9-]+$'),
  position        integer not null check (position > 0),
  skill           public.lesson_skill not null,
  title           jsonb not null,
  theory          jsonb not null default '[]'::jsonb,   -- [{"vi","en"}, ...]
  tip             jsonb,
  task            jsonb not null,
  suggested_kind  public.submission_kind not null,
  target_sec      integer not null check (target_sec between 10 and 1800),
  est_minutes     integer not null check (est_minutes > 0),
  pass_score      smallint not null default 60 check (pass_score between 0 and 100),
  is_published    boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (course_id, position)
);
create index lessons_course_idx on public.lessons (course_id, position);
create trigger lessons_updated_at before update on public.lessons for each row execute function public.set_updated_at();

create table public.practice_prompts (
  id          uuid primary key default gen_random_uuid(),
  goal        public.goal_type not null,
  key         text not null unique,
  text        jsonb not null,
  sort_order  integer not null default 0,
  is_active   boolean not null default true
);
create index practice_prompts_goal_idx on public.practice_prompts (goal, sort_order) where is_active;

-- ---------------------------------------------------------------------
-- Thư viện bài nói (tệp hoặc kịch bản) và buổi luyện
-- ---------------------------------------------------------------------
create table public.library_items (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.profiles(id) on delete cascade,
  kind           public.submission_kind not null,
  title          text not null check (char_length(title) between 1 and 200),
  storage_path   text unique,                         -- recordings/<user_id>/<id>.<ext>
  mime_type      text,
  size_bytes     bigint check (size_bytes >= 0),
  duration_sec   numeric(8,2) check (duration_sec >= 0),
  script_text    text check (char_length(script_text) <= 50000),
  word_count     integer check (word_count >= 0),
  upload_completed_at timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz,
  constraint library_media_or_script check (
    (kind = 'script' and script_text is not null and storage_path is null) or
    (kind <> 'script' and storage_path is not null)
  )
);
create index library_items_user_idx on public.library_items (user_id, created_at desc) where deleted_at is null;
create trigger library_items_updated_at before update on public.library_items for each row execute function public.set_updated_at();

create table public.practice_sessions (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references public.profiles(id) on delete cascade,
  library_item_id    uuid not null references public.library_items(id) on delete cascade,
  lesson_id          uuid references public.lessons(id) on delete set null,
  prompt_id          uuid references public.practice_prompts(id) on delete set null,
  goal               public.goal_type not null,
  speaking_language  public.lang_code not null,
  title              text not null check (char_length(title) between 1 and 200),
  is_placement       boolean not null default false,
  status             public.session_status not null default 'draft',
  blocked_reason     text check (blocked_reason in ('over_free_duration','no_quota')),
  credit_reserved    boolean not null default false,
  attempt_count      integer not null default 0,
  last_error_code    text,
  last_error_message text,
  queued_at          timestamptz,
  started_at         timestamptz,
  completed_at       timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint blocked_reason_matches_status check (
    (status in ('pending_premium','pending_quota')) = (blocked_reason is not null)
  )
);
create index practice_sessions_user_idx    on public.practice_sessions (user_id, created_at desc);
create index practice_sessions_status_idx  on public.practice_sessions (user_id, status);
create index practice_sessions_pending_idx on public.practice_sessions (user_id, created_at) where status in ('pending_premium','pending_quota');
create index practice_sessions_lesson_idx  on public.practice_sessions (user_id, lesson_id) where lesson_id is not null;
create index practice_sessions_library_idx on public.practice_sessions (library_item_id);
create trigger practice_sessions_updated_at before update on public.practice_sessions for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- Kết quả phân tích (1-1 với buổi luyện) và nhật ký job
-- ---------------------------------------------------------------------
create table public.analysis_results (
  id               uuid primary key default gen_random_uuid(),
  session_id       uuid not null unique references public.practice_sessions(id) on delete cascade,
  user_id          uuid not null references public.profiles(id) on delete cascade,
  status           public.analysis_status not null default 'queued',
  overall_score    smallint check (overall_score between 0 and 100),
  criteria_scores  jsonb not null default '{}'::jsonb,  -- {"content":78,...}
  transcript       jsonb,                              -- [{"start":0,"end":4.2,"text":"..."}]
  speech_metrics   jsonb,                              -- {"wpm":[...],"fillers":[...],"pauses":[...]}
  body_metrics     jsonb,                              -- {"eye_contact":0.38,...} (từ MediaPipe)
  feedback         jsonb,                              -- {"summary","issues":[],"rewrites":[],"questions":[]}
  stt_model        text,
  llm_model        text,
  prompt_version   text,
  input_tokens     integer,
  output_tokens    integer,
  cost_usd         numeric(10,6),
  trigger_run_id   text,
  error_code       text,
  error_message    text,
  started_at       timestamptz,
  finished_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index analysis_results_user_idx on public.analysis_results (user_id, created_at desc);
create trigger analysis_results_updated_at before update on public.analysis_results for each row execute function public.set_updated_at();

create table public.analysis_events (
  id          bigint generated always as identity primary key,
  session_id  uuid not null references public.practice_sessions(id) on delete cascade,
  level       text not null check (level in ('debug','info','warn','error')),
  step        text not null,
  message     text not null,
  data        jsonb,
  created_at  timestamptz not null default now()
);
create index analysis_events_session_idx on public.analysis_events (session_id, created_at);

-- ---------------------------------------------------------------------
-- Tiến độ bài học
-- ---------------------------------------------------------------------
create table public.user_lesson_progress (
  user_id         uuid not null references public.profiles(id) on delete cascade,
  lesson_id       uuid not null references public.lessons(id) on delete cascade,
  status          public.lesson_status not null default 'not_started',
  theory_read_at  timestamptz,
  best_score      smallint check (best_score between 0 and 100),
  attempts        integer not null default 0 check (attempts >= 0),
  completed_at    timestamptz,
  updated_at      timestamptz not null default now(),
  primary key (user_id, lesson_id)
);
create index user_lesson_progress_status_idx on public.user_lesson_progress (user_id, status);
create trigger user_lesson_progress_updated_at before update on public.user_lesson_progress for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- Gói và thanh toán
-- MoMo/VNPay không hỗ trợ trừ tiền định kỳ mặc định → MVP dùng gói trả trước theo kỳ;
-- auto_renew dùng để nhắc gia hạn và tạo link thanh toán kỳ tiếp theo.
-- ---------------------------------------------------------------------
create table public.subscriptions (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references public.profiles(id) on delete cascade,
  plan                  public.plan_tier not null default 'premium',
  cycle                 public.billing_cycle not null,
  status                public.subscription_status not null default 'active',
  auto_renew            boolean not null default true,
  current_period_start  timestamptz not null,
  current_period_end    timestamptz not null,
  cancelled_at          timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  check (current_period_end > current_period_start)
);
create unique index subscriptions_one_active_idx on public.subscriptions (user_id) where status = 'active';
create index subscriptions_period_end_idx on public.subscriptions (current_period_end) where status = 'active';
create trigger subscriptions_updated_at before update on public.subscriptions for each row execute function public.set_updated_at();

create table public.payments (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references public.profiles(id) on delete cascade,
  subscription_id    uuid references public.subscriptions(id) on delete set null,
  provider           public.payment_provider not null,
  order_code         text not null unique,      -- mã đơn gửi sang cổng thanh toán
  provider_txn_id    text,
  amount_vnd         integer not null check (amount_vnd > 0),
  cycle              public.billing_cycle not null,
  status             public.payment_status not null default 'pending',
  resume_session_id  uuid references public.practice_sessions(id) on delete set null,  -- bài sẽ phân tích ngay sau khi trả tiền
  return_path        text check (return_path is null or return_path ~ '^/[^/]'),
  failure_code       text,
  failure_message    text,
  ipn_payload        jsonb,
  expires_at         timestamptz not null,
  paid_at            timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create unique index payments_provider_txn_idx on public.payments (provider, provider_txn_id) where provider_txn_id is not null;
create index payments_user_idx    on public.payments (user_id, created_at desc);
create index payments_pending_idx on public.payments (expires_at) where status = 'pending';
create trigger payments_updated_at before update on public.payments for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------
alter table public.profiles              enable row level security;
alter table public.usage_counters        enable row level security;
alter table public.courses               enable row level security;
alter table public.lessons               enable row level security;
alter table public.practice_prompts      enable row level security;
alter table public.library_items         enable row level security;
alter table public.practice_sessions     enable row level security;
alter table public.analysis_results      enable row level security;
alter table public.analysis_events       enable row level security;
alter table public.user_lesson_progress  enable row level security;
alter table public.subscriptions         enable row level security;
alter table public.payments              enable row level security;

-- profiles: đọc và sửa hồ sơ của chính mình, chỉ các cột được phép.
create policy profiles_select_own on public.profiles for select to authenticated using (id = auth.uid());
create policy profiles_update_own on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
revoke update on public.profiles from anon, authenticated;
grant update (full_name, organization, avatar_url, default_goal, ui_language, speaking_language, onboarded_at)
  on public.profiles to authenticated;

-- Nội dung công khai.
create policy courses_read  on public.courses          for select to anon, authenticated using (is_published);
create policy lessons_read  on public.lessons          for select to anon, authenticated using (is_published);
create policy prompts_read  on public.practice_prompts for select to anon, authenticated using (is_active);

-- Dữ liệu cá nhân: chỉ đọc; ghi qua API server.
create policy usage_select_own     on public.usage_counters       for select to authenticated using (user_id = auth.uid());
create policy library_select_own   on public.library_items        for select to authenticated using (user_id = auth.uid() and deleted_at is null);
create policy sessions_select_own  on public.practice_sessions    for select to authenticated using (user_id = auth.uid());
create policy results_select_own   on public.analysis_results     for select to authenticated using (user_id = auth.uid());
create policy progress_select_own  on public.user_lesson_progress for select to authenticated using (user_id = auth.uid());
create policy subs_select_own      on public.subscriptions        for select to authenticated using (user_id = auth.uid());
create policy payments_select_own  on public.payments             for select to authenticated using (user_id = auth.uid());
-- analysis_events: không có policy → chỉ service_role đọc được (nhật ký nội bộ).

-- Hàm nhạy cảm chỉ server được gọi.
revoke execute on function public.reserve_analysis_credit(uuid, integer) from public, anon, authenticated;
revoke execute on function public.refund_analysis_credit(uuid)           from public, anon, authenticated;
grant  execute on function public.reserve_analysis_credit(uuid, integer) to service_role;
grant  execute on function public.refund_analysis_credit(uuid)           to service_role;
