import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { validateEventCode, storeBidderContext } from '../services/auctionService';

// PUBLIC_INTERFACE
export default function JoinEventCode() {
  /** 
   * Step 1: Enter event code and validate it exists.
   * On success, navigate to /join/:eventCode/name.
   */
  const [eventCode, setEventCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  const onSubmit = async (e) => {
    e.preventDefault();
    setError('');
    const code = eventCode.trim();
    if (!code) {
      setError('Event code is required');
      return;
    }
    setBusy(true);
    try {
      const { data, error: err } = await validateEventCode(code);
      if (err || !data) {
        throw new Error(err?.message || 'Event not found. Check the code and try again.');
      }
      // Seed storage with code so name step can read it
      storeBidderContext({ eventCode: data.code, eventId: data.id });
      navigate(`/join/${encodeURIComponent(data.code)}/name`, { state: { eventCode: data.code } });
    } catch (e2) {
      setError(e2?.message || 'Unable to verify event');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="container page">
      <div className="card">
        <h2 className="card__title">Join by Event Code</h2>
        <p className="card__text">Enter the event code provided by the host.</p>
        <form onSubmit={onSubmit} className="form">
          <div className="field">
            <label htmlFor="event-code" className="field__label">Event code</label>
            <input
              id="event-code"
              className="field__input"
              value={eventCode}
              onChange={(e) => setEventCode(e.target.value)}
              placeholder="e.g., gala25"
              required
            />
          </div>
          <button className="btn btn--secondary" type="submit" disabled={busy}>
            {busy ? 'Verifying...' : 'Join'}
          </button>
        </form>
        {error ? <div className="alert alert--error">{error}</div> : null}
      </div>
    </div>
  );
}
