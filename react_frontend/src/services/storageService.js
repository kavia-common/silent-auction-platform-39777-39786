import { supabase } from '../lib/supabaseClient';
import { AUCTION_IMAGES_BUCKET } from '../constants/storage';

// Use the centralized bucket id (slug) for all API calls. Do not change this without updating constants.
const BUCKET_NAME = AUCTION_IMAGES_BUCKET;

/**
 * Derive an extension string from a filename or MIME type.
 */
function deriveExtension(file) {
  const name = (file?.name || '').toLowerCase();
  const type = (file?.type || '').toLowerCase();
  const extFromName = name.includes('.') ? name.split('.').pop() : '';
  if (extFromName) return extFromName.replace(/[^a-z0-9]/gi, '') || 'bin';

  // fallback from MIME type
  if (type.startsWith('image/')) {
    const m = type.split('/')[1];
    if (m) return m.replace(/[^a-z0-9]/gi, '') || 'jpg';
  }
  return 'bin';
}

/**
 * Build a storage path: ${eventId}/${itemId}-${timestamp}.${ext}
 */
function buildPath({ eventId, itemId, ext }) {
  const safeEvent = String(eventId || '').replace(/[^a-zA-Z0-9-_]/g, '');
  const safeItem = String(itemId || '').replace(/[^a-zA-Z0-9-_]/g, '');
  const stamp = Date.now();
  return `${safeEvent}/${safeItem}-${stamp}.${ext}`;
}

/**
 * Extract project ref for diagnostics.
 */
function getProjectRef() {
  const url = process.env.REACT_APP_SUPABASE_URL || '';
  try {
    const host = new URL(url).host;
    return host.split('.')[0] || '';
  } catch {
    return '';
  }
}

/**
 * Verify that the configured bucket exists in Supabase Storage.
 * Throws a clear, actionable error if not found.
 */
// PUBLIC_INTERFACE
export async function verifyBucketExists() {
  /**
   * Checks Supabase Storage for the configured bucket id (slug) and throws an Error if missing.
   * This prevents confusing 'Bucket not found' errors and guides setup in the dashboard.
   */
  const projectRef = getProjectRef();
  try {
    const { data, error } = await supabase.storage.listBuckets();
    if (error) {
      // eslint-disable-next-line no-console
      console.error('[storage] Failed to list Supabase storage buckets:', error);
      throw new Error(
        `Unable to verify storage buckets for project "${projectRef}". Underlying error: ${error.message || String(error)}`
      );
    }
    const exists = (data || []).some((b) => b.name === BUCKET_NAME);
    if (!exists) {
      const msg = `Bucket not found for slug "${BUCKET_NAME}" on project "${projectRef}". Confirm the bucket ID exactly matches the slug in your Supabase dashboard (Storage > Buckets).`;
      // eslint-disable-next-line no-console
      console.error('[storage]', msg);
      throw new Error(msg);
    }
    return true;
  } catch (err) {
    throw err;
  }
}

/**
 * Upload a file to the public bucket and return { path, publicUrl, error }.
 * File is expected to be a browser File or Blob with an optional name/type.
 */
// PUBLIC_INTERFACE
export async function uploadPublicImageToBucket(eventId, itemId, file) {
  /** Uploads an image to the configured public bucket and returns its public URL. */
  if (!file || !eventId || !itemId) {
    return { path: null, publicUrl: null, error: new Error('Missing required parameters') };
  }
  try {
    // Ensure bucket exists first for clearer error feedback
    await verifyBucketExists();

    const ext = deriveExtension(file);
    const path = buildPath({ eventId, itemId, ext });

    // Note: upsert true allows replacement if user re-uploads for same item quickly
    const { error: uploadError } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(path, file, { cacheControl: '3600', upsert: true });

    if (uploadError) {
      const projectRef = getProjectRef();
      const enhanced = new Error(
        `Upload failed to bucket slug "${BUCKET_NAME}" on project "${projectRef}". ${uploadError.message || ''}`.trim()
      );
      return { path: null, publicUrl: null, error: enhanced };
    }

    const { data: pub, error: pubErr } = supabase.storage.from(BUCKET_NAME).getPublicUrl(path);
    if (pubErr) {
      const projectRef = getProjectRef();
      const enhanced = new Error(
        `Failed to retrieve public URL from bucket slug "${BUCKET_NAME}" on project "${projectRef}". ${pubErr.message || ''}`.trim()
      );
      return { path, publicUrl: null, error: enhanced };
    }

    return { path, publicUrl: pub?.publicUrl || null, error: null };
  } catch (e) {
    return { path: null, publicUrl: null, error: e };
  }
}

export const STORAGE_CONSTANTS = { BUCKET_NAME };

export default {
  uploadPublicImageToBucket,
  verifyBucketExists,
  STORAGE_CONSTANTS,
};
