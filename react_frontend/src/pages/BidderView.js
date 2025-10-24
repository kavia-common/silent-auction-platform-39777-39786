import { useEffect, useMemo, useState, useRef } from 'react';
import { useParams } from 'react-router-dom';
import ItemCard from '../components/ItemCard';
import {
  getEventByCode,
  getHighBid,
  listItems,
  placeBid,
  subscribeToBids,
  subscribeToItems
} from '../services/auctionService';

const LS_JOIN_CONTEXT = 'auction.joinContext';

// PUBLIC_INTERFACE
export default function BidderView() {
  /**
   * Bidder page: join by event code, view items, place bids.
   * Realtime updates for new items and bids.
   * Consumes bidder context from localStorage and keeps it in sync on name changes.
   * Shows a green success toast after a successful bid insert.
   */
  const { eventCode } = useParams();
  const [eventId, setEventId] = useState(null);
  const [items, setItems] = useState([]);
  const [highBids, setHighBids] = useState({});
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [toast, setToast] = useState(null); // { message }

  // To track current subscriptions on bids when items change
  const bidUnsubsRef = useRef([]);

  // Load name from localStorage if present (handle reloads gracefully)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_JOIN_CONTEXT);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.bidderName) setName(parsed.bidderName);
      }
    } catch {
      /* ignore */
    }
  }, []);

  const normalizeItem = (it) => {
    // Support both "name" and "title" fields gracefully
    const title = typeof it.title === 'string' && it.title.trim()
      ? it.title
      : (typeof it.name === 'string' ? it.name : '');
    return { ...it, title };
  };

  const sortedItems = useMemo(
    () => items.map(normalizeItem).slice().sort((a, b) => (a.id > b.id ? 1 : -1)),
    [items]
  );

  const loadHighBid = async (itemId) => {
    const { data } = await getHighBid(itemId);
    setHighBids((prev) => ({ ...prev, [itemId]: data?.amount || null }));
  };

  const attachBidRealtime = (itemsList) => {
    // Clear previous
    bidUnsubsRef.current.forEach((fn) => fn && fn());
    bidUnsubsRef.current = [];

    // Subscribe to each item's bids
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
    const list = (data || []);
    setItems(list);
    list.forEach((it) => loadHighBid(it.id));
    // Update bid realtime subscriptions
    attachBidRealtime(list);
  };

  useEffect(() => {
    const init = async () => {
      setError('');
      // Verify event by code (guards against stale/invalid context) and set eventId
      const { data: evt, error: evtErr } = await getEventByCode(eventCode);
      if (evtErr || !evt) {
        const msg = evtErr?.message || 'Event not found. Check the code and try again.';
        setError(msg);
        return;
      }
      setEventId(evt.id);
      // Persist/refresh context including possibly updated eventId
      try {
        const raw = localStorage.getItem(LS_JOIN_CONTEXT);
        const existing = raw ? JSON.parse(raw) : {};
        const updated = { ...existing, eventId: evt.id, eventCode: evt.code, bidderName: existing?.bidderName || name || '' };
        localStorage.setItem(LS_JOIN_CONTEXT, JSON.stringify(updated));
        if (!name && updated.bidderName) setName(updated.bidderName);
      } catch {
        /* ignore storage errors */
      }

      await loadItems(evt.id);

      const unsubItems = subscribeToItems(evt.id, () => loadItems(evt.id));

      return () => {
        unsubItems();
        bidUnsubsRef.current.forEach((fn) => fn && fn());
        bidUnsubsRef.current = [];
      };
    };

    // init returns a cleanup but we can't use it directly in useEffect, so wrap:
    let cleanup = () => {};
    init().then((fn) => {
      if (typeof fn === 'function') cleanup = fn;
    });
    return () => cleanup();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventCode]);

  // Keep bidder name in localStorage synced
  const onChangeName = (e) => {
    const nm = e.target.value;
    setName(nm);
    try {
      const raw = localStorage.getItem(LS_JOIN_CONTEXT);
      const existing = raw ? JSON.parse(raw) : {};
      localStorage.setItem(LS_JOIN_CONTEXT, JSON.stringify({ ...existing, bidderName: nm }));
    } catch {
      /* ignore */
    }
  };

  const showToast = (message) => {
    setToast({ message });
    // Auto hide
    setTimeout(() => setToast(null), 2200);
  };

  const handleBid = (item) => async (amount) => {
    if (!eventId) {
      throw new Error('Event not loaded');
    }
    const { error: bidErr } = await placeBid({ eventId, itemId: item.id, amount, bidderName: name.trim() });
    if (bidErr) throw new Error(bidErr.message || 'Failed to place bid');

    // On success: show toast and gently refresh the item high bid if realtime isn't immediate
    showToast(`You have bid this ‘${item.title || item.name || 'item'}’`);
    // Fallback refetch for robustness even with realtime
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
          <div className="hint">Enter a name or leave blank to bid anonymously.</div>
        </div>
      </div>

      {error ? <div className="alert alert--error">{error}</div> : null}

      {/* Success toast */}
      {toast ? (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: 'fixed',
            right: 16,
            bottom: 16,
            background: 'rgba(16,185,129,0.12)',
            border: '1px solid rgba(16,185,129,0.35)',
            color: '#065f46',
            padding: '10px 12px',
            borderRadius: 10,
            boxShadow: '0 6px 20px rgba(0,0,0,0.08)',
            transform: 'translateY(0)',
            transition: 'transform 200ms ease, opacity 200ms ease',
            zIndex: 60
          }}
        >
          {toast.message}
        </div>
      ) : null}

      <div className="grid grid--cards">
        {sortedItems.map((it) => (
          <ItemCard
            key={it.id}
            item={it}
            highBid={highBids[it.id] ?? null}
            allowBid
            onBid={handleBid(it)}
          />
        ))}
      </div>
    </div>
  );
}
