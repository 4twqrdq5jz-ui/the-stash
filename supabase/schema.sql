-- The Stash: database schema
-- Run this whole file once in Supabase: SQL Editor > New query > paste > Run.
-- Existing install? Apply the additive scripts in migrations/ instead. reset.sql deletes all Stash data.

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
insert into public.stash_settings (founder_email) values ('YOUR_EMAIL@example.com')
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
  is_model boolean not null default false,
  is_verified boolean not null default false,
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
alter table public.profiles add column if not exists is_model boolean not null default false;
alter table public.profiles add column if not exists is_verified boolean not null default false;
create unique index if not exists profiles_username_key on public.profiles (lower(username));

-- ---------- categories ----------
create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,39}$'),
  name text not null check (char_length(name) between 1 and 40),
  created_at timestamptz not null default now()
);
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
alter table public.videos add column if not exists category_id uuid references public.categories(id) on delete set null;
alter table public.videos add column if not exists action_time real;
alter table public.videos add column if not exists sources jsonb not null default '[]'::jsonb; -- extra qualities: [{"label":"720p","path":"..."}]
-- The uploader's declaration that everyone in the video is 18+, verified, and consented.
alter table public.videos add column if not exists consent_attested_at timestamptz;
create index if not exists videos_created_idx on public.videos(created_at desc);
create index if not exists videos_category_idx on public.videos(category_id);
create index if not exists videos_owner_idx on public.videos(owner_id);

create table if not exists public.video_categories (
  video_id uuid not null references public.videos(id) on delete cascade,
  category_id uuid not null references public.categories(id) on delete cascade,
  primary key (video_id, category_id)
);
create index if not exists video_categories_category_idx on public.video_categories(category_id, video_id);
insert into public.video_categories (video_id, category_id)
  select id, category_id from public.videos where category_id is not null
on conflict do nothing;

