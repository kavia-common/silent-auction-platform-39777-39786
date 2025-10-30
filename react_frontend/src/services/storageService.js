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
 * Attempt to read the bucket metadata and create it if it does not exist.
 * This is guarded to not break anon contexts: createBucket requires service role; in anon, it will return 403.
 */
async function ensureBucketExistsOrCreateIfPossible() {
  // Try to fetch the bucket metadata
  try {
    const { data: bucketData, error: getErr } = await supabase.storage.getBucket(AUCTION_IMAGES_BUCKET);
    if (bucketData && !getErr) {
      return { exists: true, created: false, error: null };
    }
    // If explicitly not found, try create (may fail under anon, which we tolerate)
    if (getErr && (getErr.status === 404 || /not found/i.test(getErr.message || ''))) {
      const { data: created, error: createErr } = await supabase.storage.createBucket(AUCTION_IMAGES_BUCKET, { public: true });
      if (created && !createErr) {
        return { exists: true, created: true, error: null };
      }
      // Creation not allowed or failed; surface original not-found while preserving error
      return { exists: false, created: false, error: createErr || getErr };
    }
    // Other errors (403/401/etc.) — just return and let caller decide
    return { exists: Boolean(bucketData), created: false, error: getErr || null };
  } catch (e) {
    return { exists: false, created: false, error: e };
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
    return { ok: true, kind: 'ok', data };
  } catch (e) {
    return { ok: false, kind: 'exception', error: e };
  }
}

/**
 * PUBLIC_INTERFACE
 * Check storage access and return a detailed result for UI.
 */
// PUBLIC_INTERFACE
export async function checkStorageAccess() {
  /**
   * Attempts to list the root of the bucket to validate access and existence.
   * Returns { ok, kind, message, error } where kind is one of ok|not_found|unauthorized|forbidden|other|exception.
   */
  const projectRef = getProjectRef();
  const probe = await probeBucketAccess();
  if (probe.ok) {
    return { ok: true, kind: 'ok', message: `Bucket "${AUCTION_IMAGES_BUCKET}" is reachable on project "${projectRef}".`, error: null };
  }
  const statusTxt = typeof probe.error?.status !== 'undefined' ? `status ${probe.error.status}` : 'unknown status';
  let message = `Unable to access bucket "${AUCTION_IMAGES_BUCKET}" on project "${projectRef}" (${statusTxt}). ${probe.error?.message || 'Unknown error'}`;
  if (probe.kind === 'not_found') {
    message = `Bucket "${AUCTION_IMAGES_BUCKET}" not found on project "${projectRef}". Create it in Supabase (Storage > Create bucket) and mark it public or update policies.`;
  } else if (probe.kind === 'unauthorized') {
    message = `Unauthorized (401) to access bucket "${AUCTION_IMAGES_BUCKET}" on project "${projectRef}". Ensure REACT_APP_SUPABASE_KEY is the anon public key and review Storage policies.`;
  } else if (probe.kind === 'forbidden') {
    message = `Forbidden (403) to access bucket "${AUCTION_IMAGES_BUCKET}" on project "${projectRef}". Update Storage policies or set the bucket to public if anonymous access is intended.`;
  }
  return { ok: false, kind: probe.kind, message, error: probe.error || null };
}

/**
 * Verify that the configured bucket exists in Supabase Storage.
 * Try to create it if possible (will not succeed under anon).
 * Throws a clear, actionable error if not found or not accessible.
 */
// PUBLIC_INTERFACE
export async function verifyBucketExists() {
  const projectRef = getProjectRef();

  // First, attempt a metadata read and best-effort creation
  const ensured = await ensureBucketExistsOrCreateIfPossible();
  if (!ensured.exists) {
    // Follow up with a probe for clearer classification
    const probe = await probeBucketAccess();
    const statusTxt = typeof probe.error?.status !== 'undefined' ? `status ${probe.error.status}` : 'unknown status';
    if (probe.kind === 'not_found') {
      throw new Error(`Bucket not found for slug "${AUCTION_IMAGES_BUCKET}" on project "${projectRef}". Create the bucket in Supabase (Storage > Buckets).`);
    }
    if (probe.kind === 'unauthorized') {
      throw new Error(`Unauthorized to access bucket "${AUCTION_IMAGES_BUCKET}" on project "${projectRef}". Check that your REACT_APP_SUPABASE_KEY is the anon key and review Storage policies.`);
    }
    if (probe.kind === 'forbidden') {
      throw new Error(`Forbidden to access bucket "${AUCTION_IMAGES_BUCKET}" on project "${projectRef}". Update Storage policies or mark the bucket public.`);
    }
    throw new Error(`Unable to verify bucket "${AUCTION_IMAGES_BUCKET}" on project "${projectRef}" (${statusTxt}). ${ensured.error?.message || probe.error?.message || 'Unknown error'}`);
  }

  // Finally, probe listing to ensure access with current role
  const probe = await probeBucketAccess();
  if (!probe.ok) {
    if (probe.kind === 'unauthorized') {
      throw new Error(`Bucket "${AUCTION_IMAGES_BUCKET}" exists but is unauthorized on project "${projectRef}". Review policies / anon key.`);
    }
    if (probe.kind === 'forbidden') {
      throw new Error(`Bucket "${AUCTION_IMAGES_BUCKET}" exists but is forbidden on project "${projectRef}". Update policies or set public: true.`);
    }
    if (probe.kind === 'not_found') {
      throw new Error(`Bucket "${AUCTION_IMAGES_BUCKET}" was reported but not listable (404). It may have been removed or renamed.`);
    }
    const statusTxt = typeof probe.error?.status !== 'undefined' ? `status ${probe.error.status}` : 'unknown status';
    throw new Error(`Bucket "${AUCTION_IMAGES_BUCKET}" probe failed (${statusTxt}): ${probe.error?.message || 'Unknown error'}`);
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
    // Ensure bucket exists and is accessible first for clearer error feedback
    await verifyBucketExists();

    const ext = deriveExtension(file);
    const path = buildPath({ eventId, itemId, ext });

    // Perform upload
    const { error: uploadError } = await supabase.storage
      .from(AUCTION_IMAGES_BUCKET)
      .upload(path, file, { cacheControl: '3600', upsert: true });

    if (uploadError) {
      const projectRef = getProjectRef();
      const msgLower = (uploadError.message || '').toLowerCase();
      const statusTxt = typeof uploadError.status !== 'undefined' ? `status ${uploadError.status}` : 'unknown status';
      let hint = '';
      if (uploadError.status === 404 || msgLower.includes('not found')) {
        hint = `Bucket "${AUCTION_IMAGES_BUCKET}" not found. Verify the exact bucket slug (Storage > Buckets) and ensure client points to project "${projectRef}".`;
      } else if (uploadError.status === 401 || msgLower.includes('unauthorized') || msgLower.includes('401')) {
        hint = `Unauthorized (401). Ensure REACT_APP_SUPABASE_KEY is the anon public key and review Storage policies.`;
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
        `Failed to retrieve public URL from bucket "${AUCTION_IMAGES_BUCKET}" on project "${projectRef}". ${pubErr.message || ''}`.trim()
      );
      return { path, publicUrl: null, error: enhanced };
    }

    return { path, publicUrl: pub?.publicUrl || null, error: null };
  } catch (e) {
    return { path: null, publicUrl: null, error: e };
  }
}

// PUBLIC_INTERFACE
export { AUCTION_IMAGES_BUCKET } from '../constants/storage';

export default {
  uploadPublicImageToBucket,
  verifyBucketExists,
  checkStorageAccess,
};
