import { useEffect, useMemo, useState, useRef } from 'react';
import { useParams } from 'react-router-dom';
import ItemCard from '../components/ItemCard';
import SimpleChart from '../components/SimpleChart';
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
  getWinnerForItem,
  getHighestBidPerItem,
  getBidCountsPerItem,
  getBidsTimeSeries,
  subscribeToBidsForEvent
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

  // Analytics state
  const [tableRows, setTableRows] = useState([]); // { id, title, highest, count }
  const [series, setSeries] = useState([]); // bids over time
  const bidsRealtimeUnsubRef = useRef(null);

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
    const list = Array.isArray(data) ? data : [];
    setItems(list);
    list.forEach((it) => refreshHighBid(it.id));
    // Refresh analytics table and charts after loading items
    await refreshAnalytics();
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
      setWinners([]);
      return;
    }
    setWinners(Array.isArray(data) ? data : []);
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
    // Bids realtime for event-level analytics refresh
    if (bidsRealtimeUnsubRef.current) {
      bidsRealtimeUnsubRef.current();
    }
    bidsRealtimeUnsubRef.current = subscribeToBidsForEvent(eventId, () => {
      // Near real-time analytics refresh
      refreshAnalytics();
    });

    return () => {
      unsubscribeItems();
      unsubscribeEvent();
      if (bidsRealtimeUnsubRef.current) {
        bidsRealtimeUnsubRef.current();
        bidsRealtimeUnsubRef.current = null;
      }
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

  const refreshAnalytics = async () => {
    if (!eventId) return;
    // Highest per item
    const [{ data: highs }, { data: counts }, { data: ts }] = await Promise.all([
      getHighestBidPerItem(eventId),
      getBidCountsPerItem(eventId),
      getBidsTimeSeries(eventId, { bucketSizeMs: 30000, durationMs: 30 * 60 * 1000 }) // 30s buckets, last 30 min
    ]);
    const rows = (items || []).map(it => {
      const title = (it.title && String(it.title).trim()) ? it.title : (it.name || '');
      return {
        id: it.id,
        title,
        highest: highs ? highs[it.id] ?? Number(it.starting_bid || 0) : Number(it.starting_bid || 0),
        count: counts ? (counts[it.id] || 0) : 0
      };
    });
    setTableRows(rows);
    setSeries(Array.isArray(ts) ? ts : []);
  };

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
      return;
    }
    setStatus('Auction closed');
    await loadEvent();

    // Force-refresh winners immediately with small retry/backoff in case of replica lag.
    const attempts = [0, 300, 700, 1500]; // ms backoff schedule
    let loaded = false;
    for (let i = 0; i < attempts.length; i++) {
      if (attempts[i] > 0) await new Promise(r => setTimeout(r, attempts[i]));
      const { data, error: wErr } = await getWinnersForEvent(eventId);
      if (!wErr) {
        setWinners(Array.isArray(data) ? data : []);
        loaded = true;
        break;
      }
      // eslint-disable-next-line no-console
      console.warn('Winner fetch retry due to error:', wErr?.message);
    }
    if (!loaded) {
      // Final attempt without considering error state fatal; show empty state message
      const { data } = await getWinnersForEvent(eventId);
      setWinners(Array.isArray(data) ? data : []);
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

  const thStyle = {
    textAlign: 'left',
    padding: '10px 8px',
    borderBottom: '1px solid var(--border)',
    color: 'var(--muted)',
    fontWeight: 600
  };
  const tdStyle = {
    padding: '10px 8px'
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
            <p className="card__text">No winners yet. Either items have no bids or results are finalizing. This section updates live.</p>
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

      {/* Analytics section */}
      <div className="grid" style={{ marginTop: 16 }}>
        <div className="col">
          <h3 className="section__title">Live Bidding Activity</h3>
          <div className="card">
            <div className="card__header">
              <h4 className="card__title">Bids over time (last 30 min)</h4>
              <span className="badge">Auto-updates</span>
            </div>
            {series && series.length > 0 ? (
              <SimpleChart
                type="area"
                data={series}
                width={680}
                height={160}
                color="var(--primary)"
                bg="linear-gradient(120deg, rgba(37,99,235,0.04), rgba(255,255,255,1))"
                ariaLabel="Bids over time"
              />
            ) : (
              <p className="card__text">No recent bids yet. Activity will appear here in real time.</p>
            )}
          </div>
        </div>
        <div className="col">
          <h3 className="section__title">Bids per Item</h3>
          <div className="card">
            <div className="card__header">
              <h4 className="card__title">Bar chart</h4>
              <span className="badge">Auto-updates</span>
            </div>
            {tableRows && tableRows.length > 0 && tableRows.some(r => r.count > 0) ? (
              <SimpleChart
                type="bar"
                data={tableRows.map((r, idx) => ({ x: idx, y: r.count }))}
                width={680}
                height={160}
                color="var(--secondary)"
                bg="linear-gradient(120deg, rgba(245,158,11,0.05), rgba(255,255,255,1))"
                ariaLabel="Bids per item"
              />
            ) : (
              <p className="card__text">No bids yet. Bars will appear as bids are placed.</p>
            )}
          </div>
        </div>
      </div>

      {/* Real-time items table */}
      <div className="card" style={{ marginTop: 16 }}>
        <div className="card__header">
          <h3 className="card__title">Real-time Items</h3>
          <span className="badge">Updates within ~1s</span>
        </div>
        {tableRows.length === 0 ? (
          <p className="card__text">No items yet. Add items above to see them here.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={thStyle}>Item Name</th>
                  <th style={thStyle}>Current Highest Bid</th>
                  <th style={thStyle}># of Bids</th>
                </tr>
              </thead>
              <tbody>
                {tableRows.map((row) => (
                  <tr key={row.id} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={tdStyle}>{row.title || 'Item'}</td>
                    <td style={tdStyle}>
                      <span className="badge badge--primary">{Number(row.highest || 0).toLocaleString()}</span>
                    </td>
                    <td style={tdStyle}>{Number(row.count || 0).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="grid" style={{ marginTop: 16 }}>
        <div className="col">
          <h3 className="section__title">Items</h3>
          {loading ? <div className="hint">Loading items…</div> : null}
          {!loading && sortedItems.length === 0 ? (
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
