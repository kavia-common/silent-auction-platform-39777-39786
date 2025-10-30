import { useEffect, useMemo, useState, useRef } from 'react';
import { useParams } from 'react-router-dom';
import ItemCard from '../components/ItemCard';
import {
  getEventByCode,
  getHighBid,
  listItems,
  placeBid,
  subscribeToBids,
  subscribeToItems,
  subscribeToEvent,
  getNormalizedEventStatus,
  getWinnersForEvent,
  getItemDisplayFields
} from '../services/auctionService';
import { getOrCreateClientId } from '../lib/clientId';
import { getDisplayUrlForPath } from '../services/storageService';

// Small helper component to resolve image URL at runtime without exposing raw URL text
function ItemImageRenderer({ item }) {
  const disp = getItemDisplayFields(item);
  const [src, setSrc] = useState('');
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    async function resolve() {
      if (!disp.imagePath) {
        if (!cancelled) setSrc('');
        return;
      }
      try {
        const { url, error } = await getDisplayUrlForPath(disp.imagePath, { expiresIn: 3600 });
        if (error || !url) {
          // eslint-disable-next-line no-console
          console.warn('[bidder] Image URL resolution failed', { itemId: item?.id, image_path: disp.imagePath, message: error?.message });
          if (!cancelled) {
            setSrc('');
            setFailed(true);
          }
        } else if (!cancelled) {
          setSrc(url);
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[bidder] Exception resolving image URL', { itemId: item?.id, image_path: disp.imagePath, message: e?.message });
        if (!cancelled) {
          setSrc('');
          setFailed(true);
        }
      }
    }
    resolve();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disp.imagePath, item?.id]);

  if (src) {
    return (
      <img
        src={src}
        alt={disp.title ? `${disp.title} image` : 'Item image'}
        style={{ width: '100%', maxHeight: 220, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border)', marginBottom: 8 }}
        onError={(e) => { 
          e.currentTarget.style.display = 'none'; 
          // eslint-disable-next-line no-console
          console.warn('[bidder] <img> failed to load', { itemId: item?.id, image_path: disp.imagePath });
        }}
      />
    );
  }

  // Graceful placeholder (no raw URL text)
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

const LS_JOIN_CONTEXT = 'auction.joinContext';

// PUBLIC_INTERFACE
export default function BidderView() {
  /**
   * Bidder page for joining via event code, seeing items, and bidding.
   * Reflects event open/closed via events.status or events.is_open.
   * Automatically displays winners when the event closes.
   */
  const { eventCode } = useParams();
  const [eventId, setEventId] = useState(null);
  const [eventRow, setEventRow] = useState(null);
  const [items, setItems] = useState([]);
  const [highBids, setHighBids] = useState({});
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [toast, setToast] = useState(null);
  const [showWinnerBanner, setShowWinnerBanner] = useState(false);
  const [confetti, setConfetti] = useState([]); // array of confetti dots
  const [winners, setWinners] = useState([]);

  const bidUnsubsRef = useRef([]);
  const eventUnsubRef = useRef(null);

  useEffect(() => {
    // Ensure a clientId exists and preload bidder name from storage if present
    try {
      const cid = getOrCreateClientId();
      const raw = localStorage.getItem(LS_JOIN_CONTEXT);
      const parsed = raw ? JSON.parse(raw) : {};
      if (!parsed.clientId && cid) {
        localStorage.setItem(LS_JOIN_CONTEXT, JSON.stringify({ ...parsed, clientId: cid }));
      }
      if (parsed?.bidderName) setName(parsed.bidderName);
    } catch { /* ignore */ }
  }, []);

  const normalizeItem = (it) => {
    const title = typeof it.title === 'string' && it.title.trim()
      ? it.title
      : (typeof it.name === 'string' ? it.name : '');
    return { ...it, title };
  };

  const sortedItems = useMemo(
    () => items.map(normalizeItem).slice().sort((a, b) => (a.id > b.id ? 1 : -1)),
    [items]
  );

  const auctionStatus = getNormalizedEventStatus(eventRow);
  const isClosed = auctionStatus === 'closed';

  // Trigger a lightweight success banner when winners become available
  useEffect(() => {
    if (isClosed && winners && winners.length > 0) {
      setShowWinnerBanner(true);
      const t = setTimeout(() => setShowWinnerBanner(false), 2500);
      return () => clearTimeout(t);
    }
  }, [isClosed, winners]);

  const loadHighBid = async (itemId) => {
    const { data } = await getHighBid(itemId);
    setHighBids((prev) => ({ ...prev, [itemId]: data?.amount || null }));
  };

  const attachBidRealtime = (itemsList) => {
    // Unsubscribe existing
    bidUnsubsRef.current.forEach((fn) => fn && fn());
    bidUnsubsRef.current = [];
    // Subscribe per-item for realtime high-bid refresh
    (itemsList || []).forEach((it) => {
      const unsub = subscribeToBids(it.id, () => loadHighBid(it.id));
      bidUnsubsRef.current.push(unsub);
    });
  };

  const loadItems = async (evtId) => {
    const { data, error: err } = await listItems(evtId);
    if (err) {
      setError(err.message || 'Failed to load items');
      return;
    }
    const list = data || [];
    setItems(list);
    list.forEach((it) => loadHighBid(it.id));
    attachBidRealtime(list);
  };

  const refreshWinnersIfClosed = async (evtId) => {
    if (!evtId) return;
    if (!isClosed) {
      setWinners([]);
      return;
    }
    // retry/backoff for consistency after close
    const attempts = [0, 300, 300];
    let loaded = false;
    for (let i = 0; i < attempts.length; i++) {
      if (attempts[i] > 0) await new Promise(r => setTimeout(r, attempts[i]));
      const { data, error: wErr } = await getWinnersForEvent(evtId);
      if (!wErr) {
        setWinners(Array.isArray(data) ? data : []);
        loaded = true;
        break;
      }
      // eslint-disable-next-line no-console
      console.warn('Failed to compute winners (bidder retry):', wErr.message);
    }
    if (!loaded) {
      const { data } = await getWinnersForEvent(evtId);
      setWinners(Array.isArray(data) ? data : []);
    }
  };

  useEffect(() => {
    const init = async () => {
      setError('');
      try {
        const { data: evt, error: evtErr } = await getEventByCode(eventCode);
        if (evtErr || !evt) {
          throw new Error(evtErr?.message || 'Event not found. Check the code and try again.');
        }
        setEventId(evt.id);
        setEventRow(evt);

        try {
          const raw = localStorage.getItem(LS_JOIN_CONTEXT);
          const existing = raw ? JSON.parse(raw) : {};
          const updated = {
            ...existing,
            eventId: evt.id,
            eventCode: evt.code,
            bidderName: existing?.bidderName || name || '',
            clientId: existing?.clientId || getOrCreateClientId()
          };
          localStorage.setItem(LS_JOIN_CONTEXT, JSON.stringify(updated));
          if (!name && updated.bidderName) setName(updated.bidderName);
        } catch { /* ignore */ }

        await loadItems(evt.id);

        // If event already closed when mounting, fetch winners with retry/backoff
        const statusNow = getNormalizedEventStatus(evt);
        if (statusNow === 'closed') {
          const attempts = [0, 300, 300];
          let loaded = false;
          for (let i = 0; i < attempts.length; i++) {
            if (attempts[i] > 0) await new Promise(r => setTimeout(r, attempts[i]));
            const { data, error: wErr } = await getWinnersForEvent(evt.id);
            if (!wErr) {
              setWinners(Array.isArray(data) ? data : []);
              loaded = true;
              break;
            }
            // eslint-disable-next-line no-console
            console.warn('Winner fetch retry (bidder mount):', wErr?.message);
          }
          if (!loaded) {
            const { data } = await getWinnersForEvent(evt.id);
            setWinners(Array.isArray(data) ? data : []);
          }
        }

        const unsubItems = subscribeToItems(evt.id, () => loadItems(evt.id));
        const unsubEvent = subscribeToEvent(evt.id, async () => {
          // On any event change, refetch single row to get status/is_open
          const refreshed = await getEventByCode(eventCode);
          if (refreshed?.data) {
            setEventRow(refreshed.data);
            // If auction is now closed, load winners immediately (short retry/backoff)
            const newStatus = getNormalizedEventStatus(refreshed.data);
            if (newStatus === 'closed') {
              const attempts = [0, 300, 300];
              let loaded = false;
              for (let i = 0; i < attempts.length; i++) {
                if (attempts[i] > 0) await new Promise(r => setTimeout(r, attempts[i]));
                const { data, error: wErr } = await getWinnersForEvent(evt.id);
                if (!wErr) {
                  setWinners(Array.isArray(data) ? data : []);
                  loaded = true;
                  break;
                }
                // eslint-disable-next-line no-console
                console.warn('Winner fetch retry (bidder):', wErr?.message);
              }
              if (!loaded) {
                const { data } = await getWinnersForEvent(evt.id);
                setWinners(Array.isArray(data) ? data : []);
              }
            }
          }
        });
        eventUnsubRef.current = unsubEvent;

        return () => {
          unsubItems();
          if (eventUnsubRef.current) eventUnsubRef.current();
          bidUnsubsRef.current.forEach((fn) => fn && fn());
          bidUnsubsRef.current = [];
        };
      } catch (e) {
        setError(e?.message || 'Network error while loading event');
      }
    };

    let cleanup = () => {};
    init().then((fn) => {
      if (typeof fn === 'function') cleanup = fn;
    });
    return () => cleanup();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventCode]);

  useEffect(() => {
    // When event status flips to closed, render winners
    refreshWinnersIfClosed(eventId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isClosed, eventId]);

  const onChangeName = (e) => {
    const nm = e.target.value;
    setName(nm);
    try {
      const raw = localStorage.getItem(LS_JOIN_CONTEXT);
      const existing = raw ? JSON.parse(raw) : {};
      localStorage.setItem(LS_JOIN_CONTEXT, JSON.stringify({ ...existing, bidderName: nm }));
    } catch { /* ignore */ }
  };

  const showToast = (message) => {
    setToast({ message });
    setTimeout(() => setToast(null), 2200);
  };

  const handleBid = (item) => async (amount) => {
    if (!eventId) throw new Error('Event not loaded');
    if (isClosed) throw new Error('Auction is closed. Bidding is disabled.');
    const { error: bidErr } = await placeBid({
      eventId, itemId: item.id, amount, bidderName: name.trim()
    });
    if (bidErr) throw new Error(bidErr.message || 'Failed to place bid');
    const formatted = Number(amount).toLocaleString();
    const iName = item.title || item.name || 'item';
    showToast(`Bid placed: ${iName} · ${formatted}`);
    loadHighBid(item.id);
  };

  return (
    <div className="container page">
      <h2 className="page__title">Auction: {eventCode}</h2>
      <div className="card">
        <div className="form form--inline">
          <div className="field">
            <label htmlFor="name" className="field__label">Your name (optional)</label>
            <input
              id="name"
              className="field__input"
              value={name}
              onChange={onChangeName}
              placeholder="Anonymous"
            />
          </div>
          <div className="hint">
            {isClosed ? 'This auction is closed. You can no longer place bids.' : 'Enter a name or leave blank to bid anonymously.'}
          </div>
        </div>
      </div>

      {error ? <div className="alert alert--error" role="alert" aria-live="assertive">{error}</div> : null}
      {!error && isClosed ? (
        <div className="alert" role="status" aria-live="polite" style={{ marginTop: 12 }}>
          The auction is closed. Final results are shown below when available; bidding is disabled.
        </div>
      ) : null}

      {showWinnerBanner ? (
        <div className="alert alert--success" role="status" aria-live="polite">
          Winners are available. Scroll to see the results.
        </div>
      ) : null}

      {isClosed && (
        <div className="card" style={{ marginTop: 16, marginBottom: 16 }}>
          <div className="card__header">
            <h3 className="card__title">Winners</h3>
            <span className="badge">Final results</span>
          </div>
          {winners.length === 0 ? (
            <p className="card__text">No winners to display yet. Items may have received no bids, or results are finalizing.</p>
          ) : (
            <div>
              {winners.map((w) => (
                <div key={w.item_id} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border)', gap: 12 }}>
                  <div style={{ flex: 1 }}>
                    <strong>{w.title || 'Item'}</strong>
                    <div className="hint">Starting: {Number(w.starting_bid || 0).toLocaleString()}</div>
                  </div>
                  <div style={{ flex: 1, textAlign: 'right' }}>
                    <div>Winner: <strong>{w.bidder_name || '—'}</strong></div>
                    <div>Amount: <span className="badge badge--primary">{w.winning_amount != null ? Number(w.winning_amount).toLocaleString() : '—'}</span></div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {toast ? (
        <div className="toast" role="status" aria-live="assertive">
          <strong style={{ display: 'block', marginBottom: 2 }}>Success</strong>
          <span>{toast.message}</span>
        </div>
      ) : null}

      {sortedItems.length === 0 ? (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="skeleton skeleton--title" />
          <div style={{ marginTop: 8 }} className="skeleton skeleton--text" />
          <div style={{ marginTop: 14 }} className="skeleton skeleton--block" />
          <p className="card__text" style={{ marginTop: 12 }}>No items yet. Please check back soon.</p>
        </div>
      ) : null}

      <div className="grid grid--cards">
        {sortedItems.map((it) => (
          <div key={it.id} className="card item-card">
            <div className="card__header">
              <h3 className="card__title">{it.title}</h3>
            </div>
            <ItemImageRenderer item={it} />
            {it.description ? <p className="card__text">{it.description}</p> : null}
            <div className="item-card__meta">
              <span className="badge">Starting: {Number(it.starting_bid || 0).toLocaleString()}</span>
              <span className="badge badge--primary">Current: {Number(highBids[it.id] ?? it.starting_bid ?? 0).toLocaleString()}</span>
            </div>
            <ItemCard
              item={it}
              highBid={highBids[it.id] ?? null}
              allowBid={!isClosed}
              onBid={handleBid(it)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
