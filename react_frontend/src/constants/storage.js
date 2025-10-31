/**
 * PUBLIC_INTERFACE
 * Centralized storage-related constants for Supabase Storage.
 * Use AUCTION_IMAGES_BUCKET (slug) for all API calls.
 * AUCTION_IMAGES_BUCKET must exactly equal the Supabase Storage bucket ID (slug). Default in this app: 'the-auction-images'.
 * All uploads store only the object path (e.g., 'public/uuid.jpg' or '<userId>/uuid.png') in items.image_path — NOT a full URL and NOT prefixed by bucket.
 * Display functions tolerate older rows that accidentally stored 'the-auction-images/<object>' or full URLs.
 * If you change the bucket name in Supabase, update this constant to match the bucket ID exactly.
 * The app expects public URLs to be retrievable from this bucket, enforced by storage policies.
 */

// PUBLIC_INTERFACE
export const AUCTION_IMAGES_BUCKET = 'the-auction-images';

/**
 * PUBLIC_INTERFACE
 * Compatibility label used in some UI strings. Kept as an alias to avoid breaking imports.
 */
export const AUCTION_IMAGES_LABEL = AUCTION_IMAGES_BUCKET;
