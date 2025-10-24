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

## Realtime

Enable replication (Realtime) for tables:
- public.items
- public.bids

The app subscribes to these using Supabase Realtime channels.

## Auth (Optional Magic Link for Host)

The Create Event page can send a magic link to the host email (if provided).
- Make sure your Supabase Auth > URL Configuration allows the redirect domain.
- Redirect is computed as: ${REACT_APP_SITE_URL || window.location.origin}/host/callback?eventId=<uuid>

## Frontend Entry Points

- Supabase client: src/lib/supabaseClient.js (validates envs; single client instance)
- Create flow: src/pages/CreateEvent.js (inserts without id; shows Supabase error messages)
- Join flow: src/pages/JoinEvent.js (join by code or exact name)

Uniqueness notes:
- events.code is unique in the schema and looked up with .limit(1).maybeSingle() to guard against any legacy data inconsistencies that might otherwise trigger "Cannot coerce the result to a single JSON object".
- events.name may not be unique; we use an exact match with .limit(1).maybeSingle() and show a friendly error if Supabase reports multiple matches. Prefer joining by code in cases of duplicate names.
- Bidding view: src/pages/BidderView.js (loads event by code, realtime items/bids)
- Host dashboard: src/pages/HostDashboard.js (manage items; see high bids)

## Notes

- Policies in supabase_schema.sql are permissive for demos using the anon key. Tighten them for production.
- Consider adding database-level constraints/triggers for robust bid validation (e.g., enforcing higher-than-current bid on insert).
