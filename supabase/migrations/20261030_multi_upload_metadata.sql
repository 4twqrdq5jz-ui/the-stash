-- Add multiple categories and named jump-to-action points without resetting data.
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

alter table public.video_categories enable row level security;
alter table public.video_actions enable row level security;

create or replace function public.video_is_live(vid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (select 1 from public.video_models m where m.video_id = vid and m.status = 'pending')
     and (not exists (select 1 from public.video_models m where m.video_id = vid)
          or exists (select 1 from public.video_models m where m.video_id = vid and m.status = 'approved'));
$$;

create or replace view public.video_feed with (security_invoker = true) as
  select v.*,
    (select count(*) from public.likes l where l.video_id = v.id)::int as like_count,
    (select count(*) from public.dislikes d where d.video_id = v.id)::int as dislike_count,
    (select count(*) from public.comments c where c.video_id = v.id)::int as comment_count,
    coalesce(
      (select array_agg(vc.category_id order by vc.category_id) from public.video_categories vc where vc.video_id = v.id),
      case when v.category_id is null then array[]::uuid[] else array[v.category_id] end
    ) as category_ids
  from public.videos v;

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

notify pgrst, 'reload schema';
