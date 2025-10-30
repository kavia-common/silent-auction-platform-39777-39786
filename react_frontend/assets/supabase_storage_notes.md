# Supabase Storage - Auction Images

Bucket slug: the-auction-images
Access: Public read; authenticated insert/update/delete

Where used:
- src/constants/storage.js → AUCTION_IMAGES_BUCKET
- src/services/storageService.js → verifyBucketExists, uploadPublicImageToBucket

Client configuration:
- src/lib/supabaseClient.js reads REACT_APP_SUPABASE_URL and REACT_APP_SUPABASE_KEY
- Make sure these are set in react_frontend/.env

Operational checklist if uploads fail:
1) Confirm the bucket exists and is public in Storage > Buckets
2) Verify policies exist (public select; authenticated insert/update/delete) scoped to bucket_id = 'the-auction-images'
3) Check CORS (origins include localhost:3000 and your deployment)
4) Confirm the frontend env vars point to the same project as the storage bucket
