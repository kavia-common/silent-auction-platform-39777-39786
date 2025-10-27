import { useEffect, useMemo, useRef, useState } from 'react';
import Modal from './Modal';
import { updateItemImage } from '../services/auctionService';

// PUBLIC_INTERFACE
export default function ImageUploadModal({ open, onClose, eventId, item, onUploaded }) {
  /**
   * Modal for uploading an image for an existing item without changing other fields.
   * Props:
   * - open: boolean
   * - onClose: function
   * - eventId: string (required)
   * - item: { id, title?, name? } (required)
   * - onUploaded: function() called after successful upload+persist
   */
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef(null);

  const title = useMemo(() => {
    if (!item) return '';
    if (item.title && String(item.title).trim()) return item.title;
    return item.name || '';
  }, [item]);

  useEffect(() => {
    if (!open) {
      setFile(null);
      setPreviewUrl('');
      setError('');
      if (fileRef.current) fileRef.current.value = '';
    }
  }, [open]);

  const onPick = (e) => {
    const f = e.target.files?.[0] || null;
    setFile(f);
    setPreviewUrl(f ? URL.createObjectURL(f) : '');
  };

  const canSubmit = useMemo(() => !!(open && eventId && item?.id && file && !busy), [open, eventId, item, file, busy]);

  const onSubmit = async (e) => {
    e.preventDefault();
    if (!eventId || !item?.id || !file) return;
    setBusy(true);
    setError('');
    try {
      const { error: upErr } = await updateItemImage(eventId, item.id, file);
      if (upErr) {
        setError(upErr.message || 'Failed to upload image');
      } else {
        if (typeof onUploaded === 'function') onUploaded();
        if (typeof onClose === 'function') onClose();
      }
    } catch (ex) {
      setError(ex?.message || 'Unexpected error during upload');
    } finally {
      setBusy(false);
    }
  };

  const footer = (
    <>
      <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
      <button className="btn btn--primary" onClick={onSubmit} disabled={!canSubmit}>
        {busy ? 'Uploading...' : 'Upload Image'}
      </button>
    </>
  );

  return (
    <Modal open={open} onClose={onClose} title={`Add Image${title ? ` · ${title}` : ''}`} footer={footer}>
      <form className="form" onSubmit={onSubmit}>
        <div className="field">
          <label htmlFor="iu-image" className="field__label">Choose image</label>
          <input
            id="iu-image"
            ref={fileRef}
            type="file"
            accept="image/*"
            className="field__input"
            onChange={onPick}
            aria-describedby="iu-image-hint"
          />
          <div id="iu-image-hint" className="hint">PNG/JPG recommended. Image will be visible to bidders immediately.</div>
        </div>

        {previewUrl ? (
          <div className="field">
            <label className="field__label">Preview</label>
            <img
              src={previewUrl}
              alt={title ? `Preview of ${title}` : 'Image preview'}
              style={{ width: '100%', maxHeight: 240, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border)' }}
            />
          </div>
        ) : null}

        {error ? <div className="alert alert--error" role="alert">{error}</div> : null}
      </form>
    </Modal>
  );
}