create table if not exists public.video_actions (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references public.videos(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  action_time real not null check (action_time >= 0),
  created_at timestamptz not null default now()
);
create index if not exists video_actions_video_idx on public.video_actions(video_id, action_time);

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

create table if not exists public.favorites (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  video_id uuid not null references public.videos(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (profile_id, video_id)
);
create table if not exists public.dislikes (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  video_id uuid not null references public.videos(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (profile_id, video_id)
);
create index if not exists dislikes_video_idx on public.dislikes(video_id);

create table if not exists public.clips (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references public.videos(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  title text not null default '' check (char_length(title) <= 100),
  start_s real not null check (start_s >= 0),
  end_s real not null,
  created_at timestamptz not null default now(),
  constraint clip_length check (end_s - start_s >= 1 and end_s - start_s <= 60)
);
create index if not exists clips_owner_idx on public.clips(owner_id);

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  video_id uuid references public.videos(id) on delete set null,
  video_title text not null default '',
  reporter_id uuid references public.profiles(id) on delete set null,
  contact text not null default '' check (char_length(contact) <= 200),
  reason text not null check (reason in ('minor','nonconsensual','me_no_consent','copyright','spam','violence','other')),
  details text not null default '' check (char_length(details) <= 2000),
  status text not null default 'open' check (status in ('open','resolved')),
  created_at timestamptz not null default now()
);

-- ---------- models ----------
-- Members apply to be models. The founding account checks their ID and age, then approves.
create table if not exists public.model_applications (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  stage_name text not null check (char_length(stage_name) between 1 and 50),
  legal_name text not null check (char_length(legal_name) between 2 and 120),
  date_of_birth date not null,
  id_path text not null,
  selfie_path text not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  note text not null default '',
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  constraint adult check (date_of_birth <= (current_date - interval '18 years'))
);
create unique index if not exists one_pending_application on public.model_applications(profile_id) where status = 'pending';

-- Models tagged in videos. A tag only shows once the model approves it.
create table if not exists public.video_models (
  video_id uuid not null references public.videos(id) on delete cascade,
  model_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','approved')),
  created_at timestamptz not null default now(),
  primary key (video_id, model_id)
);
create index if not exists video_models_model_idx on public.video_models(model_id);

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

-- Stops people changing their own kind, owner, verification status,
-- and reserves the founder and website usernames.
create or replace function public.profiles_guard() returns trigger
language plpgsql security definer set search_path = public, auth as $$
declare
  admin_call boolean := coalesce(current_setting('stash.admin', true), '') = 'on';
  f_user text;
  f_email text;
begin
  if tg_op = 'INSERT' then
    if not admin_call then
      new.kind := 'personal'; new.is_founder := false; new.is_model := false; new.is_verified := false;
      new.user_id := auth.uid(); new.manager_id := auth.uid();
    end if;
  else
    if not admin_call then
      new.kind := old.kind; new.user_id := old.user_id; new.manager_id := old.manager_id; new.is_founder := old.is_founder; new.is_model := old.is_model;
      new.is_verified := old.is_verified;
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
  if lower(new.username) = 'thestash'
     and (tg_op = 'INSERT' or lower(old.username) <> 'thestash')
     and not admin_call then
    raise exception 'That username is reserved.' using errcode = 'P0001';
  end if;
  new.is_verified := new.is_founder or new.is_model
    or (lower(new.username) = 'thestash' and (admin_call or (tg_op = 'UPDATE' and old.is_verified)));
  return new;
end $$;
drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard before insert or update on public.profiles for each row execute function public.profiles_guard();

create or replace function public.follow_founder_for_new_profile() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.kind <> 'personal' or new.user_id is null then return new; end if;
  insert into public.follows (follower_id, followee_id)
    select new.id, p.id from public.profiles p
    where p.is_founder and p.id <> new.id
  on conflict do nothing;
  return new;
end $$;
drop trigger if exists follow_founder_for_new_profile on public.profiles;
create trigger follow_founder_for_new_profile after insert on public.profiles
  for each row execute function public.follow_founder_for_new_profile();

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
  if coalesce(trim(p_manager_username), '') = '' then
    m_user := auth.uid();
  else
    select user_id into m_user from public.profiles where lower(username) = lower(p_manager_username) and user_id is not null;
    if m_user is null then raise exception 'No member has the username @%.', p_manager_username using errcode = 'P0001'; end if;
  end if;
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

-- Approve or reject a model application.
create or replace function public.stash_review_model(p_application uuid, p_approve boolean, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare
  a_profile uuid; a_status text;
begin
  if not public.is_founder() then raise exception 'Only support can do this.' using errcode = 'P0001'; end if;
  select profile_id, status into a_profile, a_status from public.model_applications where id = p_application;
  if not found then raise exception 'Application not found.' using errcode = 'P0001'; end if;
  update public.model_applications set status = case when p_approve then 'approved' else 'rejected' end,
    note = coalesce(p_note, ''), reviewed_at = now() where id = p_application;
  perform set_config('stash.admin', 'on', true);
  update public.profiles set is_model = p_approve where id = a_profile;
  perform set_config('stash.admin', 'off', true);
end $$;

-- Remove someone's model status.
create or replace function public.stash_set_model(p_profile uuid, p_is_model boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_founder() then raise exception 'Only support can do this.' using errcode = 'P0001'; end if;
  perform set_config('stash.admin', 'on', true);
  update public.profiles set is_model = p_is_model where id = p_profile;
  perform set_config('stash.admin', 'off', true);
end $$;

-- Tags are approved automatically when models tag themselves; otherwise the model must approve.
create or replace function public.video_models_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.status := case when public.is_me(new.model_id) then 'approved' else 'pending' end;
  elsif tg_op = 'UPDATE' then
    if not public.is_me(new.model_id) then new.status := old.status; end if;
    new.video_id := old.video_id; new.model_id := old.model_id;
  end if;
  return new;
end $$;
drop trigger if exists video_models_guard on public.video_models;
create trigger video_models_guard before insert or update on public.video_models for each row execute function public.video_models_guard();

revoke all on function public.stash_set_kind(uuid, text), public.stash_create_channel(text, text, text), public.stash_set_manager(uuid, text), public.stash_review_model(uuid, boolean, text), public.stash_set_model(uuid, boolean) from public, anon;
grant execute on function public.stash_set_kind(uuid, text), public.stash_create_channel(text, text, text), public.stash_set_manager(uuid, text), public.stash_review_model(uuid, boolean, text), public.stash_set_model(uuid, boolean) to authenticated;

-- ---------- views with counts ----------
drop view if exists public.video_feed;
create view public.video_feed with (security_invoker = true) as
  select v.*,
    (select count(*) from public.likes l where l.video_id = v.id)::int as like_count,
    (select count(*) from public.dislikes d where d.video_id = v.id)::int as dislike_count,
    (select count(*) from public.comments c where c.video_id = v.id)::int as comment_count,
    coalesce(
      (select array_agg(vc.category_id order by vc.category_id) from public.video_categories vc where vc.video_id = v.id),
      case when v.category_id is null then array[]::uuid[] else array[v.category_id] end
    ) as category_ids
  from public.videos v;

drop view if exists public.profile_stats;
create view public.profile_stats with (security_invoker = true) as
  select p.id,
    (select count(*) from public.follows f where f.followee_id = p.id)::int as followers,
    (select count(*) from public.follows f where f.follower_id = p.id)::int as following,
    (select count(*) from public.subscriptions s where s.channel_id = p.id)::int as subscribers,
    (select count(*) from public.videos v where v.owner_id = p.id)::int as video_count,
    (select count(*) from public.video_models m where m.model_id = p.id and m.status = 'approved')::int as featured_count
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
alter table public.categories enable row level security;
alter table public.video_categories enable row level security;
alter table public.video_actions enable row level security;
alter table public.favorites enable row level security;
alter table public.dislikes enable row level security;
alter table public.clips enable row level security;
alter table public.reports enable row level security;
alter table public.model_applications enable row level security;
alter table public.video_models enable row level security;

do $$
declare t text;
begin
  foreach t in array array['profiles','comments','likes','follows','subscriptions','playlists','playlist_items','categories','favorites','dislikes','clips'] loop
    execute format('drop policy if exists "Anyone can read" on public.%I', t);
    execute format('create policy "Anyone can read" on public.%I for select using (true)', t);
  end loop;
end $$;

drop policy if exists "Create own profile" on public.profiles;
create policy "Create own profile" on public.profiles for insert to authenticated with check (user_id = auth.uid() and manager_id = auth.uid());
drop policy if exists "Edit managed profile" on public.profiles;
create policy "Edit managed profile" on public.profiles for update to authenticated using (manager_id = auth.uid()) with check (manager_id = auth.uid());

-- Videos without model tags are public; tagged videos stay private until all tags are approved.
create or replace function public.video_is_live(vid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (select 1 from public.video_models m where m.video_id = vid and m.status = 'pending')
     and (not exists (select 1 from public.video_models m where m.video_id = vid)
          or exists (select 1 from public.video_models m where m.video_id = vid and m.status = 'approved'));
$$;
create or replace function public.is_tagged_in(vid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.video_models m where m.video_id = vid and public.is_me(m.model_id));
$$;
create or replace function public.can_upload() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where user_id = auth.uid() and (is_model or is_founder));
$$;
drop policy if exists "Anyone can read" on public.videos;
drop policy if exists "Read live videos" on public.videos;
create policy "Read live videos" on public.videos for select
  using (public.video_is_live(id) or public.manages(owner_id) or public.is_tagged_in(id) or public.is_founder());

-- Only verified models (and the founder) can upload, and only with the age and consent declaration.
drop policy if exists "Post video" on public.videos;
create policy "Post video" on public.videos for insert to authenticated
  with check (public.manages(owner_id) and public.can_upload() and consent_attested_at is not null);
drop policy if exists "Edit video" on public.videos;
create policy "Edit video" on public.videos for update to authenticated using (public.manages(owner_id)) with check (public.manages(owner_id));
drop policy if exists "Delete video" on public.videos;
create policy "Delete video" on public.videos for delete to authenticated using (public.manages(owner_id) or public.is_founder());

drop policy if exists "Read video categories" on public.video_categories;
create policy "Read video categories" on public.video_categories for select
  using (public.video_is_live(video_id) or exists (select 1 from public.videos v where v.id = video_id and public.manages(v.owner_id)) or public.is_founder());
drop policy if exists "Add video categories" on public.video_categories;
create policy "Add video categories" on public.video_categories for insert to authenticated
  with check (exists (select 1 from public.videos v where v.id = video_id and public.manages(v.owner_id)));
drop policy if exists "Remove video categories" on public.video_categories;
create policy "Remove video categories" on public.video_categories for delete to authenticated
  using (exists (select 1 from public.videos v where v.id = video_id and public.manages(v.owner_id)) or public.is_founder());

drop policy if exists "Read video actions" on public.video_actions;
create policy "Read video actions" on public.video_actions for select
  using (public.video_is_live(video_id) or exists (select 1 from public.videos v where v.id = video_id and public.manages(v.owner_id)) or public.is_founder());
drop policy if exists "Add video actions" on public.video_actions;
create policy "Add video actions" on public.video_actions for insert to authenticated
  with check (exists (select 1 from public.videos v where v.id = video_id and public.manages(v.owner_id)));
drop policy if exists "Remove video actions" on public.video_actions;
create policy "Remove video actions" on public.video_actions for delete to authenticated
  using (exists (select 1 from public.videos v where v.id = video_id and public.manages(v.owner_id)) or public.is_founder());

drop policy if exists "Post comment" on public.comments;
create policy "Post comment" on public.comments for insert to authenticated with check (public.is_me(author_id));
drop policy if exists "Delete comment" on public.comments;
create policy "Delete comment" on public.comments for delete to authenticated
  using (public.is_me(author_id) or public.is_founder() or exists (select 1 from public.videos v where v.id = video_id and public.manages(v.owner_id)));

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
  ('videos', 'videos', true, 1073741824, array['video/*']),
  ('images', 'images', true, 10485760, array['image/jpeg','image/png','image/webp']),
  ('verification', 'verification', false, 10485760, array['image/jpeg','image/png','image/webp','application/pdf'])
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


-- ---------- policies for categories, favorites, clips, reports and models ----------
drop policy if exists "Founder adds categories" on public.categories;
create policy "Founder adds categories" on public.categories for insert to authenticated with check (public.is_founder());
drop policy if exists "Founder edits categories" on public.categories;
create policy "Founder edits categories" on public.categories for update to authenticated using (public.is_founder()) with check (public.is_founder());
drop policy if exists "Founder deletes categories" on public.categories;
create policy "Founder deletes categories" on public.categories for delete to authenticated using (public.is_founder());

drop policy if exists "Favorite" on public.favorites;
create policy "Favorite" on public.favorites for insert to authenticated with check (public.is_me(profile_id));
drop policy if exists "Unfavorite" on public.favorites;
create policy "Unfavorite" on public.favorites for delete to authenticated using (public.is_me(profile_id));

drop policy if exists "Dislike" on public.dislikes;
create policy "Dislike" on public.dislikes for insert to authenticated with check (public.is_me(profile_id));
drop policy if exists "Undislike" on public.dislikes;
create policy "Undislike" on public.dislikes for delete to authenticated using (public.is_me(profile_id));

drop policy if exists "Make clip" on public.clips;
create policy "Make clip" on public.clips for insert to authenticated with check (public.is_me(owner_id));
drop policy if exists "Delete clip" on public.clips;
create policy "Delete clip" on public.clips for delete to authenticated using (public.is_me(owner_id));

-- Anyone, even without an account, can report a video. Only the founder can read reports.
drop policy if exists "Send report" on public.reports;
create policy "Send report" on public.reports for insert to anon, authenticated
  with check (status = 'open' and (reporter_id is null or public.is_me(reporter_id)));
drop policy if exists "Founder reads reports" on public.reports;
create policy "Founder reads reports" on public.reports for select to authenticated using (public.is_founder());
drop policy if exists "Founder resolves reports" on public.reports;
create policy "Founder resolves reports" on public.reports for update to authenticated using (public.is_founder()) with check (public.is_founder());

drop policy if exists "Apply as model" on public.model_applications;
create policy "Apply as model" on public.model_applications for insert to authenticated
  with check (public.is_me(profile_id) and user_id = auth.uid() and status = 'pending' and note = '' and reviewed_at is null);
drop policy if exists "See own or review applications" on public.model_applications;
create policy "See own or review applications" on public.model_applications for select to authenticated
  using (user_id = auth.uid() or public.is_founder());

-- Approved tags are public; pending ones are visible to the uploader and the model.
drop policy if exists "Read model tags" on public.video_models;
create policy "Read model tags" on public.video_models for select
  using (status = 'approved' or public.is_me(model_id) or exists (select 1 from public.videos v where v.id = video_id and public.manages(v.owner_id)));
drop policy if exists "Tag a model" on public.video_models;
create policy "Tag a model" on public.video_models for insert to authenticated
  with check (exists (select 1 from public.videos v where v.id = video_id and public.manages(v.owner_id))
              and exists (select 1 from public.profiles p where p.id = model_id and p.is_model));
drop policy if exists "Model approves tag" on public.video_models;
create policy "Model approves tag" on public.video_models for update to authenticated using (public.is_me(model_id)) with check (public.is_me(model_id));
drop policy if exists "Remove model tag" on public.video_models;
create policy "Remove model tag" on public.video_models for delete to authenticated
  using (public.is_me(model_id) or public.is_founder() or exists (select 1 from public.videos v where v.id = video_id and public.manages(v.owner_id)));

-- ID documents: private. Members upload to their own folder; only they and the founder can view.
drop policy if exists "Upload own ID" on storage.objects;
create policy "Upload own ID" on storage.objects for insert to authenticated
  with check (bucket_id = 'verification' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "View own ID or review" on storage.objects;
create policy "View own ID or review" on storage.objects for select to authenticated
  using (bucket_id = 'verification' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_founder()));

-- Starter categories (the founder can add, rename or remove these on the Admin page).
insert into public.categories (slug, name) values
  ('solo', 'Solo'), ('couples', 'Couples'), ('amateur', 'Amateur'), ('bears', 'Bears'), ('twinks', 'Twinks'),
  ('daddies', 'Daddies'), ('muscle', 'Muscle'), ('jocks', 'Jocks'), ('behind-the-scenes', 'Behind the scenes')
on conflict (slug) do nothing;
