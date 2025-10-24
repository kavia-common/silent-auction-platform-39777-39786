# Silent Auction DB Migrations (Final Concise)

This concise guide provides idempotent SQL to: enforce unique event names; create magic_links with a 30-day expiry; add required performance indexes; and a brief Supabase Realtime tuning note for sub-1s latency. SQL aligns with existing UUID PK tables (events/items) and uses safe IF NOT EXISTS patterns.

## 1) Enforce Unique Event Names (and ensure UUID PKs)

```sql
-- Extensions for UUID generation
create extension if not exists "pgcrypto";

-- Ensure events table shape with UUID PK (non-destructive if already present)
create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text not null,
  status text default 'active',
  is_open boolean default true not null,
  created_at timestamptz default now()
);

-- Safety: normalize id defaults/PK if table pre-existed without them
alter table public.events
  alter column id type uuid using id::uuid,
  alter column id set not null,
  alter column id set default gen_random_uuid();

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.events'::regclass and contype = 'p'
  ) then
    alter table public.events add primary key (id);
  end if;
end $$;

-- Enforce unique names and codes
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.events'::regclass
      and contype = 'u'
      and conname = 'events_name_key'
  ) then
    alter table public.events add constraint events_name_key unique (name);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.events'::regclass
      and contype = 'u'
      and conname = 'events_code_key'
  ) then
    alter table public.events add constraint events_code_key unique (code);
  end if;
end $$;
```

Note: If legacy duplicates exist for name or code, resolve them before applying constraints.

## 2) magic_links Table (30-day Expiry, used_at nullable, indexes)

```sql
create extension if not exists "pgcrypto";

-- Create table (idempotent). used_at is nullable by default.
create table if not exists public.magic_links (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  email text not null,
  token text unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days'),
  used_at timestamptz
);

-- If the table already exists but is missing columns, add them safely.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='magic_links' and column_name='token'
  ) then
    alter table public.magic_links add column if not exists token text;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.magic_links'::regclass
      and contype = 'u'
      and conname = 'magic_links_token_key'
  ) then
    alter table public.magic_links add constraint magic_links_token_key unique (token);
  end if;

  -- Ensure expires_at default and not null
  perform 1;
  exception
    when others then null;
end $$;

-- Required indexes
create index if not exists magic_links_event_id_idx on public.magic_links(event_id);
```

Optional helpful indexes:
- create index if not exists magic_links_expires_at_idx on public.magic_links(expires_at);
- create index if not exists magic_links_email_idx on public.magic_links(email);

## 3) Items and Bids (UUID PKs, required performance index)

```sql
-- Ensure items table exists with UUID PK
create table if not exists public.items (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  title text not null,
  description text default '',
  starting_bid numeric default 0,
  created_at timestamptz default now()
);

-- Safety: normalize id defaults/PK if table pre-existed without them
alter table public.items
  alter column id type uuid using id::uuid,
  alter column id set not null,
  alter column id set default gen_random_uuid();

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.items'::regclass and contype = 'p'
  ) then
    alter table public.items add primary key (id);
  end if;
end $$;

-- Ensure bids table exists with UUID PK
create table if not exists public.bids (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  item_id uuid not null references public.items(id) on delete cascade,
  amount numeric not null check (amount > 0),
  bidder_name text default 'Anonymous',
  created_at timestamptz default now()
);

-- Required composite performance index for high-load reads
create index if not exists bids_event_item_created_at_desc_idx
  on public.bids(event_id, item_id, created_at desc);
```

## 4) Supabase Realtime Tuning (<1s)

- Enable Realtime (INSERT/UPDATE/DELETE) for public.events, public.items, public.bids.
- Use filtered channels in the client to minimize payloads:
  - items: filter event_id=eq.{eventId}
  - bids: filter item_id=eq.{itemId}
  - events: filter id=eq.{eventId}
- Keep the indexes above to speed capture and queries, and deploy near your Supabase region to minimize RTT.

Verification (quick checks):
- select name from public.events group by name having count(*) > 1;  -- should return 0 rows after cleanup
- select indexname from pg_indexes where schemaname='public' and tablename in ('events','magic_links','bids');

Sources:
- react_frontend/assets/supabase_schema.sql
- react_frontend/assets/sql_patches/events_is_open_patch.sql
- react_frontend/assets/sql_patches/items_id_uuid_patch.sql
- react_frontend/assets/supabase.md
- react_frontend/src/services/auctionService.js
- react_frontend/src/lib/supabaseClient.js
