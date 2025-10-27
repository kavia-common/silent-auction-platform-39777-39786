/**
 * PUBLIC_INTERFACE
 * Centralized storage-related constants for Supabase Storage.
 * Use AUCTION_IMAGES_BUCKET (slug) for all API calls, and AUCTION_IMAGES_LABEL for UI text.
 * AUCTION_IMAGES_BUCKET must exactly equal the Supabase Storage bucket ID (slug), currently 'the-auction-images'.
 * If you change the bucket name in Supabase, update this constant to match the bucket ID exactly.
 */

// PUBLIC_INTERFACE
export const AUCTION_IMAGES_BUCKET = 'the-auction-images';

// PUBLIC_INTERFACE
export const AUCTION_IMAGES_LABEL = 'the-auction-images';
