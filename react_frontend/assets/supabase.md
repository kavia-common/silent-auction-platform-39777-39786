# Supabase Integration - Silent Auction App (Frontend)

This app uses Supabase for database, realtime, storage, and optional magic-link auth.

Environment variables required (set in your .env for the react_frontend container):
- REACT_APP_SUPABASE_URL
- REACT_APP_SUPABASE_KEY
- REACT_APP_SITE_URL (optional; if omitted we use window.location.origin for email redirect)

The frontend validates REACT_APP_SUPABASE_URL and REACT_APP_SUPABASE_KEY in development. Missing values will throw an error on startup so you can fix your .env.

## Storage: Public Bucket for Auction Images

Bucket ID (slug): the-auction-images
Access model: Public read, authenticated write/update/delete (public_read_app_write)

We require:
- Bucket exists and is marked public (for read)
- RLS policies on storage.objects:
  - Public read of objects for this bucket
  - Authenticated users can insert, update, delete, and list objects in this bucket
  - No anonymous inserts (uploads require an authenticated session)

How to apply (idempotent SQL migration):
- Preferred: Run the migration file with a role that owns storage.objects (e.g., in Supabase SQL Editor which runs as supabase_admin) or via backend using the service_role key.
- File to run: assets/sql_patches/storage_the_auction_images_policies.sql

For reference, the SQL includes:
- Upsert bucket:
  insert into storage.buckets (id, name, public)
  values ('the-auction-images','the-auction-images', true)
  on conflict (id) do update set public = excluded.public, name = excluded.name;

- Policies created (guarded by DO blocks for idempotency):
  - "Public read objects for the-auction-images" (select for all)
  - "Authenticated list objects for the-auction-images" (select for authenticated; explicit list)
  - "Authenticated insert objects for the-auction-images" (insert for authenticated with check on bucket)
  - "Authenticated update objects for the-auction-images" (update for authenticated with using/with check on bucket)
  - "Authenticated delete objects for the-auction-images" (delete for authenticated with using on bucket)

Optional (disabled by requirement): An "Anonymous insert" policy is commented in the SQL file if you later choose to allow unauthenticated uploads.

CORS:
- In Supabase Dashboard > Storage > Settings, add allowed origins:
  - http://localhost:3000
  - https://*.vercel.app
  - Your production domain(s)
- Allowed methods: GET, POST, PUT, PATCH, DELETE, OPTIONS
- Allowed headers: authorization, x-client-info, content-type, apikey

Frontend usage:
- Bucket slug constant: src/constants/storage.js (AUCTION_IMAGES_BUCKET = 'the-auction-images')
- Upload/list via src/services/storageService.js
- Public URLs fetched using storage.getPublicUrl(path)

Troubleshooting:
- If you see "new row violates row-level security policy" on upload:
  1) Confirm the policies above exist and are enabled.
  2) Ensure the session performing the upload is authenticated (anon inserts are not allowed).
  3) Verify bucket_id is exactly 'the-auction-images'.
  4) Check CORS and browser console network errors.

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

The frontend generates a stable anonymous clientId (UUID v4) per browser and includes it in every bid as bids.bidder_session_id.

Inline SQL (idempotent) to add the column to public.bids:
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

Notes:
- The column is nullable and optional; existing rows remain valid.
- Frontend behavior is graceful: if the column does not exist, the first insert will fail and is immediately retried without the field so bidding still works. Add the column to capture session identity.
- The clientId is stored in localStorage under auction.clientId.

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
- Storage constants: src/constants/storage.js (AUCTION_IMAGES_BUCKET = 'the-auction-images')
- Storage service: src/services/storageService.js (verifyBucketExists, uploadPublicImageToBucket)
- Create flow: src/pages/CreateEvent.js
- Join flow (two-step):
  - Step 1: src/pages/JoinEventCode.js
  - Step 2: src/pages/JoinEventName.js
  - Legacy: src/pages/JoinEvent.js
- Bidding view: src/pages/BidderView.js
- Host dashboard: src/pages/HostDashboard.js

## Notes

- Policies in supabase_schema.sql are permissive for demos using the anon key. Tighten them for production.
- Consider adding database-level constraints/triggers for robust bid validation (e.g., enforcing higher-than-current bid on insert).
