import { supabase } from '../lib/supabaseClient';
import { AUCTION_IMAGES_BUCKET } from '../constants/storage';

// Lightweight console-safe logger
const log = {
  info: (...args) => { if (process.env.NODE_ENV !== 'test') { try { console.info('[storage]', ...args); } catch {} } },
  warn: (...args) => { if (process.env.NODE_ENV !== 'test') { try { console.warn('[storage]', ...args); } catch {} } },
  error: (...args) => { if (process.env.NODE_ENV !== 'test') { try { console.error('[storage]', ...args); } catch {} } },
};

// Tiny in-memory cache for resolved URLs to avoid repeated generation during a session.
// Keys use "<bucket>::<path>" to support multiple buckets if needed.
const _displayUrlCache = new Map();
/**
 * INTERNAL: get cached url entry if not expired.
 */
function _getCachedDisplayUrl(bucket, path) {
  if (!bucket || !path) return null;
  const key = `${bucket}::${path}`;
  const entry = _displayUrlCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt && Date.now() > entry.expiresAt) {
    _displayUrlCache.delete(key);
    return null;
  }
  return entry.url || null;
}
/**
 * INTERNAL: set cached url entry with optional TTL in seconds (for signed URLs).
 */
function _setCachedDisplayUrl(bucket, path, url, ttlSec = 0) {
  if (!bucket || !path || !url) return;
  const key = `${bucket}::${path}`;
  const expiresAt = ttlSec > 0 ? Date.now() + ttlSec * 1000 : 0;
  _displayUrlCache.set(key, { url, expiresAt });
}

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
    message = `Forbidden (403) to access bucket "${AUCTION_IMAGES_BUCKET}" on project "${projectRef}". Update Storage policies to allow public inserts and reads.`;
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
 * Generate a simple UUID v4 string without external deps.
 */
function uuidv4() {
  return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
    (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
  );
}

/**
 * PUBLIC_INTERFACE
 * Upload an item image with public-insert policy support.
 * Behavior:
 * - If there is a session, prefer user-id path: <user.id>/<uuid>.<ext>
 * - If no session, fall back to 'public/' prefix: public/<uuid>.<ext>
 * - Returns { path, publicUrl, error }
 */
/**
 * Attempt to persist and return a public URL when bucket allows it. If not available,
 * we will try to mint a signed URL (short TTL) for immediate preview only; callers should
 * not store signed URLs, so we return publicUrl=null in that case and rely on path fallback.
 */
export async function uploadPublicOrPrivateItemImage(file) {
  if (!file) return { path: null, publicUrl: null, error: new Error('No file provided') };

  // Ensure bucket reachable
  try {
    await verifyBucketExists();
  } catch (e) {
    return { path: null, publicUrl: null, error: e };
  }

  // Try get session, but don't require it
  let userId = null;
  try {
    const { data } = await supabase.auth.getSession();
    userId = data?.session?.user?.id || null;
  } catch {
    userId = null;
  }

  const ext = deriveExtension(file);
  const key = userId ? `${userId}/${uuidv4()}.${ext}` : `public/${uuidv4()}.${ext}`;

  const { error: uploadErr } = await supabase.storage
    .from(AUCTION_IMAGES_BUCKET)
    .upload(key, file, { cacheControl: '3600', upsert: false });

  if (uploadErr) {
    return { path: null, publicUrl: null, error: new Error(uploadErr.message || 'Upload failed') };
  }

  // Attempt to compute public URL for persistence
  let publicUrl = null;
  try {
    const { data: pub } = supabase.storage.from(AUCTION_IMAGES_BUCKET).getPublicUrl(key);
    publicUrl = pub?.publicUrl || null;
    if (!publicUrl) {
      // As a minimal fallback for preview only (do not persist), try a short-lived signed URL.
      const { data: signed } = await supabase.storage.from(AUCTION_IMAGES_BUCKET).createSignedUrl(key, 300);
      if (signed?.signedUrl) {
        // Cache signed for display resolution speed, but do not return it as publicUrl.
        _setCachedDisplayUrl(AUCTION_IMAGES_BUCKET, key, signed.signedUrl, 300);
      }
    }
  } catch {
    // ignore; leave publicUrl null
  }

  return { path: key, publicUrl: publicUrl || null, error: null };
}

/**
 * PUBLIC_INTERFACE
 * Get a signed URL for a private object path.
 */
// PUBLIC_INTERFACE
export async function getSignedImageUrl(path, expiresIn = 3600) {
  if (!path) return { signedUrl: null, error: new Error('Path is required') };
  const { data, error } = await supabase.storage
    .from(AUCTION_IMAGES_BUCKET)
    .createSignedUrl(path, expiresIn);
  if (error) {
    return { signedUrl: null, error: new Error(error.message || 'Failed to create signed URL') };
  }
  return { signedUrl: data?.signedUrl || null, error: null };
}

/**
 * PUBLIC_INTERFACE
 * Derive a display URL for an object path in a specific bucket.
 * - Attempts supabase.storage.from(bucket).getPublicUrl(path) first.
 * - Falls back to createSignedUrl for private buckets.
 * - Uses a minimal cache to avoid repeated URL generation. Public URLs are cached without TTL.
 * - Signed URLs are cached with a TTL equal to expiresIn seconds.
 * Returns { url, error } where url is safe to use in <img src>.
 */
