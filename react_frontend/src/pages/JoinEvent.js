import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getEventByCode, getEventByName } from '../services/auctionService';

// Local storage keys
const LS_JOIN_CONTEXT = 'auction.joinContext';

// PUBLIC_INTERFACE
export default function JoinEvent() {
  /**
   * Join Event page: Find by code or name; create lightweight bidder context; show Continue CTA.
   * - Accepts event code or name and optional bidder name
   * - On success stores { eventId, eventCode, bidderName } in localStorage
   * - Renders confirmation with a "Continue to Bidding" button to go to /event/:eventCode
   * - Handles errors inline
   */
  const [input, setInput] = useState('');
  const [mode, setMode] = useState('code');
  const [bidderName, setBidderName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [joined, setJoined] = useState(null); // { eventId, eventCode, bidderName }
  const navigate = useNavigate();

  // Load any existing join context to handle reloads gracefully
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_JOIN_CONTEXT);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.eventCode && parsed?.eventId) {
          setJoined(parsed);
          setBidderName(parsed?.bidderName || '');
        }
      }
    } catch {
      /* ignore */
    }
  }, []);

  const onSubmit = async (e) => {
    e.preventDefault();
    setError('');
    const value = input.trim();
    if (!value) {
      setError(`Event ${mode} is required`);
      return;
    }
    setBusy(true);
    try {
      let evt = null;
      if (mode === 'code') {
        const { data, error: err } = await getEventByCode(value);
        if (err || !data) {
          throw new Error(err?.message || 'Event not found. Check the code and try again.');
        }
        evt = data;
      } else {
        const { data, error: err } = await getEventByName(value);
        if (err) {
          const msg = /multiple|coerce|single json/i.test(err.message)
            ? 'Multiple events share this name. Please use the unique event code.'
            : err.message || 'Unable to find event';
          throw new Error(msg);
        }
        if (!data) {
          throw new Error('Event not found. Please check the exact name or use the event code.');
        }
        evt = data;
      }

      const context = {
        eventId: evt.id,
        eventCode: evt.code,
        bidderName: bidderName.trim() || ''
      };
      // Persist to localStorage so BidderView can pick it up after navigation or reload
      localStorage.setItem(LS_JOIN_CONTEXT, JSON.stringify(context));
      setJoined(context);
    } catch (e2) {
      setError(e2?.message || 'Unable to join the event');
    } finally {
      setBusy(false);
    }
  };

  const handleContinue = () => {
    const target = joined?.eventCode || (typeof input === 'string' ? input.trim() : '');
    if (!target) {
      setError('No event selected to continue.');
      return;
    }
    navigate(`/event/${encodeURIComponent(target)}`);
  };

  const handleBidderNameChange = (e) => {
    const name = e.target.value;
    setBidderName(name);
    // Live update name in persisted context to keep in sync
    try {
      const raw = localStorage.getItem(LS_JOIN_CONTEXT);
      if (raw) {
        const parsed = JSON.parse(raw);
        localStorage.setItem(
          LS_JOIN_CONTEXT,
          JSON.stringify({ ...parsed, bidderName: name })
        );
      }
    } catch {
      /* ignore storage errors */
    }
  };

  return (
    <div className="container page">
      <div className="card">
        <h2 className="card__title">Join Event</h2>
        <p className="card__text">Enter the event code or exact event name, and optionally your name.</p>

        <div className="form">
          <div className="field">
            <label htmlFor="bidder-name" className="field__label">Your name (optional)</label>
            <input
              id="bidder-name"
              className="field__input"
              value={bidderName}
              onChange={handleBidderNameChange}
              placeholder="Anonymous"
            />
            <div className="hint">Leave blank to bid anonymously.</div>
          </div>
        </div>

        <div className="item-card__meta" style={{ marginTop: 8 }}>
          <button
            className={`btn ${mode === 'code' ? 'btn--primary' : ''}`}
            onClick={() => setMode('code')}
            type="button"
          >
            Use Code
          </button>
          <button
            className={`btn ${mode === 'name' ? 'btn--primary' : ''}`}
            onClick={() => setMode('name')}
            type="button"
          >
            Use Name
          </button>
        </div>

        <form onSubmit={onSubmit} className="form" style={{ marginTop: 6 }}>
          <div className="field">
            <label htmlFor="join-input" className="field__label">
              {mode === 'code' ? 'Event code' : 'Event name'}
            </label>
            <input
              id="join-input"
              className="field__input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={mode === 'code' ? 'e.g., gala20251234' : 'e.g., Charity Gala 2025'}
              required
            />
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn--secondary" type="submit" disabled={busy}>
              {busy ? 'Joining...' : 'Join'}
            </button>
            {joined?.eventCode ? (
              <button
                className="btn btn--primary"
                type="button"
                onClick={handleContinue}
                aria-label="Continue to bidding"
              >
                Continue to Bidding
              </button>
            ) : null}
          </div>
        </form>
        {joined?.eventCode ? (
          <div className="alert alert--success">
            Joined event "<strong>{joined.eventCode}</strong>"
            {joined.bidderName ? <> as <strong>{joined.bidderName}</strong></> : null}. You can continue to bidding.
          </div>
        ) : null}
        {error ? <div className="alert alert--error">{error}</div> : null}
      </div>
    </div>
  );
}
