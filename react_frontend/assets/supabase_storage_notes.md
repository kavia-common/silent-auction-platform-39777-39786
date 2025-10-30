# Supabase Storage: the-auction-images

Goal:
- Public read for images (anyone can view/download)
- Authenticated users can insert, update, delete, and list
- No anonymous inserts (uploads require an authenticated session)
- Bucket must exist and be public

Environment variables (already present per container_env):
- REACT_APP_SUPABASE_URL
- REACT_APP_SUPABASE_KEY

Required Supabase Dashboard settings:
1) Storage > Buckets
   - Bucket slug: the-auction-images
   - Public: enabled

2) Storage > Policies (storage.objects)
   Apply the idempotent SQL migration provided below with a role that owns storage.objects
   (e.g., using the supabase SQL editor where the migration runs as supabase_admin, or via
   a backend script using the service_role key).

How to apply:
- Open Supabase SQL Editor and run the migration file:
  react_frontend/assets/sql_patches/storage_the_auction_images_policies.sql
- Or copy-paste the contents into the SQL editor and execute.

Policy summary (after migration):
- Public read:
  create policy "Public read objects for the-auction-images"
    on storage.objects for select
    using (bucket_id = 'the-auction-images');

- Explicit authenticated list:
  create policy "Authenticated list objects for the-auction-images"
    on storage.objects for select to authenticated
    using (bucket_id = 'the-auction-images');

- Authenticated insert:
  create policy "Authenticated insert objects for the-auction-images"
    on storage.objects for insert to authenticated
    with check (bucket_id = 'the-auction-images');

- Authenticated update:
  create policy "Authenticated update objects for the-auction-images"
    on storage.objects for update to authenticated
    using (bucket_id = 'the-auction-images')
    with check (bucket_id = 'the-auction-images');

- Authenticated delete:
  create policy "Authenticated delete objects for the-auction-images"
    on storage.objects for delete to authenticated
    using (bucket_id = 'the-auction-images');

Optional (disabled by requirement):
- Anonymous insert (only if you want unauthenticated uploads):
  create policy "Anonymous insert objects for the-auction-images"
    on storage.objects for insert to anon
    with check (bucket_id = 'the-auction-images');

Troubleshooting:
- If you see "new row violates row-level security policy" on upload/insert:
  - Confirm the policies above exist and are enabled.
  - Ensure the upload session is authenticated (no anon uploads allowed by current config).
  - Verify the bucket_id used by the SDK call is 'the-auction-images'.
  - If errors persist, confirm RLS is enabled on storage.objects (default in Supabase).
