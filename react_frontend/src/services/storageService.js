import { supabase } from '../lib/supabaseClient';
import { AUCTION_IMAGES_BUCKET } from '../constants/storage';

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
 * Minimal runtime probe to distinguish bucket-not-found vs permission errors.
 * Uses list('') on the target bucket to see whether the bucket responds.
 */
async function probeBucketAccess() {
  try {
    const { data, error } = await supabase.storage.from(AUCTION_IMAGES_BUCKET).list('');
    if (error) {
      const msg = (error.message || '').toLowerCase();
      // Common @supabase-js messages include 'bucket not found', 401, or 403 references
      if (msg.includes('not found')) {
        return { ok: false, kind: 'not_found', error };
      }
      if (msg.includes('unauthorized') || msg.includes('401')) {
        return { ok: false, kind: 'unauthorized', error };
      }
      if (msg.includes('forbidden') || msg.includes('permission') || msg.includes('403')) {
        return { ok: false, kind: 'forbidden', error };
      }
      return { ok: false, kind: 'other', error };
    }
    // If listing returns with data and no error, access is OK
    return { ok: true, kind: 'ok', data };
  } catch (e) {
    return { ok: false, kind: 'exception', error: e };
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
  // First try an explicit listBuckets to confirm presence by name
  const { data: buckets, error: listErr } = await supabase.storage.listBuckets();
  if (listErr) {
    // eslint-disable-next-line no-console
    console.error('[storage] Failed to list Supabase storage buckets:', listErr);
    throw new Error(
      `Unable to verify storage buckets for project "${projectRef}". Underlying error: ${listErr.message || String(listErr)}`
    );
  }
  const exists = (buckets || []).some((b) => b.name === AUCTION_IMAGES_BUCKET);
  if (!exists) {
    // Double-check using .list('') to differentiate 404 vs permission issues
    const probe = await probeBucketAccess();
    if (probe.kind === 'not_found') {
      throw new Error(
        `Bucket not found for slug "${AUCTION_IMAGES_BUCKET}" on project "${projectRef}". Confirm the bucket ID exactly matches in Supabase (Storage > Buckets).`
      );
    }
    if (probe.kind === 'unauthorized' || probe.kind === 'forbidden') {
      throw new Error(
        `Access denied for bucket "${AUCTION_IMAGES_BUCKET}" on project "${projectRef}". Ensure your Storage policies and bucket public setting allow anon upload/list as intended.`
      );
    }
    throw new Error(
      `Unable to access bucket "${AUCTION_IMAGES_BUCKET}" on project "${projectRef}". ${probe.error?.message || 'Unknown error'}`
    );
  }
  // If listBuckets says it exists, still run a probe to detect permission problems early
  const probe = await probeBucketAccess();
  if (!probe.ok) {
    if (probe.kind === 'unauthorized' || probe.kind === 'forbidden') {
      const statusTxt = probe.error?.status ? `status ${probe.error.status}` : 'permission error';
      throw new Error(
        `Bucket "${AUCTION_IMAGES_BUCKET}" exists but access is denied for project "${projectRef}" (${statusTxt}). Review Storage policies (RLS) and bucket public setting.`
      );
    }
    if (probe.kind === 'not_found') {
      // Rare: race; surface as not found
      throw new Error(
        `Bucket "${AUCTION_IMAGES_BUCKET}" reported by listBuckets but could not be listed (404). It may have been removed or renamed.`
      );
    }
    const statusTxt = typeof probe.error?.status !== 'undefined' ? `status ${probe.error.status}` : 'unknown status';
    throw new Error(
      `Bucket "${AUCTION_IMAGES_BUCKET}" probe failed (${statusTxt}): ${probe.error?.message || 'Unknown error'}`
    );
  }
  return true;
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
      .from(AUCTION_IMAGES_BUCKET)
      .upload(path, file, { cacheControl: '3600', upsert: true });

    if (uploadError) {
      const projectRef = getProjectRef();
      const msgLower = (uploadError.message || '').toLowerCase();
      const statusTxt = typeof uploadError.status !== 'undefined' ? `status ${uploadError.status}` : 'unknown status';
      let hint = '';
      if (uploadError.status === 404 || msgLower.includes('not found')) {
        hint = `Bucket "${AUCTION_IMAGES_BUCKET}" not found. Verify the exact bucket slug in Supabase (Storage > Buckets) and ensure the client points to project "${projectRef}".`;
      } else if (uploadError.status === 401 || msgLower.includes('unauthorized') || msgLower.includes('401')) {
        hint = `Unauthorized (401). Ensure REACT_APP_SUPABASE_KEY is the anon public key for project "${projectRef}" and review Storage policies.`;
      } else if (uploadError.status === 403 || msgLower.includes('forbidden') || msgLower.includes('permission') || msgLower.includes('403')) {
        hint = `Forbidden (403). Update Storage policies or mark the bucket public if you expect anonymous uploads.`;
      } else {
        hint = `Check Supabase Storage settings and network; see console for full error.`;
      }
      const enhanced = new Error(
        `Upload failed to bucket "${AUCTION_IMAGES_BUCKET}" on project "${projectRef}" (${statusTxt}). ${uploadError.message || ''} ${hint}`.trim()
      );
      return { path: null, publicUrl: null, error: enhanced };
    }

    const { data: pub, error: pubErr } = supabase.storage.from(AUCTION_IMAGES_BUCKET).getPublicUrl(path);
    if (pubErr) {
      const projectRef = getProjectRef();
      const enhanced = new Error(
        `Failed to retrieve public URL from bucket slug "${AUCTION_IMAGES_BUCKET}" on project "${projectRef}". ${pubErr.message || ''}`.trim()
      );
      return { path, publicUrl: null, error: enhanced };
    }

    return { path, publicUrl: pub?.publicUrl || null, error: null };
  } catch (e) {
    return { path: null, publicUrl: null, error: e };
  }
}

export default {
  uploadPublicImageToBucket,
  verifyBucketExists,
};
