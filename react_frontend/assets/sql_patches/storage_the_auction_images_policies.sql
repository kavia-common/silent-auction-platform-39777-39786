-- Storage setup for bucket 'the-auction-images'
-- Goal:
--  - Ensure bucket exists and is public (read)
--  - Public read policy on storage.objects for this bucket
--  - Authenticated users can insert, update, delete, and list objects in this bucket
--  - No anonymous inserts (allow_anonymous_inserts = false)
--  - Idempotent: safe to re-run

-- 1) Ensure bucket exists (idempotent)
insert into storage.buckets (id, name, public)
values ('the-auction-images', 'the-auction-images', true)
on conflict (id) do update set public = excluded.public, name = excluded.name;

-- 2) Enable RLS on storage.objects (safe if already enabled)
-- Requires table owner privileges; may be no-op if not owner
do $$
begin
  begin
    execute 'alter table storage.objects enable row level security';
  exception when others then
    -- Ignore if lacking ownership
    null;
  end;
end$$;

-- 3) Upsert policies (requires table owner privileges).
-- Use guarded drops/creates to avoid duplicates.

-- Public read
do $pol$
begin
  if exists (
    select 1 from pg_policies p
    where p.schemaname = 'storage'
      and p.tablename = 'objects'
      and p.policyname = 'Public read objects for the-auction-images'
  ) then
    execute 'drop policy "Public read objects for the-auction-images" on storage.objects';
  end if;

  execute '
    create policy "Public read objects for the-auction-images"
    on storage.objects for select
    using (bucket_id = ''the-auction-images'')';
end
$pol$;

-- Authenticated list (explicit)
do $pol$
begin
  if exists (
    select 1 from pg_policies p
    where p.schemaname = 'storage'
      and p.tablename = 'objects'
      and p.policyname = 'Authenticated list objects for the-auction-images'
  ) then
    execute 'drop policy "Authenticated list objects for the-auction-images" on storage.objects';
  end if;

  execute '
    create policy "Authenticated list objects for the-auction-images"
    on storage.objects for select
    to authenticated
    using (bucket_id = ''the-auction-images'')';
end
$pol$;

-- Authenticated insert
do $pol$
begin
  if exists (
    select 1 from pg_policies p
    where p.schemaname = 'storage'
      and p.tablename = 'objects'
      and p.policyname = 'Authenticated insert objects for the-auction-images'
  ) then
    execute 'drop policy "Authenticated insert objects for the-auction-images" on storage.objects';
  end if;

  execute '
    create policy "Authenticated insert objects for the-auction-images"
    on storage.objects for insert
    to authenticated
    with check (bucket_id = ''the-auction-images'')';
end
$pol$;

-- Authenticated update
do $pol$
begin
  if exists (
    select 1 from pg_policies p
    where p.schemaname = 'storage'
      and p.tablename = 'objects'
      and p.policyname = 'Authenticated update objects for the-auction-images'
  ) then
    execute 'drop policy "Authenticated update objects for the-auction-images" on storage.objects';
  end if;

  execute '
    create policy "Authenticated update objects for the-auction-images"
    on storage.objects for update
    to authenticated
    using (bucket_id = ''the-auction-images'')
    with check (bucket_id = ''the-auction-images'')';
end
$pol$;

-- Authenticated delete
do $pol$
begin
  if exists (
    select 1 from pg_policies p
    where p.schemaname = 'storage'
      and p.tablename = 'objects'
      and p.policyname = 'Authenticated delete objects for the-auction-images'
  ) then
    execute 'drop policy "Authenticated delete objects for the-auction-images" on storage.objects';
  end if;

  execute '
    create policy "Authenticated delete objects for the-auction-images"
    on storage.objects for delete
    to authenticated
    using (bucket_id = ''the-auction-images'')';
end
$pol$;

-- Note: If you intend to allow anonymous inserts (e.g., unauthenticated uploads),
-- add the following policy. Currently disabled by requirement:
-- create policy "Anonymous insert objects for the-auction-images"
--   on storage.objects for insert
--   to anon
--   with check (bucket_id = 'the-auction-images');
