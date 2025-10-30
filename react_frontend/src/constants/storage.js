/**
 * PUBLIC_INTERFACE
 * Centralized storage-related constants for Supabase Storage.
 * Use AUCTION_IMAGES_BUCKET (slug) for all API calls.
 * AUCTION_IMAGES_BUCKET must exactly equal the Supabase Storage bucket ID (slug), required: 'the-auction-images'.
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
