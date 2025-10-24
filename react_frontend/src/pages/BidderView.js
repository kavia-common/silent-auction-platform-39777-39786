import { useEffect, useMemo, useState } from 'react';
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
   */
  const { eventCode } = useParams();
  const [eventId, setEventId] = useState(null);
  const [items, setItems] = useState([]);
  const [highBids, setHighBids] = useState({});
  const [error, setError] = useState('');
  const [name, setName] = useState('');

  // Load name from localStorage if present
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

  const sortedItems = useMemo(() => items.slice().sort((a, b) => (a.id > b.id ? 1 : -1)), [items]);

  const loadHighBid = async (itemId) => {
    const { data } = await getHighBid(itemId);
    setHighBids((prev) => ({ ...prev, [itemId]: data?.amount || null }));
  };

  const loadItems = async (evtId) => {
    const { data, error: err } = await listItems(evtId);
    if (err) {
      setError(err.message || 'Failed to load items');
      return;
    }
    setItems(data || []);
    (data || []).forEach((it) => loadHighBid(it.id));
  };

  useEffect(() => {
    const init = async () => {
      setError('');
      // Verify event by code (guards against stale/invalid context)
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

      // Subscribe to bids for each item to update highBid in near realtime
      const unsubFunctions = [];
      (items || []).forEach((it) => {
        const unsub = subscribeToBids(it.id, () => loadHighBid(it.id));
        unsubFunctions.push(unsub);
      });

      return () => {
        unsubItems();
        unsubFunctions.forEach((fn) => fn && fn());
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

  const handleBid = (itemId) => async (amount) => {
    if (!eventId) {
      throw new Error('Event not loaded');
    }
    const { error: bidErr } = await placeBid({ eventId, itemId, amount, bidderName: name.trim() });
    if (bidErr) throw new Error(bidErr.message || 'Failed to place bid');
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
      <div className="grid grid--cards">
        {sortedItems.map((it) => (
          <ItemCard
            key={it.id}
            item={it}
            highBid={highBids[it.id] ?? null}
            allowBid
            onBid={handleBid(it.id)}
          />
        ))}
      </div>
    </div>
  );
}
