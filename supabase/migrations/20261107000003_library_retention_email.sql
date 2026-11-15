-- =====================================================================
-- Phase 2: thư viện, chính sách lưu trữ dữ liệu, nhật ký email.
-- Chính sách lưu trữ (đã thống nhất):
--   * Tệp ghi âm/video gốc: tối đa 30 ngày, sau đó tự xóa (giữ báo cáo + transcript).
--   * Tệp tạm khi AI xử lý (bucket "processing"): xóa ngay khi xong; cron dọn dự phòng sau 24 giờ.
--   * Báo cáo và transcript: giữ đến khi người dùng xóa bài hoặc xóa tài khoản.
--   * Người dùng tự xóa được video bất cứ lúc nào.
-- =====================================================================

alter table public.library_items
  add column media_expires_at     timestamptz,
  add column media_deleted_at     timestamptz,
  add column media_delete_reason  text check (media_delete_reason in ('user','retention','account','upload_abandoned')),
  add column retention_warned_at  timestamptz;

update public.library_items
   set media_expires_at = created_at + interval '30 days'
 where storage_path is not null and media_expires_at is null;

alter table public.library_items
  add constraint media_has_expiry check (kind = 'script' or media_expires_at is not null),
  add constraint media_deleted_has_reason check ((media_deleted_at is null) = (media_delete_reason is null));

-- Cron dọn dữ liệu quét theo ngày hết hạn của các tệp còn tồn tại.
create index library_items_retention_idx on public.library_items (media_expires_at)
  where storage_path is not null and media_deleted_at is null;

-- Bucket tệp tạm cho AI pipeline (âm thanh tách từ video, khung hình…). Không mở quyền cho client.
insert into storage.buckets (id, name, public, file_size_limit)
values ('processing', 'processing', false, 209715200)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- Nhật ký email gửi đi (Resend hoặc chế độ mock khi chưa có khóa).
-- Chỉ server đọc/ghi. Giúp kiểm thử luồng khi chưa có domain gửi email.
-- ---------------------------------------------------------------------
create type public.email_status as enum ('sent','mocked','failed');

create table public.email_messages (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid references public.profiles(id) on delete set null,
  to_email             text not null,
  template             text not null,
  subject              text not null,
  provider             text not null check (provider in ('resend','mock')),
  provider_message_id  text,
  status               public.email_status not null,
  error                text,
  created_at           timestamptz not null default now()
);
create index email_messages_user_idx on public.email_messages (user_id, created_at desc);
create index email_messages_created_idx on public.email_messages (created_at);
alter table public.email_messages enable row level security;
-- Không có policy: chỉ service_role truy cập.
