import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import ItemCard from '../components/ItemCard';
import {
  addItem,
  deleteItem,
  getHighBid,
  listItems,
  subscribeToItems,
  getEventById,
  updateAuctionStatus,
  subscribeToEvent,
  getNormalizedEventStatus
} from '../services/auctionService';

// PUBLIC_INTERFACE
export default function HostDashboard() {
  /**
   * Host dashboard to manage auction items and see current high bids.
   * Realtime updates for item and event status changes.
   */
  const { eventId } = useParams();
  const [items, setItems] = useState([]);
  const [highBids, setHighBids] = useState({});
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ title: '', description: '', starting_bid: 0 });
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [eventRow, setEventRow] = useState(null);
  const [updatingStatus, setUpdatingStatus] = useState(false);

  const sortedItems = useMemo(() => items.slice().sort((a, b) => (a.id > b.id ? 1 : -1)), [items]);
  const auctionStatus = getNormalizedEventStatus(eventRow);
  const isClosed = auctionStatus === 'closed';

  const refreshHighBid = async (itemId) => {
    const { data } = await getHighBid(itemId);
    setHighBids((prev) => ({ ...prev, [itemId]: data?.amount || null }));
  };

  const loadItems = async () => {
    setLoading(true);
    const { data, error: err } = await listItems(eventId);
    setLoading(false);
    if (err) {
      setError(err.message || 'Failed to load items');
      return;
    }
    setItems(data || []);
    (data || []).forEach((it) => refreshHighBid(it.id));
  };

  const loadEvent = async () => {
    const { data, error: err } = await getEventById(eventId);
    if (!err) setEventRow(data || null);
  };

  useEffect(() => {
    loadEvent();
    loadItems();
    const unsubscribeItems = subscribeToItems(eventId, () => {
      // Re-fetch to reflect any change
      loadItems();
    });
    const unsubscribeEvent = subscribeToEvent(eventId, () => {
      loadEvent();
    });
    return () => {
      unsubscribeItems();
      unsubscribeEvent();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  const handleAddItem = async (e) => {
    e.preventDefault();
    setError('');
    setStatus('');
    if (!form.title.trim()) {
      setError('Item title is required');
      return;
    }
    const { error: addErr } = await addItem(eventId, {
      title: form.title.trim(),
      description: form.description.trim(),
      starting_bid: Number(form.starting_bid || 0)
    });
    if (addErr) {
      setError(addErr.message || 'Failed to add item');
      return;
    }
    setStatus('Item added');
    setForm({ title: '', description: '', starting_bid: 0 });
    loadItems();
  };

  const handleDeleteItem = async (id) => {
    setError('');
    const { error: delErr } = await deleteItem(id);
    if (delErr) {
      setError(delErr.message || 'Failed to delete item');
      return;
    }
    setItems((prev) => prev.filter((i) => i.id !== id));
  };

  const handleOpen = async () => {
    setUpdatingStatus(true);
    const { error: err } = await updateAuctionStatus(eventId, 'open');
    setUpdatingStatus(false);
    if (err) {
      setError(err.message || 'Failed to open auction');
    } else {
      setStatus('Auction opened');
      loadEvent();
    }
  };

  const handleClose = async () => {
    setUpdatingStatus(true);
    const { error: err } = await updateAuctionStatus(eventId, 'closed');
    setUpdatingStatus(false);
    if (err) {
      setError(err.message || 'Failed to close auction');
    } else {
      setStatus('Auction closed');
      loadEvent();
    }
  };

  return (
    <div className="container page">
      <h2 className="page__title">Host Dashboard</h2>
      <p className="page__subtitle">
        Event ID: <code>{eventId}</code>
        {eventRow?.code ? <> · Join code: <strong>{eventRow.code}</strong></> : null}
      </p>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card__header">
          <h3 className="card__title">Auction Controls</h3>
          <span className={`badge ${isClosed ? '' : 'badge--primary'}`}>
            Status: {auctionStatus}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 8, flexWrap: 'wrap' }}>
          <button className="btn btn--primary" onClick={handleOpen} disabled={updatingStatus || !isClosed}>
            Open Auction
          </button>
          <button className="btn btn--secondary" onClick={handleClose} disabled={updatingStatus || isClosed}>
            Close Auction
          </button>
        </div>
        <div className="hint" style={{ marginTop: 8 }}>
          When closed, bidders can no longer place new bids. Items remain visible in bidder view.
        </div>
      </div>

      <div className="card">
        <h3 className="card__title">Add Item</h3>
        <form onSubmit={handleAddItem} className="form form--inline">
          <div className="field">
            <label htmlFor="title" className="field__label">Title</label>
            <input
              id="title"
              className="field__input"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="e.g., Art Print #7"
              required
            />
          </div>
          <div className="field">
            <label htmlFor="desc" className="field__label">Description</label>
            <input
              id="desc"
              className="field__input"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Short description"
            />
          </div>
          <div className="field">
            <label htmlFor="start" className="field__label">Starting bid</label>
            <input
              id="start"
              type="number"
              className="field__input"
              value={form.starting_bid}
              onChange={(e) => setForm({ ...form, starting_bid: e.target.value })}
              min="0"
              step="1"
              placeholder="0"
            />
          </div>
          <button type="submit" className="btn btn--primary">Add</button>
        </form>
        {status ? <div className="alert alert--success">{status}</div> : null}
        {error ? <div className="alert alert--error">{error}</div> : null}
      </div>

      <div className="grid">
        <div className="col">
          <h3 className="section__title">Items</h3>
          {loading ? <div>Loading...</div> : null}
          {sortedItems.length === 0 ? (
            <div className="card">
              <p className="card__text">No items yet. Add your first item above.</p>
            </div>
          ) : null}
          <div className="grid grid--cards">
            {sortedItems.map((it) => (
              <ItemCard
                key={it.id}
                item={it}
                highBid={highBids[it.id] ?? null}
                onDelete={() => handleDeleteItem(it.id)}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
