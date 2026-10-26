-- The Stash: database schema
-- Run this whole file once in Supabase: SQL Editor > New query > paste > Run.
-- Already ran an older version? Run reset.sql first, then this file.

-- ============================================================
-- STEP 1: replace YOUR_EMAIL@example.com below with the email you will
-- sign up with as @daphuq_. Only an account with that email can take the
-- username daphuq_, and it becomes the founding account with support tools.
-- ============================================================
create table if not exists public.stash_settings (
  id boolean primary key default true check (id),
  founder_username text not null default 'daphuq_',
  founder_email text not null
);
insert into public.stash_settings (founder_email) values ('demoryaejefferson@gmail.com')
on conflict (id) do nothing;
-- To change it later:  update public.stash_settings set founder_email = 'you@example.com';
alter table public.stash_settings enable row level security; -- no policies: the site can't read or change it

-- ---------- profiles (people and channels) ----------
-- kind 'personal': someone's own profile. People follow it.
-- kind 'channel':  people subscribe to it. Run by its manager.
create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references auth.users(id) on delete cascade,
  manager_id uuid not null references auth.users(id) on delete cascade,
  kind text not null default 'personal' check (kind in ('personal','channel')),
  is_founder boolean not null default false,
  username text not null,
  display_name text not null default '',
  bio text not null default '',
  links jsonb not null default '[]'::jsonb,
  avatar_path text,
  banner_path text,
  banner_preset text,
  created_at timestamptz not null default now(),
  constraint username_format check (username ~ '^[a-z0-9_][a-z0-9_.]{2,23}$'),
  constraint display_name_len check (char_length(display_name) <= 50),
  constraint bio_len check (char_length(bio) <= 300),
  constraint links_is_array check (jsonb_typeof(links) = 'array' and jsonb_array_length(links) <= 5),
  constraint banner_preset_len check (banner_preset is null or char_length(banner_preset) <= 40)
);
create unique index if not exists profiles_username_key on public.profiles (lower(username));
create index if not exists profiles_manager_idx on public.profiles(manager_id);

create table if not exists public.videos (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 100),
  description text not null default '' check (char_length(description) <= 5000),
  video_path text not null,
  thumb_path text,
  thumb_time real,
  duration integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists videos_created_idx on public.videos(created_at desc);
create index if not exists videos_owner_idx on public.videos(owner_id);

