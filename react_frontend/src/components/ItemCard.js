import { useState } from 'react';

// PUBLIC_INTERFACE
export default function ItemCard({ item, highBid, allowBid = false, onBid, onDelete }) {
  /**
   * Card for displaying an auction item.
   * Props:
   * - item: { id, title, description, starting_bid }
   * - highBid: number | null
   * - allowBid: boolean
   * - onBid: function(amount) -> Promise or void
   * - onDelete: function() -> void
   */
  const [amount, setAmount] = useState('');
  const [error, setError] = useState('');

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

  return (
    <div className="card item-card">
      <div className="card__header">
        <h3 className="card__title">{item.title}</h3>
        {onDelete && (
          <button className="btn btn--text btn--danger" onClick={onDelete} aria-label="Delete item">
            Delete
          </button>
        )}
      </div>
      {item.description ? <p className="card__text">{item.description}</p> : null}
      <div className="item-card__meta">
        <span className="badge">Starting: {Number(item.starting_bid || 0).toLocaleString()}</span>
        <span className="badge badge--primary">
          High bid: {highBid != null ? Number(highBid).toLocaleString() : '—'}
        </span>
      </div>

      {allowBid && (
        <div className="item-card__actions">
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
              placeholder="Enter amount"
            />
          </div>
          <button className="btn btn--primary" onClick={handleBid}>Place Bid</button>
        </div>
      )}
      {error ? <div className="alert alert--error">{error}</div> : null}
    </div>
  );
}
