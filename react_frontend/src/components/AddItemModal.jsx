import { useEffect, useMemo, useRef, useState } from 'react';
import Modal from './Modal';
import { addItem } from '../services/auctionService';

// PUBLIC_INTERFACE
export default function AddItemModal({ open, onClose, eventId, onAdded }) {
  /**
   * Modal to add an item with optional image upload.
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
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (!open) {
      setTitle('');
      setDescription('');
      setStartingBid(0);
      setImageFile(null);
      setPreviewUrl('');
      setError('');
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }, [open]);

  const onPickFile = (e) => {
    const f = e.target.files?.[0] || null;
    setImageFile(f || null);
    setPreviewUrl(f ? URL.createObjectURL(f) : '');
  };

  const canSubmit = useMemo(() => {
    return !busy && title.trim().length > 0 && eventId;
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
    try {
      const { data, error: addErr } = await addItem(eventId, {
        title: title.trim(),
        description: description.trim(),
        starting_bid: Number(startingBid || 0)
      }, imageFile || undefined);
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
      setBusy(false);
    }
  };

  const footer = (
    <>
      <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
      <button className="btn btn--primary" onClick={onSubmit} disabled={!canSubmit}>
        {busy ? 'Adding...' : 'Add Item'}
      </button>
    </>
  );

  return (
    <Modal open={open} onClose={onClose} title="Add Item" footer={footer}>
      <form className="form" onSubmit={onSubmit}>
        <div className="field">
          <label htmlFor="ai-title" className="field__label">Title</label>
          <input id="ai-title" className="field__input" value={title} onChange={(e) => setTitle(e.target.value)} required />
        </div>

        <div className="field">
          <label htmlFor="ai-desc" className="field__label">Description</label>
          <input id="ai-desc" className="field__input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Short description" />
        </div>

        <div className="field">
          <label htmlFor="ai-start" className="field__label">Starting bid</label>
          <input id="ai-start" type="number" min="0" step="1" className="field__input" value={startingBid} onChange={(e) => setStartingBid(e.target.value)} />
        </div>

        <div className="field">
          <label htmlFor="ai-image" className="field__label">Image (optional)</label>
          <input
            id="ai-image"
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="field__input"
            onChange={onPickFile}
            aria-describedby="ai-image-hint"
          />
          <div id="ai-image-hint" className="hint">PNG/JPG up to a few MB. Uploaded to public storage.</div>
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

        {error ? <div className="alert alert--error" role="alert">{error}</div> : null}
      </form>
    </Modal>
  );
}
