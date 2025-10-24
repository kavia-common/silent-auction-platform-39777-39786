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

do $$
begin
  if not exists (
    select 1 from pg_indexes
    where schemaname='public' and tablename='events' and indexname='events_name_key'
  ) then
    alter table public.events add constraint events_name_key unique (name);
  end if;

  if not exists (
    select 1 from pg_indexes
    where schemaname='public' and tablename='events' and indexname='events_code_key'
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

create index if not exists magic_links_event_id_idx on public.magic_links(event_id);
create index if not exists magic_links_email_idx on public.magic_links(email);
create index if not exists magic_links_expires_at_idx on public.magic_links(expires_at);
create index if not exists magic_links_active_partial_idx
  on public.magic_links (token)
  where used_at is null and expires_at > now();
```

## 3) Performance Indexes for Items and Bids

```sql
-- ITEMS
create table if not exists public.items (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  title text not null,
  description text default '',
  starting_bid numeric default 0,
  created_at timestamptz default now()
);
create index if not exists items_event_id_idx on public.items(event_id);
create index if not exists items_created_at_idx on public.items(created_at);

-- BIDS
create table if not exists public.bids (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  item_id uuid not null references public.items(id) on delete cascade,
  amount numeric not null check (amount > 0),
  bidder_name text default 'Anonymous',
  created_at timestamptz default now()
);
create index if not exists bids_item_id_idx on public.bids(item_id);
create index if not exists bids_event_id_idx on public.bids(event_id);
create index if not exists bids_item_amount_desc_idx on public.bids(item_id, amount desc);
create index if not exists bids_item_created_at_desc_idx on public.bids(item_id, created_at desc);
```

## 4) Supabase Realtime Tuning (<1s)

- Enable Realtime (INSERT/UPDATE/DELETE) for public.items, public.bids, public.events.
- Use filtered channels (event_id/item_id/id) to limit payloads; the frontend already does this.
- Keep indexes above to speed capture/queries, and host close to your Supabase region to minimize RTT.

Sources:
- react_frontend/assets/supabase_schema.sql
- react_frontend/assets/sql_patches/events_is_open_patch.sql
- react_frontend/assets/sql_patches/items_id_uuid_patch.sql
- react_frontend/assets/supabase.md
- react_frontend/src/services/auctionService.js
- react_frontend/src/lib/supabaseClient.js
