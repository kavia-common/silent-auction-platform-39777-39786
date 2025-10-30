import { useEffect, useMemo, useState, useRef } from 'react';
import { useParams } from 'react-router-dom';
import ItemCard from '../components/ItemCard';
import SimpleChart from '../components/SimpleChart';
import AddItemModal from '../components/AddItemModal.jsx';
import ImageUploadModal from '../components/ImageUploadModal.jsx';
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
   * Host dashboard with winners and analytics.
   */
  const { eventId } = useParams();
  const [items, setItems] = useState([]);
  const [highBids, setHighBids] = useState({});
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ title: '', description: '', starting_bid: 0 });
  const [addOpen, setAddOpen] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [eventRow, setEventRow] = useState(null);
  const [updatingStatus, setUpdatingStatus] = useState(false);

  const [closedItems, setClosedItems] = useState({});
  const [winners, setWinners] = useState([]);
  const [confetti, setConfetti] = useState([]);
  const [imageModalOpen, setImageModalOpen] = useState(false);
  const [selectedItemForImage, setSelectedItemForImage] = useState(null);

  // Analytics
  const [tableRows, setTableRows] = useState([]);
  const [series, setSeries] = useState([]);
  const bidsRealtimeUnsubRef = useRef(null);

  const sortedItems = useMemo(() => items.slice().sort((a, b) => (a.id > b.id ? 1 : -1)), [items]);
  const auctionStatus = getNormalizedEventStatus(eventRow);
  const isClosed = auctionStatus === 'closed';

  const refreshHighBid = async (itemId) => {
    const { data } = await getHighBid(itemId);
    setHighBids((prev) => ({ ...prev, [itemId]: data?.amount || null }));
  };

  const refreshAnalytics = async () => {
    if (!eventId) return;
    const [{ data: highs }, { data: counts }, { data: ts }] = await Promise.all([
      getHighestBidPerItem(eventId),
      getBidCountsPerItem(eventId),
      getBidsTimeSeries(eventId, { bucketSizeMs: 30_000, durationMs: 30 * 60 * 1000 })
    ]);
    const rows = (items || []).map(it => {
      const title = (it.title && String(it.title).trim()) ? it.title : '';
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

  const loadItems = async () => {
    setLoading(true);
    try {
      const { data, error: err } = await listItems(eventId);
      if (err) throw new Error(err.message || 'Failed to load items');
      const list = Array.isArray(data) ? data : [];
      setItems(list);
      list.forEach((it) => refreshHighBid(it.id));
      // Important: initial analytics fetch before subscribing
      await refreshAnalytics();
    } catch (e) {
      setError(e?.message || 'Network error while loading items');
    } finally {
      setLoading(false);
    }
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
    // Initial fetches BEFORE wiring realtime
    loadEvent().then(async () => {
      await loadItems();
      // If already closed on mount, try to fetch winners immediately with short retry/backoff
      const latest = await getEventById(eventId);
      const latestStatus = getNormalizedEventStatus(latest?.data || null);
      if (latestStatus === 'closed') {
        const attempts = [0, 300, 300];
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
          console.warn('Winners fetch retry (host, mount):', wErr?.message);
        }
        if (!loaded) {
          const { data } = await getWinnersForEvent(eventId);
          setWinners(Array.isArray(data) ? data : []);
        }
      }
    });

    // Then attach realtime subscriptions
    const unsubscribeItems = subscribeToItems(eventId, () => {
      loadItems();
    });

    const unsubscribeEvent = subscribeToEvent(eventId, async () => {
      await loadEvent();
      const latest = await getEventById(eventId);
      const latestStatus = getNormalizedEventStatus(latest?.data || null);
      if (latestStatus === 'closed') {
        // short retry/backoff after status close to allow DB to settle
        const attempts = [0, 300, 300];
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
          console.warn('Winners fetch retry (host, event sub):', wErr?.message);
        }
        if (!loaded) {
          const { data } = await getWinnersForEvent(eventId);
          setWinners(Array.isArray(data) ? data : []);
        }
      } else {
        setWinners([]);
      }
    });

    if (bidsRealtimeUnsubRef.current) {
      bidsRealtimeUnsubRef.current();
    }
    bidsRealtimeUnsubRef.current = subscribeToBidsForEvent(eventId, () => {
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
    setError('');
    setStatus('');
    setUpdatingStatus(true);
    try {
      const { error: err } = await updateAuctionStatus(eventId, 'closed');
      if (err) throw new Error(err.message || 'Failed to close auction');
      setStatus('Auction closed');
      await loadEvent();
      const attempts = [0, 300, 300];
      let winnersLoaded = false;
      for (let i = 0; i < attempts.length; i++) {
        if (attempts[i] > 0) await new Promise((r) => setTimeout(r, attempts[i]));
        const { data, error: wErr } = await getWinnersForEvent(eventId);
        if (!wErr) {
          setWinners(Array.isArray(data) ? data : []);
          winnersLoaded = true;
          break;
        }
        // eslint-disable-next-line no-console
        console.warn('Winners fetch retry (host):', wErr?.message);
      }
      if (!winnersLoaded) {
        const { data } = await getWinnersForEvent(eventId);
        setWinners(Array.isArray(data) ? data : []);
      }
      // Trigger lightweight confetti burst
      const dots = Array.from({ length: 18 }).map((_, i) => ({
        id: i,
        left: `${50 + (Math.random() * 30 - 15)}%`,
        top: '10%',
        bg: [ 'var(--primary)', 'var(--secondary)', '#60A5FA', '#FCD34D' ][i % 4],
        delay: `${Math.random() * 120}ms`
      }));
      setConfetti(dots);
      setTimeout(() => setConfetti([]), 900);
    } catch (e) {
      setError(e?.message || 'Failed to close auction');
    } finally {
      setUpdatingStatus(false);
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

  const thStyle = { textAlign: 'left', padding: '10px 8px', borderBottom: '1px solid var(--border)', color: 'var(--muted)', fontWeight: 600 };
  const tdStyle = { padding: '10px 8px' };

  return (
    <div className="container page">
      <h2 className="page__title">Host Dashboard</h2>
      <p className="page__subtitle">
        Event ID: <code>{eventId}</code>
        {eventRow?.code ? <> · Join code: <strong>{eventRow.code}</strong></> : null}
      </p>

      {/* Confetti overlay */}
      {confetti.length > 0 && (
        <div className="confetti-layer" aria-hidden="true">
          {confetti.map(dot => (
            <div
              key={dot.id}
              className="confetti-dot"
              style={{
                left: dot.left,
                top: dot.top,
                background: dot.bg,
                animationDelay: dot.delay
              }}
            />
          ))}
        </div>
      )}

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card__header">
          <h3 className="card__title">Auction Controls</h3>
          <span className={`badge ${isClosed ? '' : 'badge--primary'}`}>Status: {auctionStatus}</span>
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 8, flexWrap: 'wrap' }}>
          <button className="btn btn--primary" onClick={handleOpen} disabled={updatingStatus || !isClosed}>Open Auction</button>
          <button className="btn btn--secondary" onClick={handleClose} disabled={updatingStatus || isClosed}>Close Auction</button>
        </div>
        <div className="hint" style={{ marginTop: 8 }} role="status" aria-live="polite">
          Opening sets events.status='open' and events.is_open=true (if available). Closing sets events.status='closed' and events.is_open=false (if available).
        </div>
      </div>

      {isClosed && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card__header">
            <h3 className="card__title">Winners</h3>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span className="badge">Computed on close</span>
              {winners.length > 0 && (<button className="btn btn--secondary" onClick={exportCsv}>Export CSV</button>)}
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
          <div className="hint" style={{ marginTop: 8 }}>Winner = highest bid per item (ties resolved by earliest bid time).</div>
        </div>
      )}

      <div className="card">
        <div className="card__header" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 className="card__title">Add Item</h3>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button
              type="button"
              className="btn btn--secondary"
              onClick={() => setAddOpen(true)}
              aria-label="Open Add Item modal with image upload"
              title="Add Item with Image"
            >
              Add Item (with Image)
            </button>
          </div>
        </div>
        <div className="hint" style={{ marginBottom: 8 }}>
          Tip: Use “Add Item (with Image)” to attach a photo. Or use the quick form below without images.
        </div>
        <form onSubmit={handleAddItem} className="form form--inline">
          <div className="field">
            <label htmlFor="title" className="field__label">Title</label>
            <input id="title" className="field__input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g., Art Print #7" required />
          </div>
          <div className="field">
            <label htmlFor="desc" className="field__label">Description</label>
            <input id="desc" className="field__input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Short description" />
          </div>
          <div className="field">
            <label htmlFor="start" className="field__label">Starting bid</label>
            <input id="start" type="number" className="field__input" value={form.starting_bid} onChange={(e) => setForm({ ...form, starting_bid: e.target.value })} min="0" step="1" placeholder="0" />
          </div>
          <button type="submit" className="btn btn--primary">Add</button>
        </form>
        {status ? <div className="alert alert--success">{status}</div> : null}
        {error ? <div className="alert alert--error">{error}</div> : null}
      </div>

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
                height={180}
                color="var(--primary)"
                bg="linear-gradient(120deg, rgba(37,99,235,0.04), rgba(255,255,255,1))"
                ariaLabel="Bids over time"
              />
            ) : (
              <div>
                <div className="skeleton skeleton--title" />
                <div className="skeleton skeleton--block" style={{ marginTop: 10 }} />
                <p className="card__text" style={{ marginTop: 10 }}>No recent bids yet. Activity will appear here in real time.</p>
              </div>
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
                height={180}
                color="var(--secondary)"
                bg="linear-gradient(120deg, rgba(245,158,11,0.05), rgba(255,255,255,1))"
                ariaLabel="Bids per item"
              />
            ) : (
              <div>
                <div className="skeleton skeleton--title" />
                <div className="skeleton skeleton--block" style={{ marginTop: 10 }} />
                <p className="card__text" style={{ marginTop: 10 }}>No bids yet. Bars will appear as bids are placed.</p>
              </div>
            )}
          </div>
        </div>
      </div>

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
                    <td style={tdStyle}><span className="badge badge--primary">{Number(row.highest || 0).toLocaleString()}</span></td>
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
          {loading ? (
            <div className="card" aria-busy="true" aria-live="polite">
              <div className="skeleton skeleton--title" />
              <div style={{ marginTop: 10 }} className="skeleton skeleton--text" />
              <div style={{ marginTop: 12 }} className="skeleton skeleton--block" />
            </div>
          ) : null}
          {!loading && sortedItems.length === 0 ? (
            <div className="card">
              <p className="card__text">No items yet. Add your first item above.</p>
            </div>
          ) : null}
          <div className="grid grid--cards">
            {sortedItems.map((it) => {
              const disabled = !!closedItems[it.id] || isClosed;
              return (
                <ItemCard
                  key={it.id}
                  item={it}
                  highBid={highBids[it.id] ?? null}
                  allowBid={false}
                  onDelete={() => handleDeleteItem(it.id)}
                  onAddImage={() => { setSelectedItemForImage(it); setImageModalOpen(true); }}
                />
              );
            })}
          </div>
        </div>
      </div>
      <AddItemModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        eventId={eventId}
        onAdded={async ({ image_path }) => {
          // Create a minimal item using the standard form fields and storage object path
          const { error: addErr } = await addItem(eventId, {
            title: form.title.trim() || 'Untitled Item',
            description: form.description.trim() || '',
            starting_bid: Number(form.starting_bid || 0),
            image_path
          });
          if (!addErr) {
            setAddOpen(false);
            setForm({ title: '', description: '', starting_bid: 0 });
            loadItems();
          } else {
            setError(addErr.message || 'Failed to add item');
          }
        }}
      />
      <ImageUploadModal
        open={imageModalOpen}
        onClose={() => { setImageModalOpen(false); setSelectedItemForImage(null); }}
        eventId={eventId}
        item={selectedItemForImage}
        onUploaded={() => { setImageModalOpen(false); setSelectedItemForImage(null); loadItems(); }}
      />
    </div>
  );
}
