-- Automatically follow the founder on new profiles and maintain trusted badges.
alter table public.profiles add column if not exists is_verified boolean not null default false;

update public.profiles
set is_verified = (is_founder or is_model or lower(username) = 'thestash')
where is_verified is distinct from (is_founder or is_model or lower(username) = 'thestash');

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
