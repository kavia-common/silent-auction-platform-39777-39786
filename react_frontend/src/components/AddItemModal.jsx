import { useEffect, useMemo, useRef, useState } from 'react';
import Modal from './Modal';
import { verifyBucketExists, uploadItemImage, getSignedImageUrl } from '../services/storageService';
import { AUCTION_IMAGES_LABEL, AUCTION_IMAGES_BUCKET } from '../constants/storage';

/**
 * Refactored AddItemModal:
 * - Enforces private, user-id-prefixed paths and requires authenticated host session.
 * - Displays a signed URL for preview; avoids public URLs when using private buckets.
 */
// PUBLIC_INTERFACE
export default function AddItemModal({ open, onClose, eventId, onUploaded }) {
  /** Simple image upload dialog for a single image file. */
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [signedUrl, setSignedUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileInputRef = useRef(null);

  // Config: bucket slug used for API calls; label is for UI only
  const BUCKET = AUCTION_IMAGES_BUCKET;
  const MAX_SIZE_BYTES = 8 * 1024 * 1024; // 8 MB
  const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif'];

  useEffect(() => {
    if (!open) {
      setFile(null);
      setPreviewUrl('');
      setSignedUrl('');
      setError('');
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    // When modal opens, verify bucket exists for clearer UX
    (async () => {
      try {
        await verifyBucketExists();
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(err);
        setError(err?.message || 'Storage bucket verification failed.');
      }
    })();
  }, [open]);

  const canUpload = useMemo(() => !!(open && eventId && file && !busy && !error), [open, eventId, file, busy, error]);

  const triggerFilePicker = () => {
    if (fileInputRef.current) fileInputRef.current.click();
  };

  const validateFile = (f) => {
    if (!f) return 'Please select an image file.';
    if (f.size > MAX_SIZE_BYTES) return `File too large. Max ${Math.round(MAX_SIZE_BYTES / (1024 * 1024))} MB.`;
    // If type is missing (some browsers), fall back to basic extension test
    const typeOk = f.type ? ACCEPTED_TYPES.includes(f.type) : /\.(png|jpe?g|webp|gif)$/i.test(f.name || '');
    if (!typeOk) return 'Unsupported file type. Please upload PNG, JPG, WEBP, or GIF.';
    return '';
  };

  const onPick = (e) => {
    const f = e.target.files?.[0] || null;
    const msg = validateFile(f);
    if (msg) {
      setError(msg);
      setFile(null);
      setPreviewUrl('');
      return;
    }
    setError('');
    setFile(f);
    setPreviewUrl(f ? URL.createObjectURL(f) : '');
  };

  const onUpload = async (e) => {
    e.preventDefault();
    setError('');
    setSignedUrl('');
    if (!eventId) {
      setError('Missing event context.');
      return;
    }
    if (!file) {
      setError('Please choose an image first.');
      return;
    }
    const msg = validateFile(file);
    if (msg) {
      setError(msg);
      return;
    }

    setBusy(true);
    try {
      // Upload using user-id-prefixed path; requires authenticated session
      const { path, error: uploadErr } = await uploadItemImage(file);
      if (uploadErr) {
        setError(uploadErr.message || 'Failed to upload image. Ensure you are signed in via magic link.');
        return;
      }

      // Provide a signed URL for immediate preview
      const { signedUrl: url, error: signErr } = await getSignedImageUrl(path, 3600);
      if (signErr) {
        setError(signErr.message || 'Image uploaded but failed to create signed URL.');
        return;
      }

      setSignedUrl(url || '');
      if (typeof onUploaded === 'function') onUploaded({ path, signedUrl: url || '' });
    } catch (ex) {
      setError(ex?.message || 'Unexpected error during upload.');
    } finally {
      setBusy(false);
    }
  };

  const footer = (
    <>
      <button className="btn" onClick={onClose} disabled={busy}>Close</button>
      <button className="btn btn--primary" onClick={onUpload} disabled={!canUpload}>
        {busy ? 'Uploading...' : 'Upload Image'}
      </button>
    </>
  );

  return (
    <Modal open={open} onClose={onClose} title="Upload Image" footer={footer}>
      <form className="form" onSubmit={onUpload}>
        <div className="field">
          <label className="field__label">Image</label>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={onPick}
            style={{ display: 'none' }}
            aria-hidden="true"
            tabIndex={-1}
            disabled={busy}
          />

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              type="button"
              className="btn btn--text"
              onClick={triggerFilePicker}
              disabled={busy}
              aria-describedby="ai-image-hint"
            >
              Choose Image
            </button>
            {file ? (
              <span className="hint">{file.name}</span>
            ) : (
              <span className="hint">PNG/JPG/WEBP/GIF, up to 8 MB</span>
            )}
          </div>
          <div id="ai-image-hint" className="hint">Only a single image is required.</div>
          <div className="hint">
            Uploads use storage bucket: <strong>{AUCTION_IMAGES_LABEL}</strong>
            <span className="hint"> (id: {BUCKET})</span>
          </div>
          <div className="hint">Note: You must be authenticated via your magic link to upload.</div>
        </div>

        {previewUrl ? (
          <div className="field">
            <label className="field__label">Preview</label>
            <img
              src={previewUrl}
              alt="Image preview"
              style={{ width: '100%', maxHeight: 240, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border)' }}
            />
          </div>
        ) : null}

        {signedUrl ? (
          <div className="field">
            <label className="field__label">Signed URL (1 hour)</label>
            <input
              readOnly
              className="field__input"
              value={signedUrl}
              onFocus={(e) => e.target.select()}
            />
            <div className="hint">Use this URL temporarily in the app; it will expire. Store the object path for long-term persistence.</div>
          </div>
        ) : null}

        {error ? <div className="alert alert--error" role="alert">{error}</div> : null}
      </form>
    </Modal>
  );
}
