-- Patch: Ensure items.id is UUID with default gen_random_uuid and PK
-- Run this in Supabase SQL Editor if you get
-- "null value in column \"id\" of relation \"items\"" errors.

-- Enable extension for UUID generation (no-op if already enabled)
create extension if not exists "pgcrypto";

-- Make sure id is UUID, not null, and has default
alter table public.items
  alter column id type uuid using id::uuid,
  alter column id set not null,
  alter column id set default gen_random_uuid();

-- Ensure a primary key exists on id (idempotent)
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.items'::regclass and contype = 'p'
  ) then
    alter table public.items add primary key (id);
  end if;
end $$;
