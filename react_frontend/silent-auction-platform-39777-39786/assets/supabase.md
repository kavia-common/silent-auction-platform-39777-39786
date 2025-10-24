# Supabase Integration Guide - Silent Auction App

This document explains how the React frontend integrates with Supabase and what configuration is required.

## Environment Variables

Set these for the `react_frontend` container (do not commit .env with credentials):

- REACT_APP_SUPABASE_URL: Your Supabase project URL
- REACT_APP_SUPABASE_KEY: Your Supabase anon key
- REACT_APP_SITE_URL: Optional. Overrides the Site URL used for magic link redirect (defaults to window.location.origin)

Example:
REACT_APP_SUPABASE_URL=https://xxxx.supabase.co
REACT_APP_SUPABASE_KEY=eyJhbGci...
REACT_APP_SITE_URL=https://your-app.example.com

The frontend reads these variables in:
- src/lib/supabaseClient.js
- src/services/auctionService.js (for magic link redirect)

## Auth (Magic Link)

We use Supabase Auth with Passwordless (Magic Link). The host provides an email and receives a login link.

- Configure your Supabase project's Auth > URL Configuration:
  - Site URL: Set to your production URL (or use REACT_APP_SITE_URL to override at runtime)
  - Redirect URLs: Include: https://your-app.example.com/host/callback

Frontend flow:
- sendHostMagicLink(email, eventId) sets emailRedirectTo to `${SITE_URL}/host/callback?eventId=<id>`
- MagicLinkCallback page finalizes session and redirects to /host/:eventId

Note: Depending on your email provider and Supabase settings, you may need to use `exchangeCodeForSession` if using PKCE or custom flows.

## Database Schema

Below is a minimal schema suitable for the app. Adjust as needed.

```sql
-- Enable required extensions
create extension if not exists "pgcrypto";

-- Events table
create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text unique not null,
  status text default 'active',
  created_at timestamp with time zone default now()
);

-- If you encounter "null value in column \"id\" of relation \"events\" violates not-null constraint",
-- your table may be missing the default or PK. Apply this patch:
-- Ensure pgcrypto (or use gen_random_uuid via pgcrypto) is enabled:
create extension if not exists "pgcrypto";
-- Add default generator and primary key if missing:
alter table public.events
  alter column id type uuid using id::uuid,
  alter column id set not null,
  alter column id set default gen_random_uuid();
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.events'::regclass
      and contype = 'p'
  ) then
    alter table public.events add primary key (id);
  end if;
end $$;

-- Items table
create table if not exists public.items (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  title text not null,
  description text default '',
  starting_bid numeric default 0,
  created_at timestamp with time zone default now()
);
create index if not exists items_event_id_idx on public.items(event_id);

-- Bids table
create table if not exists public.bids (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  item_id uuid not null references public.items(id) on delete cascade,
  amount numeric not null check (amount > 0),
  bidder_name text default 'Anonymous',
  bidder_session_id text, -- optional anonymous session identifier (frontend includes it)
  created_at timestamp with time zone default now()
);
create index if not exists bids_item_id_idx on public.bids(item_id);
create index if not exists bids_event_id_idx on public.bids(event_id);
create index if not exists bids_bidder_session_id_idx on public.bids(bidder_session_id);
```

### Events is_open patch
If you see "column events.is_open does not exist" in the Host dashboard when opening/closing auctions, run the idempotent patch:

- File: assets/sql_patches/events_is_open_patch.sql
- Effect: Adds public.events.is_open boolean DEFAULT true NOT NULL and normalizes shape if it exists differently.

Verification:
select column_name, data_type, column_default, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'events' and column_name = 'is_open';
Expect: boolean, default true, not null.

## Anonymous Bidder Session IDs

The frontend assigns an anonymous per-browser clientId and includes it in bids as bidder_session_id. If your public.bids does not have this column, add it with:

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

The app gracefully retries inserts without this field if the column is missing, but you should add it to capture session identity.

## Realtime Configuration

Enable Realtime for the following tables:
- public.items
- public.bids

In the "Replication" (Realtime) settings of your project, enable database changes for Insert/Update/Delete on these tables.

The app subscribes using Supabase Realtime channels:
- Items: subscribeToItems(eventId)
- Bids: subscribeToBids(itemId)

## Row Level Security (RLS)

Enable RLS on all three tables and add policies appropriate for your trust model.

Example permissive policies for demo purposes (adjust for production):

```sql
alter table public.events enable row level security;
alter table public.items enable row level security;
alter table public.bids enable row level security;

-- Events: allow read for all, insert only for anon (demo)
create policy "events_read_all" on public.events for select using (true);
create policy "events_insert_anon" on public.events for insert with check (true);

-- Items: allow read for all, write only for anon (demo)
create policy "items_read_all" on public.items for select using (true);
create policy "items_insert_anon" on public.items for insert with check (true);
create policy "items_delete_anon" on public.items for delete using (true);

-- Bids: allow read for all, insert for all
create policy "bids_read_all" on public.bids for select using (true);
create policy "bids_insert_all" on public.bids for insert with check (true);
```

WARNING: The above policies are intentionally permissive to support a frictionless demo using the anon key. For production, lock these down to fit your needs (e.g., authenticated host role, owner checks, rate limits, etc.).

## Frontend Integration Points

- Supabase client: src/lib/supabaseClient.js
- Services (data access): src/services/auctionService.js
  - createEvent, sendHostMagicLink, getEventByCode, addItem, listItems, deleteItem, placeBid, listBidsForItem, getHighBid, subscribeToItems, subscribeToBids
- Pages:
  - Home (create event + join event)
  - HostDashboard (manage items, see high bids)
  - BidderView (list items, place bids)
  - MagicLinkCallback (finalize magic link, redirect)

## Email Redirect

The service sets:
- `emailRedirectTo = ${SITE_URL}/host/callback?eventId={id}`

SITE_URL is resolved as:
- `process.env.REACT_APP_SITE_URL` if provided
- else `window.location.origin`

Ensure your Supabase Auth settings allow this redirect domain.

## Notes

- Client-side validation is included for bids. You must implement server-side constraints and transactional logic for true integrity (e.g., check highest bid on insert).
- Consider adding DB constraints and triggers to enforce bid rules at the database level.
```

Explanation: Add Jest polyfills for TextEncoder/TextDecoder to avoid potential issues when importing Supabase client in tests
````write file="silent-auction-platform-39777-39786/react_frontend/src/setupTests.js"
import '@testing-library/jest-dom';

// Polyfill TextEncoder/TextDecoder for libraries that rely on them (e.g., Supabase)
try {
  // Some environments already have these
  if (!globalThis.TextEncoder || !globalThis.TextDecoder) {
    // eslint-disable-next-line no-restricted-globals
    const { TextEncoder, TextDecoder } = require('util');
    if (!globalThis.TextEncoder) globalThis.TextEncoder = TextEncoder;
    if (!globalThis.TextDecoder) globalThis.TextDecoder = TextDecoder;
  }
} catch (e) {
  // ignore if util is not available
}
