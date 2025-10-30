import { useEffect, useState } from 'react';
import { getDisplayUrlForPath } from '../services/storageService';

function ItemImage({ item, displayTitle }) {
  // Resolves items.image_path to a displayable URL using storageService.
  // Does not depend on auth context; bucket is public-read with signed URL fallback.
  const [src, setSrc] = useState('');
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    async function run() {
      const path = item?.image_path || '';
      if (!path) {
        if (!cancelled) setSrc('');
        return;
      }
      try {
        const { url, error } = await getDisplayUrlForPath(path, { expiresIn: 3600 });
        if (error || !url) {
          // eslint-disable-next-line no-console
          console.warn('[item-card] Image URL resolution failed', { itemId: item?.id, image_path: path, message: error?.message });
          if (!cancelled) {
            setSrc('');
            setFailed(true);
          }
        } else if (!cancelled) {
          setSrc(url);
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[item-card] Exception resolving image URL', { itemId: item?.id, image_path: path, message: e?.message });
        if (!cancelled) {
          setSrc('');
          setFailed(true);
        }
      }
    }
    run();
    return () => { cancelled = true; };
  }, [item?.id, item?.image_path]);

  if (src) {
    return (
      <img
        src={src}
        alt={displayTitle ? `${displayTitle} image` : 'Item image'}
        style={{ width: '100%', maxHeight: 220, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border)', marginBottom: 8 }}
        onError={(e) => { 
          e.currentTarget.style.display = 'none'; 
          // eslint-disable-next-line no-console
          console.warn('[item-card] <img> failed to load', { itemId: item?.id, image_path: item?.image_path });
        }}
      />
    );
  }

  // Graceful placeholder
  return failed ? (
    <div
      aria-hidden="true"
      style={{
        width: '100%',
        height: 200,
        borderRadius: 8,
        border: '1px dashed var(--border)',
        background: '#f8fafc',
        display: 'grid',
        placeItems: 'center',
        color: '#9ca3af',
        marginBottom: 8
      }}
      title="Image unavailable"
    >
      Image unavailable
    </div>
  ) : null;
}

// PUBLIC_INTERFACE
export default function ItemCard({ item, highBid, allowBid = false, onBid, onDelete, onAddImage, hideImage = false }) {
  /**
   * Card for displaying an auction item.
   * Props:
   * - item: { id, title/name, description, starting_bid, image_path? }
   * - highBid: number | null
   * - allowBid: boolean
   * - onBid: function(amount) -> Promise or void
   * - onDelete: function() -> void
   */
  const [amount, setAmount] = useState('');
  const [error, setError] = useState('');

  const displayTitle = (item?.title && String(item.title).trim())
    ? item.title
    : (item?.name || '');

  const currentPrice = highBid != null
    ? Number(highBid)
    : Number(item?.starting_bid || 0);

  const handleBid = async () => {
    setError('');
    if (typeof onBid !== 'function') return;
    const numeric = Number(amount);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      setError('Enter a valid positive amount');
      return;
    }
    try {
      await onBid(numeric);
      setAmount('');
    } catch (e) {
      setError(e?.message || 'Failed to place bid');
    }
  };

  const disabledStyle = !allowBid ? { opacity: 0.6, pointerEvents: 'none' } : undefined;

  return (
    <div className="card item-card" style={{ transition: 'transform var(--transition), box-shadow var(--transition)' }}>
      <div className="card__header">
        <h3 className="card__title">{displayTitle}</h3>
        <div style={{ display: 'flex', gap: 8 }}>
          {onAddImage && (
            <button className="btn btn--text" onClick={onAddImage} aria-label="Add image to item">
              Add Image
            </button>
          )}
          {onDelete && (
            <button className="btn btn--text btn--danger" onClick={onDelete} aria-label="Delete item">
              Delete
            </button>
          )}
        </div>
      </div>
      {!hideImage && <ItemImage item={item} displayTitle={displayTitle} />}
      {item?.description ? <p className="card__text">{item.description}</p> : null}
      <div className="item-card__meta">
        <span className="badge">Starting: {Number(item?.starting_bid || 0).toLocaleString()}</span>
        <span className="badge badge--primary">
          Current: {Number(currentPrice).toLocaleString()}
        </span>
      </div>

      <div className="item-card__actions" style={disabledStyle}>
        <div className="field">
          <label htmlFor={`bid-${item.id}`} className="field__label">Your bid</label>
          <input
            id={`bid-${item.id}`}
            type="number"
            className="field__input"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            min="0"
            step="1"
            placeholder={allowBid ? 'Enter amount' : 'Bidding disabled'}
            disabled={!allowBid}
          />
        </div>
        <button className="btn btn--primary" onClick={handleBid} disabled={!allowBid}>Bid</button>
      </div>
      {error ? <div className="alert alert--error">{error}</div> : null}
    </div>
  );
}
