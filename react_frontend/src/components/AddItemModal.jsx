import { useEffect, useMemo, useRef, useState } from 'react';
import Modal from './Modal';
import { addItem } from '../services/auctionService';

// PUBLIC_INTERFACE
export default function AddItemModal({ open, onClose, eventId, onAdded }) {
  /**
   * Modal to add an item with image upload (optional).
   * - Clicking 'Add Image' opens hidden file input (no focus shift to description).
   * - Shows preview and progress.
   * - Disables UI while uploading/saving.
   */
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [startingBid, setStartingBid] = useState(0);
  const [imageFile, setImageFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [uploadProgress, setUploadProgress] = useState(0);
  const fileInputRef = useRef(null);

  // Reset state when modal closes
  useEffect(() => {
    if (!open) {
      setTitle('');
      setDescription('');
      setStartingBid(0);
      setImageFile(null);
      setPreviewUrl('');
      setError('');
      setUploadProgress(0);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }, [open]);

  const onPickFile = (e) => {
    const f = e.target.files?.[0] || null;
    setImageFile(f || null);
    setPreviewUrl(f ? URL.createObjectURL(f) : '');
    setUploadProgress(0);
  };

  const triggerFilePicker = () => {
    // Programmatically open file picker
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const canSubmit = useMemo(() => {
    return !busy && title.trim().length > 0 && !!eventId;
  }, [busy, title, eventId]);

  const onSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!eventId) {
      setError('Missing event context');
      return;
    }
    if (!title.trim()) {
      setError('Item title is required');
      return;
    }
    setBusy(true);
    setUploadProgress(imageFile ? 10 : 0);
    try {
      const { data, error: addErr } = await addItem(
        eventId,
        {
          title: title.trim(),
          description: description.trim(),
          starting_bid: Number(startingBid || 0),
        },
        imageFile || undefined
      );

      if (imageFile) setUploadProgress(90);

      if (addErr) {
        if (data) {
          onAdded && onAdded(data);
        }
        setError(addErr.message || 'Item created but image upload failed');
      } else {
        onAdded && onAdded(data);
        onClose && onClose();
      }
    } catch (e2) {
      setError(e2?.message || 'Failed to add item');
    } finally {
      setUploadProgress(100);
      setTimeout(() => setBusy(false), 150);
    }
  };

  const footer = (
    <>
      <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
      <button className="btn btn--primary" onClick={onSubmit} disabled={!canSubmit}>
        {busy ? (imageFile ? 'Uploading...' : 'Adding...') : 'Add Item'}
      </button>
    </>
  );

  return (
    <Modal open={open} onClose={onClose} title="Add Item" footer={footer}>
      <form className="form" onSubmit={onSubmit}>
        <div className="field">
          <label htmlFor="ai-title" className="field__label">Title</label>
          <input
            id="ai-title"
            className="field__input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            disabled={busy}
          />
        </div>

        <div className="field">
          <label htmlFor="ai-desc" className="field__label">Description</label>
          <input
            id="ai-desc"
            className="field__input"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Short description"
            disabled={busy}
          />
        </div>

        <div className="field">
          <label htmlFor="ai-start" className="field__label">Starting bid</label>
          <input
            id="ai-start"
            type="number"
            min="0"
            step="1"
            className="field__input"
            value={startingBid}
            onChange={(e) => setStartingBid(e.target.value)}
            disabled={busy}
          />
        </div>

        <div className="field">
          <label className="field__label">Image</label>

          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={onPickFile}
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
              Add Image
            </button>
            {imageFile ? (
              <span className="hint">{imageFile.name}</span>
            ) : (
              <span className="hint">Optional</span>
            )}
          </div>
          <div id="ai-image-hint" className="hint">PNG/JPG up to a few MB. Preview below; image will be visible to bidders.</div>
        </div>

        {previewUrl ? (
          <div className="field">
            <label className="field__label">Preview</label>
            <img
              src={previewUrl}
              alt={title ? `Preview of ${title}` : 'Image preview'}
              style={{ width: '100%', maxHeight: 220, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border)' }}
              onError={(e) => { e.currentTarget.style.display = 'none'; }}
            />
          </div>
        ) : null}

        {imageFile && busy ? (
          <div className="field">
            <label className="field__label">Upload</label>
            <div className="progress" aria-live="polite" role="status" style={{ width: '100%', background: 'var(--border)', borderRadius: 6, overflow: 'hidden' }}>
              <div style={{ width: `${uploadProgress}%`, height: 8, background: 'var(--primary)', transition: 'width 200ms' }} />
            </div>
          </div>
        ) : null}

        {error ? <div className="alert alert--error" role="alert">{error}</div> : null}
      </form>
    </Modal>
  );
}
