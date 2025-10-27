import { useEffect, useMemo, useRef, useState } from 'react';
import Modal from './Modal';
import { supabase } from '../lib/supabaseClient';
import { verifyBucketExists, STORAGE_CONSTANTS } from '../services/storageService';
import { AUCTION_IMAGES_LABEL } from '../constants/storage';

/**
 * Refactored AddItemModal:
 * - Simplified to ONLY show a single image upload.
 * - No title/description/starting bid; does not persist any item data.
 * - Validates image type and size, uploads to Supabase Storage, and displays the public URL + preview.
 */
// PUBLIC_INTERFACE
export default function AddItemModal({ open, onClose, eventId, onUploaded }) {
  /** Simple image upload dialog for a single image file. */
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [uploadedUrl, setUploadedUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileInputRef = useRef(null);

  // Config: bucket is env-configurable with default ('the auction images')
  const BUCKET = STORAGE_CONSTANTS.BUCKET_NAME;
  const MAX_SIZE_BYTES = 8 * 1024 * 1024; // 8 MB
  const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif'];

  useEffect(() => {
    if (!open) {
      setFile(null);
      setPreviewUrl('');
      setUploadedUrl('');
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
        // Surface the message to both console and UI
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

  const buildPath = (f) => {
    const ext = (f?.name?.split('.')?.pop() || 'jpg').replace(/[^a-z0-9]/gi, '') || 'jpg';
    const safeEvent = String(eventId || '').replace(/[^a-zA-Z0-9-_]/g, '');
    const stamp = Date.now();
    return `${safeEvent}/${stamp}.${ext}`;
  };

  const onUpload = async (e) => {
    e.preventDefault();
    setError('');
    setUploadedUrl('');
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
      // Ensure bucket exists again right before upload, in case user changed env or project state
      await verifyBucketExists();

      const path = buildPath(file);
      const { error: uploadErr } = await supabase.storage
        .from(BUCKET)
        .upload(path, file, { cacheControl: '3600', upsert: true });

      if (uploadErr) {
        setError(uploadErr.message || 'Failed to upload image.');
        return;
      }

      const { data: pub, error: pubErr } = supabase.storage.from(BUCKET).getPublicUrl(path);
      if (pubErr) {
        setError(pubErr.message || 'Failed to get public URL.');
        return;
      }

      const publicUrl = pub?.publicUrl || '';
      setUploadedUrl(publicUrl);
      if (typeof onUploaded === 'function') onUploaded(publicUrl);
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

        {uploadedUrl ? (
          <div className="field">
            <label className="field__label">Uploaded URL</label>
            <input
              readOnly
              className="field__input"
              value={uploadedUrl}
              onFocus={(e) => e.target.select()}
            />
            <div className="hint">Share or copy this URL to use the image elsewhere in the app.</div>
          </div>
        ) : null}

        {error ? <div className="alert alert--error" role="alert">{error}</div> : null}
      </form>
    </Modal>
  );
}
