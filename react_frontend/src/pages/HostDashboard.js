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
  getNormalizedEventStatus,
  getWinnersForEvent,
  getWinnerForItem
} from '../services/auctionService';

// PUBLIC_INTERFACE
export default function HostDashboard() {
  /**
   * Host dashboard to manage auction items and see current high bids.
   * Realtime updates for item and event status changes.
   * Event-level open/close uses events.status + events.is_open when available.
   * Per-item close is tracked client-side for host convenience; when an item is closed client-side,
   * we compute its winner and disable further bids visually.
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

  // Per-item close: host-only client-side guard
  const [closedItems, setClosedItems] = useState({});
  const [winners, setWinners] = useState([]);

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

  const refreshWinnersIfClosed = async (evtId) => {
    if (!evtId) return;
    const { data, error: wErr } = await getWinnersForEvent(evtId);
    if (wErr) {
      // eslint-disable-next-line no-console
      console.warn('Failed to compute winners:', wErr.message);
      return;
    }
    setWinners(data || []);
  };

  useEffect(() => {
    loadEvent();
    loadItems();
    const unsubscribeItems = subscribeToItems(eventId, () => {
      loadItems();
    });
    const unsubscribeEvent = subscribeToEvent(eventId, async () => {
      await loadEvent();
      const latest = await getEventById(eventId);
      const latestStatus = getNormalizedEventStatus(latest?.data || null);
      if (latestStatus === 'closed') {
        refreshWinnersIfClosed(eventId);
      }
    });
    return () => {
      unsubscribeItems();
      unsubscribeEvent();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  useEffect(() => {
    if (isClosed) {
      refreshWinnersIfClosed(eventId);
    } else {
      // Clear winners if reopened
      setWinners([]);
      setClosedItems({});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isClosed, eventId]);

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

  const handleCloseItem = async (itemId) => {
    // Client-side item close for host-only visualization. If schema supports server persistence (closed_at/is_open),
    // this could be extended in future steps. For now we guard via UI and compute a winner snapshot.
    setClosedItems((prev) => ({ ...prev, [itemId]: true }));
    const { data } = await getWinnerForItem(itemId);
    setWinners((prev) => {
      const others = prev.filter((w) => w.item_id !== itemId);
      const target = items.find((i) => i.id === itemId);
      return [
        ...others,
        {
          item_id: itemId,
          title: target?.title || '',
          starting_bid: target?.starting_bid ?? 0,
          winning_bid_id: data?.id || null,
          winning_amount: data?.amount != null ? Number(data.amount) : null,
          bidder_name: data?.bidder_name || null,
          bid_time: data?.created_at || null
        }
      ];
    });
  };

  const handleOpen = async () => {
    setUpdatingStatus(true);
    const { error: err } = await updateAuctionStatus(eventId, 'open');
    setUpdatingStatus(false);
    if (err) {
      setError(err.message || 'Failed to open auction');
    } else {
      setStatus('Auction opened');
      setClosedItems({});
      setWinners([]);
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
      await loadEvent();
      await refreshWinnersIfClosed(eventId);
    }
  };

  const exportCsv = () => {
    const headers = ['Item Title','Starting Bid','Winning Amount','Winner Name','Bid Time'];
    const rows = (winners || []).map(w => [
      (w.title || '').replace(/"/g,'""'),
      w.starting_bid != null ? Number(w.starting_bid) : '',
      w.winning_amount != null ? Number(w.winning_amount) : '',
      (w.bidder_name || '').replace(/"/g,'""'),
      w.bid_time || ''
    ]);
    const csv = [headers, ...rows].map(r => r.map(v => `"${v}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'winners.csv';
    a.click();
    URL.revokeObjectURL(url);
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
          Opening sets events.status='open' and events.is_open=true (if available).
          Closing sets events.status='closed' and events.is_open=false (if available).
        </div>
      </div>

      {isClosed && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card__header">
            <h3 className="card__title">Winners</h3>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span className="badge">Computed on close</span>
              {winners.length > 0 && (
                <button className="btn btn--secondary" onClick={exportCsv}>
                  Export CSV
                </button>
              )}
            </div>
          </div>
          {winners.length === 0 ? (
            <p className="card__text">No winners yet. This event may have no items or no bids.</p>
          ) : (
            <div>
              {winners.map((w) => (
                <div key={w.item_id} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                  <div>
                    <strong>{w.title || 'Item'}</strong>
                    <div className="hint">Starting: {Number(w.starting_bid || 0).toLocaleString()}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div>Winner: <strong>{w.bidder_name || '—'}</strong></div>
                    <div>Amount: <span className="badge badge--primary">{w.winning_amount != null ? Number(w.winning_amount).toLocaleString() : '—'}</span></div>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="hint" style={{ marginTop: 8 }}>
            Winner = highest bid per item (ties resolved by earliest bid time).
          </div>
        </div>
      )}

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
            {sortedItems.map((it) => {
              const disabled = !!closedItems[it.id] || isClosed;
              return (
                <div key={it.id} className="card">
                  <div className="card__header">
                    <h3 className="card__title">{it.title}</h3>
                    <div style={{ display: 'flex', gap: 8 }}>
                      {!isClosed && !closedItems[it.id] && (
                        <button className="btn btn--text btn--danger" onClick={() => handleCloseItem(it.id)}>
                          Close Item
                        </button>
                      )}
                      <button className="btn btn--text btn--danger" onClick={() => handleDeleteItem(it.id)}>
                        Delete
                      </button>
                    </div>
                  </div>
                  {it.description ? <p className="card__text">{it.description}</p> : null}
                  <div className="item-card__meta">
                    <span className="badge">Starting: {Number(it.starting_bid || 0).toLocaleString()}</span>
                    <span className="badge badge--primary">Current: {Number(highBids[it.id] ?? it.starting_bid ?? 0).toLocaleString()}</span>
                    {closedItems[it.id] && !isClosed ? <span className="badge">Closed</span> : null}
                  </div>
                  <div className="hint">{disabled ? 'Bidding disabled for this item.' : 'Item is open for bidding.'}</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
