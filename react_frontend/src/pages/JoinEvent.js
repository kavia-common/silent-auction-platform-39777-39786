import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getEventByName } from '../services/auctionService';

// PUBLIC_INTERFACE
export default function JoinEvent() {
  /**
   * Join Event page: Find by code or name; navigate to bidder view.
   */
  const [input, setInput] = useState('');
  const [mode, setMode] = useState('code');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

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
      if (mode === 'code') {
        navigate(`/event/${encodeURIComponent(value)}`);
      } else {
        const { data, error: err } = await getEventByName(value);
        if (err) {
          // Supabase may return a generic message if multiple rows were found when using maybeSingle.
          // Provide a friendlier UI message.
          const msg = /multiple|coerce|single json/i.test(err.message)
            ? 'Multiple events share this name. Please use the unique event code.'
            : err.message || 'Unable to find event';
          throw new Error(msg);
        }
        if (!data) {
          throw new Error('Event not found. Please check the exact name or use the event code.');
        }
        navigate(`/event/${encodeURIComponent(data.code)}`);
      }
    } catch (e2) {
      setError(e2?.message || 'Unable to join the event');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="container page">
      <div className="card">
        <h2 className="card__title">Join Event</h2>
        <p className="card__text">Enter the event code or exact event name to join.</p>
        <div className="item-card__meta">
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
        <form onSubmit={onSubmit} className="form">
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
          <button className="btn btn--secondary" type="submit" disabled={busy}>
            {busy ? 'Joining...' : 'Join'}
          </button>
        </form>
        {error ? <div className="alert alert--error">{error}</div> : null}
      </div>
    </div>
  );
}
