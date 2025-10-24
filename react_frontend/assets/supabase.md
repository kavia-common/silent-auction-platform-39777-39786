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
   - Patch events.id and items.id to ensure UUID defaults and PK exist (prevents "null value in column id of relation events/items")

Important: The frontend never passes id when inserting events or items. The database generates UUIDs automatically. If you see “null value in column id of relation events” or “null value in column id of relation items,” your table is missing the default UUID config—re-run the schema script so the safety patches apply.

If you specifically need to patch items.id quickly, run the SQL snippet in assets/sql_patches/items_id_uuid_patch.sql in the Supabase SQL Editor.

## Realtime

Enable replication (Realtime) for tables:
- public.items
- public.bids

The app subscribes to these using Supabase Realtime channels.

## Auth (Optional Magic Link for Host)

The Create Event page can send a magic link to the host email (if provided).
- Make sure your Supabase Auth > URL Configuration allows the redirect domain.
- Redirect is computed as: ${REACT_APP_SITE_URL || window.location.origin}/host/callback?eventId=<uuid>

## Handling “Cannot coerce the result to a single JSON object”

This error occurs if .single() is used on a query that can return multiple rows. We’ve ensured:

- getEventByCode(code): uses .limit(1).maybeSingle() so it won’t throw if multiple rows match due to accidental duplicates; it simply returns the first row or null.
- getEventByName(name): uses .maybeSingle() (names could theoretically duplicate, so we don’t force single()).
- getHighBid(itemId): uses .order('amount', { ascending: false }).limit(1).maybeSingle() to fetch the top bid safely.
- list endpoints (listItems, listBidsForItem) return arrays and do not call .single().

Only insert-return selects (createEvent, addItem, placeBid) use .single() because Supabase returns exactly one inserted row in those calls.

## Frontend Entry Points

- Supabase client: src/lib/supabaseClient.js (validates envs; single client instance)
- Create flow: src/pages/CreateEvent.js (inserts without id; shows Supabase error messages)
- Join flow: src/pages/JoinEvent.js (join by code or exact name)
- Bidding view: src/pages/BidderView.js (loads event by code, realtime items/bids)
- Host dashboard: src/pages/HostDashboard.js (manage items; see high bids)

## Notes

- Policies in supabase_schema.sql are permissive for demos using the anon key. Tighten them for production.
- Consider adding database-level constraints/triggers for robust bid validation (e.g., enforcing higher-than-current bid on insert).
