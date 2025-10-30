import { useState } from 'react';
import { uploadPublicOrPrivateItemImage, getDisplayUrlForPath } from '../services/storageService';
import { updateItemImage } from '../services/auctionService';

/**
 * PUBLIC_INTERFACE
 * MinimalImageUploader
 * - Uploads a single image and persists items.image_path only.
 * - Displays a preview via a derived URL resolved at runtime.
 */
export default function MinimalImageUploader({ eventId, itemId, onUploaded }) {
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState('');

  const onPick = (e) => {
    const f = e.target.files?.[0] || null;
    setFile(f);
    setPreview(f ? URL.createObjectURL(f) : '');
  };

  const onUpload = async () => {
    setError('');
    if (!eventId || !itemId || !file) {
      setError('Missing parameters or file');
      return;
    }
    setBusy(true);
    try {
      const { path, error: upErr } = await uploadPublicOrPrivateItemImage(file);
      if (upErr) {
        setError(upErr.message || 'Upload failed');
        setBusy(false);
        return;
      }
      // Persist image_path
      const { error: patchErr } = await updateItemImage(eventId, itemId, file);
      if (patchErr) {
        setError(patchErr.message || 'Failed to save image');
        setBusy(false);
        return;
      }
      // Optional: resolve display URL once saved
      if (path) {
        const { url } = await getDisplayUrlForPath(path, { expiresIn: 3600 });
        if (url) setPreview(url);
      }
      if (typeof onUploaded === 'function') onUploaded({ image_path: path });
    } catch (ex) {
      setError(ex?.message || 'Unexpected error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <div className="card__header">
        <h3 className="card__title">Upload Image</h3>
      </div>
      <div className="field">
        <label htmlFor="miu" className="field__label">Choose image</label>
        <input id="miu" type="file" accept="image/*" className="field__input" onChange={onPick} />
      </div>
      {preview ? (
        <div className="field">
          <label className="field__label">Preview</label>
          <img src={preview} alt="Preview" style={{ width: '100%', maxHeight: 240, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border)' }} />
        </div>
      ) : null}
      {error ? <div className="alert alert--error">{error}</div> : null}
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn btn--primary" onClick={onUpload} disabled={!file || busy}>{busy ? 'Uploading...' : 'Upload'}</button>
      </div>
    </div>
  );
}
