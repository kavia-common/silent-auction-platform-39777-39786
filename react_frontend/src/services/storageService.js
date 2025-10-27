import { supabase } from '../lib/supabaseClient';

const BUCKET_NAME = 'item-images';

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
 * Upload a file to the public bucket and return { path, publicUrl, error }.
 * File is expected to be a browser File or Blob with an optional name/type.
 */
// PUBLIC_INTERFACE
export async function uploadPublicImageToBucket(eventId, itemId, file) {
  /** Uploads an image to the public 'item-images' bucket and returns its public URL. */
  if (!file || !eventId || !itemId) {
    return { path: null, publicUrl: null, error: new Error('Missing required parameters') };
  }
  try {
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
  STORAGE_CONSTANTS,
};
