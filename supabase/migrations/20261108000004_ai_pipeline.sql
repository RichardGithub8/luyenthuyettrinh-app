-- =====================================================================
-- Phase 3: AI pipeline.
--   * Chỉ số ngôn ngữ cơ thể do MediaPipe tính TRÊN TRÌNH DUYỆT, gửi lên trước khi job chạy.
--   * Realtime cho practice_sessions để giao diện nhận trạng thái mà không cần poll liên tục.
-- =====================================================================
alter table public.practice_sessions
  add column client_body_metrics      jsonb,
  add column body_metrics_received_at timestamptz;

-- Job đang chạy quá lâu (watchdog quét theo updated_at).
create index practice_sessions_inflight_idx on public.practice_sessions (updated_at) where status in ('queued','processing');

-- Supabase Realtime: client subscribe thay đổi trạng thái bài của chính mình (RLS vẫn áp dụng).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    execute 'alter publication supabase_realtime add table public.practice_sessions';
  end if;
end $$;
