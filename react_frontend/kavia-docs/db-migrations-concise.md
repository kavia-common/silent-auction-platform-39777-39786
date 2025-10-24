# Silent Auction DB Migrations (Concise)

This concise guide provides idempotent SQL to: enforce unique event names, create MagicLinks with 30-day expiry, add performance indexes, and a brief Realtime tuning note (<1s).

## 1) Enforce Unique Event Names

```sql
create extension if not exists "pgcrypto";

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text not null,
  status text default 'active',
  is_open boolean default true not null,
  created_at timestamptz default now()
);

-- Enforce unique names (and ensure code uniqueness)
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.events'::regclass
      and contype = 'u'
      and conname = 'events_name_key'
  ) then
    alter table public.events add constraint events_name_key unique (name);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.events'::regclass
      and contype = 'u'
      and conname = 'events_code_key'
  ) then
    alter table public.events add constraint events_code_key unique (code);
  end if;
end $$;
```

Note: If duplicates exist in legacy data, resolve them before applying the uniqueness constraint.

## 2) MagicLinks Table (30-day Expiry + Indexes)

```sql
create extension if not exists "pgcrypto";

create table if not exists public.magic_links (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  email text not null,
  token text unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days'),
  used_at timestamptz
);

-- Indexes required
create index if not exists magic_links_event_id_idx on public.magic_links(event_id);
-- token unique is already set as a unique constraint above
```

## 3) Anonymous Bidder Session IDs

Add a nullable text column to store an anonymous clientId from the browser on each bid.

```sql
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'bids'
      and column_name = 'bidder_session_id'
  ) then
    alter table public.bids add column bidder_session_id text;
  end if;
end $$;

create index if not exists bids_bidder_session_id_idx on public.bids(bidder_session_id);
```

Note: Frontend includes bidder_session_id on insert and gracefully retries without if the column is missing.

## 4) Performance Indexes for Items and Bids

```sql
-- Ensure tables exist
create table if not exists public.items (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  title text not null,
  description text default '',
  starting_bid numeric default 0,
  created_at timestamptz default now()
);

create table if not exists public.bids (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  item_id uuid not null references public.items(id) on delete cascade,
  amount numeric not null check (amount > 0),
  bidder_name text default 'Anonymous',
  created_at timestamptz default now()
);

-- Required performance indexes
-- (a) events.name unique: enforced above as events_name_key
-- (b) magic_links.token unique: enforced above in the table DDL
-- (c) magic_links.event_id index: created above
-- (d) composite bids index on (event_id, item_id, created_at desc)
create index if not exists bids_event_item_created_at_desc_idx
  on public.bids(event_id, item_id, created_at desc);
```

## 4) Supabase Realtime Tuning (<1s)

- Enable Realtime (INSERT/UPDATE/DELETE) for public.items, public.bids, public.events.
- Use filtered channels (event_id, item_id, id) to limit payload sizes; the frontend already applies these filters.
- Keep the above indexes to speed capture and queries, and deploy close to your Supabase region to minimize RTT.

Sources:
- react_frontend/assets/supabase_schema.sql
- react_frontend/assets/sql_patches/events_is_open_patch.sql
- react_frontend/assets/sql_patches/items_id_uuid_patch.sql
- react_frontend/assets/supabase.md
- react_frontend/src/services/auctionService.js
- react_frontend/src/lib/supabaseClient.js
