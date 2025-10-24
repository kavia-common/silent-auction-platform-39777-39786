-- Silent Auction App - Supabase Schema (apply in SQL editor)

-- Extensions required for UUID generation
create extension if not exists "pgcrypto";

-- EVENTS
create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text unique not null,
  status text default 'active',
  created_at timestamptz default now()
);

-- PARTICIPANTS (optional, for future named participants)
create table if not exists public.participants (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  name text not null,
  created_at timestamptz default now()
);
create index if not exists participants_event_id_idx on public.participants(event_id);

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

-- RLS (enable and add permissive demo policies; refine for production)
alter table public.events enable row level security;
alter table public.items enable row level security;
alter table public.bids enable row level security;
alter table public.participants enable row level security;

-- Demo policies (anon-friendly)
do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='events' and policyname='events_read_all') then
    create policy "events_read_all" on public.events for select using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='events' and policyname='events_insert_anon') then
    create policy "events_insert_anon" on public.events for insert with check (true);
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='items' and policyname='items_read_all') then
    create policy "items_read_all" on public.items for select using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='items' and policyname='items_insert_anon') then
    create policy "items_insert_anon" on public.items for insert with check (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='items' and policyname='items_delete_anon') then
    create policy "items_delete_anon" on public.items for delete using (true);
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='bids' and policyname='bids_read_all') then
    create policy "bids_read_all" on public.bids for select using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='bids' and policyname='bids_insert_all') then
    create policy "bids_insert_all" on public.bids for insert with check (true);
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='participants' and policyname='participants_read_all') then
    create policy "participants_read_all" on public.participants for select using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='participants' and policyname='participants_insert_anon') then
    create policy "participants_insert_anon" on public.participants for insert with check (true);
  end if;
end $$;

-- Safety patch for existing events table missing defaults/PK
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

-- Safety patch for existing items table missing defaults/PK
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

-- Optional safety patches for bids/participants to ensure consistency
alter table public.bids
  alter column id type uuid using id::uuid,
  alter column id set not null,
  alter column id set default gen_random_uuid();

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.bids'::regclass and contype = 'p'
  ) then
    alter table public.bids add primary key (id);
  end if;
end $$;

alter table public.participants
  alter column id type uuid using id::uuid,
  alter column id set not null,
  alter column id set default gen_random_uuid();

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.participants'::regclass and contype = 'p'
  ) then
    alter table public.participants add primary key (id);
  end if;
end $$;