/**
 * Normalize various path formats into { bucket, objectPath }:
 * - Accepts "bucket/object" or just "object".
 * - Strips leading slashes.
 * - If an http(s) URL is mistakenly stored, return it directly as a url bypass.
 */
function normalizeBucketAndPath(inputBucket, rawPath) {
  let bucket = inputBucket || AUCTION_IMAGES_BUCKET;
  let path = (rawPath || '').trim();

  if (!path) return { bucket, objectPath: '', directUrl: '' };

  // Strip leading slash
  path = path.replace(/^\/+/, '');

  // If full URL accidentally stored, pass it through as direct url
  if (/^https?:\/\//i.test(path)) {
    return { bucket, objectPath: '', directUrl: path };
  }

  // If path starts with "<bucket>/", split and use the detected bucket
  const m = path.match(/^([^/]+)\/(.+)$/);
  if (m) {
    const possibleBucket = m[1];
    const rest = m[2];
    // If matches our known bucket name, switch to that and use remainder as object path
    if (possibleBucket === AUCTION_IMAGES_BUCKET) {
      bucket = possibleBucket;
      path = rest;
    }
  }

  return { bucket, objectPath: path, directUrl: '' };
}

// PUBLIC_INTERFACE
export async function getDisplayUrlForBucketAndPath(bucket, path, opts = {}) {
  const expiresIn = Number(opts.expiresIn || 3600);
  if (!path) return { url: null, error: new Error('Path is required') };

  const norm = normalizeBucketAndPath(bucket, path);
  // If a direct URL was stored, return it as-is
  if (norm.directUrl) {
    return { url: norm.directUrl, error: null };
  }
  const targetBucket = norm.bucket || AUCTION_IMAGES_BUCKET;
  const objectPath = norm.objectPath;

  // Cache hit?
  const cached = _getCachedDisplayUrl(targetBucket, objectPath);
  if (cached) return { url: cached, error: null };

  // Prefer public URL for public-read bucket. This does not require auth/session.
  try {
    const { data } = supabase.storage.from(targetBucket).getPublicUrl(objectPath);
    const publicUrl = data?.publicUrl || null;
    if (publicUrl) {
      // cache public url indefinitely (no expiry)
      _setCachedDisplayUrl(targetBucket, objectPath, publicUrl, 0);
      return { url: publicUrl, error: null };
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[storage] getPublicUrl threw exception; will try signed', { bucket: targetBucket, path: objectPath, message: e?.message });
  }

  // If public URL isn't available (e.g., bucket is private), try a signed URL
  const { data, error } = await supabase.storage.from(targetBucket).createSignedUrl(objectPath, expiresIn);
  if (!error && data?.signedUrl) {
    _setCachedDisplayUrl(targetBucket, objectPath, data.signedUrl, expiresIn);
    return { url: data.signedUrl, error: null };
  }

  // All strategies failed; log minimal diagnostics
  // eslint-disable-next-line no-console
  console.warn('[storage] Failed to resolve display URL for image path', {
    bucket: targetBucket,
    path: objectPath,
    error: error?.message
  });
  return { url: null, error: error || new Error('Could not derive display URL') };
}

/**
 * PUBLIC_INTERFACE
 * Backward-compatible convenience for the default images bucket.
 * Delegates to getDisplayUrlForBucketAndPath to support caching and fallback logic.
 */
// PUBLIC_INTERFACE
export async function getDisplayUrlForPath(path, opts = {}) {
  return getDisplayUrlForBucketAndPath(AUCTION_IMAGES_BUCKET, path, opts);
}

// Backward-compatible export name (previous code expects this):
// PUBLIC_INTERFACE
export async function uploadPublicImageToBucket(eventId, itemId, file) {
  /**
   * Updated wrapper for uploads compatible with public insert policy.
   * Returns { path, publicUrl, signedUrl: null, error }.
   */
  const { path, publicUrl, error } = await uploadPublicOrPrivateItemImage(file);
  return { path, publicUrl: publicUrl || null, signedUrl: null, error };
}

// Legacy private upload retained for callers that want explicit session requirement
// PUBLIC_INTERFACE
export async function uploadItemImage(file) {
  if (!file) return { path: null, error: new Error('No file provided') };
  // Require session
  const { data: sessionData } = await supabase.auth.getSession();
  const user = sessionData?.session?.user || null;
  if (!user?.id) {
    return { path: null, error: new Error('No authenticated session.') };
  }
  await verifyBucketExists();
  const ext = deriveExtension(file);
  const key = `${user.id}/${uuidv4()}.${ext}`;
  const { error } = await supabase.storage.from(AUCTION_IMAGES_BUCKET).upload(key, file, { cacheControl: '3600', upsert: false });
  if (error) return { path: null, error: new Error(error.message || 'Upload failed') };
  return { path: key, error: null };
}

// PUBLIC_INTERFACE
export { AUCTION_IMAGES_BUCKET } from '../constants/storage';

export default {
  uploadItemImage,
  uploadPublicOrPrivateItemImage,
  getSignedImageUrl,
  uploadPublicImageToBucket, // legacy alias points to public-capable flow
  verifyBucketExists,
  checkStorageAccess,
  getDisplayUrlForBucketAndPath,
  getDisplayUrlForPath,
}
