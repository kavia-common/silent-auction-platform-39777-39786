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
  getWinnersForEvent
} from '../services/auctionService';
import { getOrCreateClientId } from '../lib/clientId';

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
    const { data, error: wErr } = await getWinnersForEvent(evtId);
    if (wErr) {
      // eslint-disable-next-line no-console
      console.warn('Failed to compute winners:', wErr.message);
      return;
    }
    setWinners(data || []);
  };

  useEffect(() => {
    const init = async () => {
      setError('');
      const { data: evt, error: evtErr } = await getEventByCode(eventCode);
      if (evtErr || !evt) {
        setError(evtErr?.message || 'Event not found. Check the code and try again.');
        return;
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

      const unsubItems = subscribeToItems(evt.id, () => loadItems(evt.id));
      const unsubEvent = subscribeToEvent(evt.id, async () => {
        // On any event change, refetch single row to get status/is_open
        const refreshed = await getEventByCode(eventCode);
        if (refreshed?.data) {
          setEventRow(refreshed.data);
          // If auction is now closed, load winners immediately for a seamless switch
          const newStatus = getNormalizedEventStatus(refreshed.data);
          if (newStatus === 'closed') {
            const { data } = await getWinnersForEvent(evt.id);
            setWinners(data || []);
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
    showToast(`You have bid on “${item.title || item.name || 'item'}”`);
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

      {error ? <div className="alert alert--error">{error}</div> : null}
      {!error && isClosed ? (
        <div className="alert" role="status" aria-live="polite" style={{ marginTop: 12 }}>
          The auction is currently closed. You can view items and final prices, but bidding is disabled.
        </div>
      ) : null}

      {isClosed && (
        <div className="card" style={{ marginTop: 16, marginBottom: 16 }}>
          <div className="card__header">
            <h3 className="card__title">Winners</h3>
            <span className="badge">Final results</span>
          </div>
          {winners.length === 0 ? (
            <p className="card__text">No winners available. Items may have received no bids.</p>
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
        </div>
      )}

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

      {sortedItems.length === 0 ? (
        <div className="card" style={{ marginTop: 16 }}>
          <p className="card__text">No items yet. Please check back soon.</p>
        </div>
      ) : null}

      <div className="grid grid--cards">
        {sortedItems.map((it) => (
          <ItemCard
            key={it.id}
            item={it}
            highBid={highBids[it.id] ?? null}
            allowBid={!isClosed}
            onBid={handleBid(it)}
          />
        ))}
      </div>
    </div>
  );
}
