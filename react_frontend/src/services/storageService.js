import { supabase } from '../lib/supabaseClient';
import { AUCTION_IMAGES_BUCKET } from '../constants/storage';

// Lightweight console-safe logger
const log = {
  info: (...args) => { if (process.env.NODE_ENV !== 'test') { try { console.info('[storage]', ...args); } catch {} } },
  warn: (...args) => { if (process.env.NODE_ENV !== 'test') { try { console.warn('[storage]', ...args); } catch {} } },
  error: (...args) => { if (process.env.NODE_ENV !== 'test') { try { console.error('[storage]', ...args); } catch {} } },
};

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
    message = `Bucket "${AUCTION_IMAGES_BUCKET}" not found on project "${projectRef}". Create it in Supabase (Storage > Create bucket).`;
  } else if (probe.kind === 'unauthorized') {
    message = `Unauthorized (401) to access bucket "${AUCTION_IMAGES_BUCKET}" on project "${projectRef}". Ensure REACT_APP_SUPABASE_KEY is the anon public key and review Storage policies.`;
  } else if (probe.kind === 'forbidden') {
    message = `Forbidden (403) to access bucket "${AUCTION_IMAGES_BUCKET}" on project "${projectRef}". Update Storage policies and ensure you use user-id-prefixed paths.`;
  }
  return { ok: false, kind: probe.kind, message, error: probe.error || null };
}

/**
 * PUBLIC_INTERFACE
 * Verify that the configured bucket exists or is accessible enough for client operations.
 * For anon key, we don't attempt to create the bucket (requires service role).
 */
// PUBLIC_INTERFACE
export async function verifyBucketExists() {
  // We rely on list probe as our capability check for anon clients
  const probe = await probeBucketAccess();
  if (!probe.ok) {
    const projectRef = getProjectRef();
    const statusTxt = typeof probe.error?.status !== 'undefined' ? `status ${probe.error.status}` : 'unknown status';
    throw new Error(`Storage bucket "${AUCTION_IMAGES_BUCKET}" not accessible on project "${projectRef}" (${statusTxt}). ${probe.error?.message || 'Check Storage configuration and policies.'}`);
  }
  return true;
}

/**
 * PUBLIC_INTERFACE
 * Upload an item image enforcing RLS path prefix `${user.id}/${uuid}.${ext}`.
 * Returns { path, error } and intentionally does NOT expose a public URL to avoid public path usage.
 */
// PUBLIC_INTERFACE
export async function uploadItemImage(file) {
  /**
   * Ensures there is an authenticated session (host via magic link),
   * then uploads into bucket using a user-id-prefixed key to satisfy storage RLS:
   *   <user_id>/<uuid>.<ext>
   */
  if (!file) return { path: null, error: new Error('No file provided') };

  const { data: sessionData, error: sessionErr } = await supabase.auth.getSession();
  if (sessionErr) {
    log.warn('Failed to get session for upload:', sessionErr);
  }
  const session = sessionData?.session || null;
  const user = session?.user || null;

  if (!user?.id) {
    const hint = 'Please sign in via your magic link to upload images. Once authenticated, try again.';
    const friendly = new Error(`No authenticated session. ${hint}`);
    // For developers: extra console context
    log.error('Upload blocked: no session. Ensure magic link sign-in completed before uploading.');
    return { path: null, error: friendly };
  }

  // Ensure bucket reachable
  try {
    await verifyBucketExists();
  } catch (e) {
    return { path: null, error: e };
  }

  // Build user-id-prefixed path
  const ext = deriveExtension(file);
  // Simple uuid v4-ish without external deps
  const uuid = ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
    (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
  );
  const path = `${user.id}/${uuid}.${ext}`;

  // Upload with upsert=false to avoid accidental overwrite
  const { error: uploadErr } = await supabase.storage
    .from(AUCTION_IMAGES_BUCKET)
    .upload(path, file, { cacheControl: '3600', upsert: false });

  if (uploadErr) {
    const msg = (uploadErr.message || '').toLowerCase();
    if (uploadErr.status === 403 || msg.includes('forbidden') || msg.includes('permission')) {
      log.error('RLS/permission error during upload. Likely path not prefixed with auth.uid() or wrong user. Details:', uploadErr);
      return { path: null, error: new Error('Upload failed due to storage policies. Ensure you are signed in and the upload path matches your user ID.') };
    }
    if (uploadErr.status === 401 || msg.includes('unauthorized')) {
      log.error('Unauthorized upload attempt. Session may have expired.', uploadErr);
      return { path: null, error: new Error('Unauthorized to upload. Please re-authenticate via magic link.') };
    }
    if (uploadErr.status === 404 || msg.includes('not found')) {
      log.error('Bucket not found when uploading to', AUCTION_IMAGES_BUCKET, uploadErr);
      return { path: null, error: new Error(`Storage bucket "${AUCTION_IMAGES_BUCKET}" not found. Verify your Supabase Storage setup.`) };
    }
    log.error('Unexpected upload error:', uploadErr);
    return { path: null, error: new Error(uploadErr.message || 'Upload failed') };
  }

  return { path, error: null };
}

/**
 * PUBLIC_INTERFACE
 * Get a signed URL for a private object path.
 */
// PUBLIC_INTERFACE
export async function getSignedImageUrl(path, expiresIn = 3600) {
  /**
   * Returns { signedUrl, error } for the given storage object path within the bucket.
   * Requires bucket policies to allow createSignedUrl for the current role.
   */
  if (!path) return { signedUrl: null, error: new Error('Path is required') };
  const { data, error } = await supabase.storage
    .from(AUCTION_IMAGES_BUCKET)
    .createSignedUrl(path, expiresIn);
  if (error) {
    log.error('Failed to create signed URL:', error);
    const msg = (error.message || '').toLowerCase();
    if (error.status === 403 || msg.includes('forbidden') || msg.includes('permission')) {
      return { signedUrl: null, error: new Error('Cannot create signed URL due to storage policies.') };
    }
    return { signedUrl: null, error: new Error(error.message || 'Failed to create signed URL') };
  }
  return { signedUrl: data?.signedUrl || null, error: null };
}

// Backward-compatible export name (previous code expects this):
// PUBLIC_INTERFACE
export async function uploadPublicImageToBucket(eventId, itemId, file) {
  /**
   * Legacy wrapper that now enforces private, user-id-prefixed storage paths and returns a signed URL.
   * Returns { path, publicUrl: null, signedUrl, error }.
   */
  const { path, error } = await uploadItemImage(file);
  if (error) return { path: null, publicUrl: null, signedUrl: null, error };
  // Attempt to return a short-lived signed URL for immediate preview
  const { signedUrl, error: signErr } = await getSignedImageUrl(path, 3600);
  if (signErr) {
    return { path, publicUrl: null, signedUrl: null, error: signErr };
  }
  return { path, publicUrl: null, signedUrl, error: null };
}

// PUBLIC_INTERFACE
export { AUCTION_IMAGES_BUCKET } from '../constants/storage';

export default {
  uploadItemImage,
  getSignedImageUrl,
  uploadPublicImageToBucket, // legacy alias
  verifyBucketExists,
  checkStorageAccess,
};
