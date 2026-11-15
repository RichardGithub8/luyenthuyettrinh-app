-- Bucket lưu bản ghi âm/video. Riêng tư: chỉ truy cập qua signed URL do server cấp.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'recordings', 'recordings', false, 209715200,  -- 200 MB
  array['audio/mpeg','audio/mp3','audio/wav','audio/x-wav','audio/mp4','audio/x-m4a','audio/m4a','audio/webm','audio/ogg',
        'video/mp4','video/webm','video/quicktime']
)
on conflict (id) do nothing;

-- Đường dẫn: <user_id>/<library_item_id>.<ext>. Người dùng chỉ đọc được thư mục của mình.
create policy recordings_read_own on storage.objects for select to authenticated
  using (bucket_id = 'recordings' and (storage.foldername(name))[1] = auth.uid()::text);

-- Tải lên đi qua signed upload URL (server kiểm tra quyền trước khi cấp), nên không mở quyền insert/delete cho client.
