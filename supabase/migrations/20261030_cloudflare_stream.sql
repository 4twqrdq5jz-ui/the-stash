-- Use Cloudflare Stream for new uploads and cross-browser HLS playback.
alter table public.videos add column if not exists stream_uid text unique;
alter table public.videos alter column video_path drop not null;

notify pgrst, 'reload schema';
