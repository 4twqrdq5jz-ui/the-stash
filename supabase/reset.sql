-- The Stash: reset
-- Only run this if you set up an older version of The Stash and want to start fresh.
-- It deletes ALL Stash data (profiles, videos, comments...). Uploaded files stay in
-- Storage; empty the "videos" and "images" buckets from the Storage page if you want them gone.
drop view if exists public.video_feed, public.channel_feed, public.profile_stats cascade;
drop table if exists public.playlist_items, public.playlists, public.subscriptions, public.follows,
  public.likes, public.comments, public.videos, public.channels, public.profiles, public.stash_settings cascade;
drop function if exists public.is_me(uuid), public.manages(uuid), public.is_founder(), public.profile_kind(uuid),
  public.profiles_guard(), public.stash_set_kind(uuid, text), public.stash_create_channel(text, text, text),
  public.stash_set_manager(uuid, text) cascade;
