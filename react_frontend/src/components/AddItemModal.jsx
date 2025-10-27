import { useEffect, useMemo, useRef, useState } from 'react';
import Modal from './Modal';
import { addItem } from '../services/auctionService';

// PUBLIC_INTERFACE
export default function AddItemModal({ open, onClose, eventId, onAdded }) {
  /**
   * Modal to add an item with a single 'Add Image' control (optional).
   * Handles image preview, disabled states while uploading/adding, and errors.
   * Props:
   * - open: boolean
   * - onClose: function
   * - eventId: string (required)
   * - onAdded: function(item) called on success
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
    // Reset progress on new pick
    setUploadProgress(0);
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
      // auctionService.addItem handles optional image upload to storage and item_image_url persistence
      const { data, error: addErr } = await addItem(
        eventId,
        {
          title: title.trim(),
          description: description.trim(),
          starting_bid: Number(startingBid || 0),
        },
        imageFile || undefined
      );

      // Simulate minimal progress feedback since Supabase JS upload doesn't expose progress callbacks here
      if (imageFile) setUploadProgress(90);

      if (addErr) {
        // Keep item created but warn the user about image upload failure
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
      setTimeout(() => setBusy(false), 150); // small delay for smoother UX
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
          <label htmlFor="ai-image" className="field__label">Add Image</label>
          <input
            id="ai-image"
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="field__input"
            onChange={onPickFile}
            aria-describedby="ai-image-hint"
            disabled={busy}
          />
          <div id="ai-image-hint" className="hint">PNG/JPG up to a few MB. Preview below; image will be visible to bidders.</div>
        </div>

        {previewUrl ? (
          <div className="field">
            <label className="field__label">Preview</label>
            <img
              src={previewUrl}
              alt={title ? `Preview of ${title}` : 'Image preview'}
              style={{ width: '100%', maxHeight: 220, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border)' }}
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
