import { supabase } from '../lib/supabaseClient';

// Resolve bucket name from env with default fallback (spaces are intentional)
const BUCKET_NAME = process.env.REACT_APP_SUPABASE_BUCKET_NAME?.trim() || 'the auction images';

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
 * Verify that the configured bucket exists in Supabase Storage.
 * Throws a clear, actionable error if not found.
 */
// PUBLIC_INTERFACE
export async function verifyBucketExists() {
  /**
   * Checks Supabase Storage for the configured bucket name and throws an Error if missing.
   * This prevents confusing 'bucket not found' errors and guides setup in the dashboard.
   */
  try {
    const { data, error } = await supabase.storage.listBuckets();
    if (error) {
      // Surface underlying error while still guiding the developer
      // eslint-disable-next-line no-console
      console.error('Failed to list Supabase storage buckets:', error);
      throw new Error(
        `Unable to verify storage buckets. Please check your Supabase credentials and permissions. Underlying error: ${error.message || String(error)}`
      );
    }
    const exists = (data || []).some((b) => b.name === BUCKET_NAME);
    if (!exists) {
      const msg = `Supabase Storage bucket not found: "${BUCKET_NAME}". Create this bucket in the Supabase dashboard (Storage -> Create new bucket) and ensure its name matches exactly, including spaces.`;
      // eslint-disable-next-line no-console
      console.error(msg);
      throw new Error(msg);
    }
    return true;
  } catch (err) {
    // Re-throw with clear message
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
      return { path: null, publicUrl: null, error: uploadError };
    }

    const { data: pub, error: pubErr } = supabase.storage.from(BUCKET_NAME).getPublicUrl(path);
    if (pubErr) {
      return { path, publicUrl: null, error: pubErr };
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
