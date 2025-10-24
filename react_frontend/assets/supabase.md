# Supabase Integration - Silent Auction App (Frontend)

This app uses Supabase for database, realtime, and optional magic-link auth.

Environment variables required (set in your .env for the react_frontend container):
- REACT_APP_SUPABASE_URL
- REACT_APP_SUPABASE_KEY
- REACT_APP_SITE_URL (optional; if omitted we use window.location.origin for email redirect)

The frontend validates REACT_APP_SUPABASE_URL and REACT_APP_SUPABASE_KEY in development. Missing values will throw an error on startup so you can fix your .env.

## Applying the Database Schema

1) Open Supabase Dashboard > SQL Editor.
2) Copy-paste the contents of assets/supabase_schema.sql from this repo, or upload and run it.
3) Execute the script. It will:
   - Enable pgcrypto (for gen_random_uuid)
   - Create tables: events, items, participants, bids (all IDs default to UUIDs)
   - Add indexes and permissive demo Row Level Security policies
   - Patch events.id to ensure UUID defaults and PK exist (prevents "null value in column id of relation events")

### Important: Auction open/closed flag
The frontend supports both a text status column (status: 'open' | 'closed' | 'active') and a boolean column (is_open). If your events table does not yet have is_open, apply this patch:

- File: assets/sql_patches/events_is_open_patch.sql
- What it does: Adds events.is_open boolean DEFAULT true NOT NULL (idempotent) and normalizes the column shape if it exists with a wrong type/nullability.

Quick verification query:
select column_name, data_type, column_default, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'events' and column_name = 'is_open';

Expected:
- data_type: boolean
- is_nullable: NO
- column_default: true

### Troubleshooting: items.id NOT NULL violation
If you see an error like: null value in column "id" of relation "items" violates not-null constraint, your items table likely does not have a default UUID generator on id.

Fix it by running the patch script in the Supabase SQL Editor:
- File: assets/sql_patches/items_id_uuid_patch.sql

What it does:
- Ensures pgcrypto is enabled
- Alters items.id to UUID, NOT NULL, with default gen_random_uuid()
- Ensures a primary key on items.id

Quick verification query:
select column_name, data_type, column_default, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'items' and column_name = 'id';

Expected:
- data_type: uuid
- is_nullable: NO
- column_default: gen_random_uuid()

Important: The frontend never passes id when inserting events. The database generates UUIDs automatically. If you see “null value in column id of relation events,” your events table is missing the default UUID config—re-run the schema script.

## Anonymous Session IDs (bidder_session_id)

The frontend now generates a stable anonymous clientId (UUID v4) per browser and includes it in every bid as bids.bidder_session_id. To enable this, add the column to public.bids:

SQL (idempotent patch):

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

-- Optional: index for analytics or querying by session
create index if not exists bids_bidder_session_id_idx on public.bids(bidder_session_id);
```

Notes:
- The column is nullable and optional; existing rows remain valid.
- Frontend falls back gracefully: if the column does not exist yet, the first insert attempt will retry without the field to avoid runtime errors (but you should add the column to capture session identity).
- The clientId is stored in localStorage as auction.clientId.

## Realtime

Enable replication (Realtime) for tables:
- public.items
- public.bids
- public.events (for auction open/close status updates)

The app subscribes to these using Supabase Realtime channels:
- Items list per event (insert/update/delete)
- Bids per item (insert/update/delete to reflect current price)
- Single event row (status changes open/closed)

## Auth (Optional Magic Link for Host)

The Create Event page can send a magic link to the host email (if provided).
- Make sure your Supabase Auth > URL Configuration allows the redirect domain.
- Redirect is computed as: ${REACT_APP_SITE_URL || window.location.origin}/host/callback?eventId=<uuid>

## Frontend Entry Points

- Supabase client: src/lib/supabaseClient.js (validates envs; single client instance)
- Create flow: src/pages/CreateEvent.js (inserts without id; shows Supabase error messages)
- Join flow (two-step):
  - Step 1: src/pages/JoinEventCode.js (validate code)
  - Step 2: src/pages/JoinEventName.js (optional name, then navigate to auction room)
  - Legacy: src/pages/JoinEvent.js (redirects to /join)
- events.code is unique in the schema and looked up with .limit(1).maybeSingle() to guard against any legacy data inconsistencies that might otherwise trigger "Cannot coerce the result to a single JSON object".
- events.name may not be unique; we use an exact match with .limit(1).maybeSingle() and show a friendly error if Supabase reports multiple matches. Prefer joining by code in cases of duplicate names.
- Bidding view: src/pages/BidderView.js (loads event by code, realtime items/bids)
- Host dashboard: src/pages/HostDashboard.js (manage items; see high bids)

## Notes

- Policies in supabase_schema.sql are permissive for demos using the anon key. Tighten them for production.
- Consider adding database-level constraints/triggers for robust bid validation (e.g., enforcing higher-than-current bid on insert).
