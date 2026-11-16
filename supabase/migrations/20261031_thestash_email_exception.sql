create or replace function public.profiles_guard() returns trigger
language plpgsql security definer set search_path = public, auth as $$
declare
  admin_call boolean := coalesce(current_setting('stash.admin', true), '') = 'on';
  thestash_owner boolean;
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
  select exists (
    select 1 from auth.users u
    where u.id = new.user_id and lower(u.email) = 'busks-shed.3y@icloud.com'
  ) into thestash_owner;
  if lower(new.username) = 'thestash'
     and (tg_op = 'INSERT' or lower(old.username) <> 'thestash')
     and not admin_call and not thestash_owner then
    raise exception 'That username is reserved.' using errcode = 'P0001';
  end if;
  new.is_verified := new.is_founder or new.is_model
    or (lower(new.username) = 'thestash' and (admin_call or thestash_owner or (tg_op = 'UPDATE' and old.is_verified)));
  return new;
end $$;