create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references public.videos(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index if not exists comments_video_idx on public.comments(video_id, created_at desc);
create index if not exists comments_author_idx on public.comments(author_id);

create table if not exists public.likes (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  video_id uuid not null references public.videos(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (profile_id, video_id)
);
create index if not exists likes_video_idx on public.likes(video_id);

create table if not exists public.follows (
  follower_id uuid not null references public.profiles(id) on delete cascade,
  followee_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, followee_id),
  constraint no_self_follow check (follower_id <> followee_id)
);
create index if not exists follows_followee_idx on public.follows(followee_id);

create table if not exists public.subscriptions (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  channel_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (profile_id, channel_id),
  constraint no_self_sub check (profile_id <> channel_id)
);
create index if not exists subscriptions_channel_idx on public.subscriptions(channel_id);

create table if not exists public.playlists (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists playlists_owner_idx on public.playlists(owner_id);

create table if not exists public.playlist_items (
  playlist_id uuid not null references public.playlists(id) on delete cascade,
  video_id uuid not null references public.videos(id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (playlist_id, video_id)
);

-- ---------- helper functions ----------
create or replace function public.is_me(pid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = pid and user_id = auth.uid());
$$;
create or replace function public.manages(pid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = pid and manager_id = auth.uid());
$$;
create or replace function public.is_founder() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where user_id = auth.uid() and is_founder);
$$;
create or replace function public.profile_kind(pid uuid) returns text
language sql stable security definer set search_path = public as $$
  select kind from public.profiles where id = pid;
$$;

-- Stops people changing their own kind, owner or founder status,
-- and reserves the founder username for the founder email.
create or replace function public.profiles_guard() returns trigger
language plpgsql security definer set search_path = public, auth as $$
declare
  admin_call boolean := coalesce(current_setting('stash.admin', true), '') = 'on';
  f_user text;
  f_email text;
begin
  if tg_op = 'INSERT' then
    if not admin_call then
      new.kind := 'personal'; new.is_founder := false;
      new.user_id := auth.uid(); new.manager_id := auth.uid();
    end if;
  else
    if not admin_call then
      new.kind := old.kind; new.user_id := old.user_id; new.manager_id := old.manager_id; new.is_founder := old.is_founder;
    end if;
  end if;
  select founder_username, founder_email into f_user, f_email from public.stash_settings limit 1;
  if f_user is not null and lower(new.username) = lower(f_user)
     and (tg_op = 'INSERT' or lower(old.username) <> lower(new.username)) then
    if new.user_id is null or not exists (select 1 from auth.users u where u.id = new.user_id and lower(u.email) = lower(f_email)) then
      raise exception 'That username is reserved.' using errcode = 'P0001';
    end if;
    new.is_founder := true;
  end if;
  return new;
end $$;
drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard before insert or update on public.profiles for each row execute function public.profiles_guard();

-- ---------- support tools (founding account only) ----------
-- Turn a profile into a channel, or back. Followers become subscribers and vice versa.
create or replace function public.stash_set_kind(p_profile uuid, p_kind text) returns void
language plpgsql security definer set search_path = public as $$
declare
  p_user uuid; p_cur text;
begin
  if not public.is_founder() then raise exception 'Only support can do this.' using errcode = 'P0001'; end if;
  if p_kind not in ('personal','channel') then raise exception 'Unknown profile type.' using errcode = 'P0001'; end if;
  select user_id, kind into p_user, p_cur from public.profiles where id = p_profile;
  if not found then raise exception 'Profile not found.' using errcode = 'P0001'; end if;
  if p_cur = p_kind then return; end if;
  if p_kind = 'personal' and p_user is null then
    raise exception 'This channel was created on its own, so it has no personal account to switch back to.' using errcode = 'P0001';
  end if;
  perform set_config('stash.admin', 'on', true);
  update public.profiles set kind = p_kind where id = p_profile;
  if p_kind = 'channel' then
    insert into public.subscriptions (profile_id, channel_id, created_at)
      select follower_id, followee_id, created_at from public.follows where followee_id = p_profile
      on conflict do nothing;
    delete from public.follows where followee_id = p_profile;
  else
    insert into public.follows (follower_id, followee_id, created_at)
      select profile_id, channel_id, created_at from public.subscriptions where channel_id = p_profile
      on conflict do nothing;
    delete from public.subscriptions where channel_id = p_profile;
  end if;
  perform set_config('stash.admin', 'off', true);
end $$;

-- Create a new channel profile run by an existing member.
create or replace function public.stash_create_channel(p_username text, p_display_name text, p_manager_username text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  m_user uuid; new_id uuid;
begin
  if not public.is_founder() then raise exception 'Only support can do this.' using errcode = 'P0001'; end if;
  select user_id into m_user from public.profiles where lower(username) = lower(p_manager_username) and user_id is not null;
  if m_user is null then raise exception 'No member has the username @%.', p_manager_username using errcode = 'P0001'; end if;
  perform set_config('stash.admin', 'on', true);
  insert into public.profiles (user_id, manager_id, kind, username, display_name)
    values (null, m_user, 'channel', lower(p_username), coalesce(nullif(trim(p_display_name), ''), lower(p_username)))
    returning id into new_id;
  perform set_config('stash.admin', 'off', true);
  return new_id;
end $$;

-- Hand a standalone channel to a different member.
create or replace function public.stash_set_manager(p_channel uuid, p_manager_username text) returns void
language plpgsql security definer set search_path = public as $$
declare
  m_user uuid; c_kind text; c_user uuid;
begin
  if not public.is_founder() then raise exception 'Only support can do this.' using errcode = 'P0001'; end if;
  select kind, user_id into c_kind, c_user from public.profiles where id = p_channel;
  if not found or c_kind <> 'channel' or c_user is not null then raise exception 'Only standalone channels can change manager.' using errcode = 'P0001'; end if;
  select user_id into m_user from public.profiles where lower(username) = lower(p_manager_username) and user_id is not null;
  if m_user is null then raise exception 'No member has the username @%.', p_manager_username using errcode = 'P0001'; end if;
  perform set_config('stash.admin', 'on', true);
  update public.profiles set manager_id = m_user where id = p_channel;
  perform set_config('stash.admin', 'off', true);
end $$;

revoke all on function public.stash_set_kind(uuid, text), public.stash_create_channel(text, text, text), public.stash_set_manager(uuid, text) from public, anon;
grant execute on function public.stash_set_kind(uuid, text), public.stash_create_channel(text, text, text), public.stash_set_manager(uuid, text) to authenticated;

-- ---------- views with counts ----------
create or replace view public.video_feed with (security_invoker = true) as
  select v.*,
    (select count(*) from public.likes l where l.video_id = v.id)::int as like_count,
    (select count(*) from public.comments c where c.video_id = v.id)::int as comment_count
  from public.videos v;

create or replace view public.profile_stats with (security_invoker = true) as
  select p.id,
    (select count(*) from public.follows f where f.followee_id = p.id)::int as followers,
    (select count(*) from public.follows f where f.follower_id = p.id)::int as following,
    (select count(*) from public.subscriptions s where s.channel_id = p.id)::int as subscribers,
    (select count(*) from public.videos v where v.owner_id = p.id)::int as video_count
  from public.profiles p;

grant select on public.video_feed, public.profile_stats to anon, authenticated;

-- ---------- row level security ----------
alter table public.profiles enable row level security;
alter table public.videos enable row level security;
alter table public.comments enable row level security;
alter table public.likes enable row level security;
alter table public.follows enable row level security;
alter table public.subscriptions enable row level security;
alter table public.playlists enable row level security;
alter table public.playlist_items enable row level security;

do $$
declare t text;
begin
  foreach t in array array['profiles','videos','comments','likes','follows','subscriptions','playlists','playlist_items'] loop
    execute format('drop policy if exists "Anyone can read" on public.%I', t);
    execute format('create policy "Anyone can read" on public.%I for select using (true)', t);
  end loop;
end $$;

drop policy if exists "Create own profile" on public.profiles;
create policy "Create own profile" on public.profiles for insert to authenticated with check (user_id = auth.uid() and manager_id = auth.uid());
drop policy if exists "Edit managed profile" on public.profiles;
create policy "Edit managed profile" on public.profiles for update to authenticated using (manager_id = auth.uid()) with check (manager_id = auth.uid());

drop policy if exists "Post video" on public.videos;
create policy "Post video" on public.videos for insert to authenticated with check (public.manages(owner_id));
drop policy if exists "Edit video" on public.videos;
create policy "Edit video" on public.videos for update to authenticated using (public.manages(owner_id)) with check (public.manages(owner_id));
drop policy if exists "Delete video" on public.videos;
create policy "Delete video" on public.videos for delete to authenticated using (public.manages(owner_id));

drop policy if exists "Post comment" on public.comments;
create policy "Post comment" on public.comments for insert to authenticated with check (public.is_me(author_id));
drop policy if exists "Delete comment" on public.comments;
create policy "Delete comment" on public.comments for delete to authenticated
  using (public.is_me(author_id) or exists (select 1 from public.videos v where v.id = video_id and public.manages(v.owner_id)));

drop policy if exists "Like" on public.likes;
create policy "Like" on public.likes for insert to authenticated with check (public.is_me(profile_id));
drop policy if exists "Unlike" on public.likes;
create policy "Unlike" on public.likes for delete to authenticated using (public.is_me(profile_id));

-- People are followed; channels are subscribed to.
drop policy if exists "Follow" on public.follows;
create policy "Follow" on public.follows for insert to authenticated
  with check (public.is_me(follower_id) and public.profile_kind(followee_id) = 'personal');
drop policy if exists "Unfollow" on public.follows;
create policy "Unfollow" on public.follows for delete to authenticated using (public.is_me(follower_id));

drop policy if exists "Subscribe" on public.subscriptions;
create policy "Subscribe" on public.subscriptions for insert to authenticated
  with check (public.is_me(profile_id) and public.profile_kind(channel_id) = 'channel' and not public.manages(channel_id));
drop policy if exists "Unsubscribe" on public.subscriptions;
create policy "Unsubscribe" on public.subscriptions for delete to authenticated using (public.is_me(profile_id));

drop policy if exists "Create playlist" on public.playlists;
create policy "Create playlist" on public.playlists for insert to authenticated with check (public.is_me(owner_id));
drop policy if exists "Edit playlist" on public.playlists;
create policy "Edit playlist" on public.playlists for update to authenticated using (public.is_me(owner_id)) with check (public.is_me(owner_id));
drop policy if exists "Delete playlist" on public.playlists;
create policy "Delete playlist" on public.playlists for delete to authenticated using (public.is_me(owner_id));

drop policy if exists "Add to own playlist" on public.playlist_items;
create policy "Add to own playlist" on public.playlist_items for insert to authenticated
  with check (exists (select 1 from public.playlists p where p.id = playlist_id and public.is_me(p.owner_id)));
drop policy if exists "Remove from own playlist" on public.playlist_items;
create policy "Remove from own playlist" on public.playlist_items for delete to authenticated
  using (exists (select 1 from public.playlists p where p.id = playlist_id and public.is_me(p.owner_id)));

-- ---------- storage ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('videos', 'videos', true, 52428800, array['video/mp4','video/webm']),
  ('images', 'images', true, 10485760, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Stash public files" on storage.objects;
create policy "Stash public files" on storage.objects for select using (bucket_id in ('videos','images'));
drop policy if exists "Stash upload own folder" on storage.objects;
create policy "Stash upload own folder" on storage.objects for insert to authenticated
  with check (bucket_id in ('videos','images') and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "Stash update own folder" on storage.objects;
create policy "Stash update own folder" on storage.objects for update to authenticated
  using (bucket_id in ('videos','images') and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "Stash delete own folder" on storage.objects;
create policy "Stash delete own folder" on storage.objects for delete to authenticated
  using (bucket_id in ('videos','images') and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------- sign in with username ----------
-- Checks a username + password and, only if they match, returns that
-- account's email so the site can finish signing in. Wrong guesses return
-- nothing (same as an unknown username), and repeated failures for one
-- username are paused for 15 minutes.
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.login_throttle (
  username text primary key,
  fails integer not null default 0,
  window_start timestamptz not null default now()
);
alter table public.login_throttle enable row level security; -- no policies: only the function below touches it

create or replace function public.stash_username_login(p_username text, p_password text) returns text
language plpgsql volatile security definer set search_path = public, extensions, auth as $$
declare
  u text := lower(trim(both from regexp_replace(coalesce(p_username, ''), '^@', '')));
  t record;
  em text; hash text;
  ok boolean := false;
begin
  if u = '' or coalesce(p_password, '') = '' then return null; end if;
  select * into t from public.login_throttle where username = u;
  if found and t.window_start > now() - interval '15 minutes' and t.fails >= 8 then
    raise exception 'Too many tries for this username. Wait 15 minutes, or sign in with your email.' using errcode = 'P0001';
  end if;
  select au.email, au.encrypted_password into em, hash
    from public.profiles p join auth.users au on au.id = p.user_id
    where lower(p.username) = u and p.user_id is not null;
  if hash is not null and hash <> '' then
    ok := extensions.crypt(p_password, hash) = hash;
  else
    perform extensions.crypt(p_password, extensions.gen_salt('bf', 10)); -- keep timing similar for unknown usernames
  end if;
  if ok then
    delete from public.login_throttle where username = u;
    return em;
  end if;
  insert into public.login_throttle as lt (username, fails, window_start) values (u, 1, now())
    on conflict (username) do update set
      fails = case when lt.window_start > now() - interval '15 minutes' then lt.fails + 1 else 1 end,
      window_start = case when lt.window_start > now() - interval '15 minutes' then lt.window_start else now() end;
  return null;
end $$;
revoke all on function public.stash_username_login(text, text) from public;
grant execute on function public.stash_username_login(text, text) to anon, authenticated;
