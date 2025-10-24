-- Patch: Ensure events.is_open boolean exists with NOT NULL and DEFAULT true
-- Run this in Supabase SQL Editor if you see errors like:
-- "column events.is_open does not exist" when updating status from the host dashboard.
--
-- This patch is idempotent: it only adds/adjusts the column if needed.

do $$
begin
  -- Add column if missing
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'events'
      and column_name = 'is_open'
  ) then
    alter table public.events
      add column is_open boolean default true not null;
  else
    -- Ensure proper type, nullability, and default in case of drift
    alter table public.events
      alter column is_open type boolean using (case
        when is_open is null then true
        when is_open in ('t','true','1') then true
        when is_open in ('f','false','0') then false
        else coalesce(is_open::boolean, true)
      end),
      alter column is_open set default true,
      alter column is_open set not null;
  end if;
end $$;
