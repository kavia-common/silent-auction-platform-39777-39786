import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { storeBidderContext, validateEventCode } from '../services/auctionService';
import { getOrCreateClientId } from '../lib/clientId';

// PUBLIC_INTERFACE
export default function JoinEventName() {
  /**
   * Step 2: Optional bidder name entry. On Next, persist context and navigate to /auction/:eventCode.
   * Reads eventCode from route params or location.state. Re-validates code if needed.
   */
  const { eventCode: routeCode } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [eventCode, setEventCode] = useState(routeCode || location.state?.eventCode || '');
  const [bidderName, setBidderName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // Ensure we still have a valid event context; re-validate if eventId missing
    const init = async () => {
      const code = (routeCode || location.state?.eventCode || '').trim();
      if (!code) {
        setError('Missing event code. Please start from the Join page.');
        return;
      }
      setEventCode(code);
      try {
        const { data, error: err } = await validateEventCode(code);
        if (err || !data) {
          throw new Error(err?.message || 'Event not found. Please check the code.');
        }
        // Seed context with event info but no name yet, and persist clientId
        storeBidderContext({ eventCode: data.code, eventId: data.id, clientId: getOrCreateClientId() });
      } catch (e) {
        setError(e?.message || 'Unable to verify event');
      }
    };
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeCode]);

  const onNext = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      // Persist name along with existing context
      storeBidderContext({ bidderName: bidderName.trim() || '' });
      navigate(`/auction/${encodeURIComponent(eventCode)}`);
    } catch (e2) {
      setError(e2?.message || 'Failed to continue');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="container page">
      <div className="card" style={{ background: 'linear-gradient(120deg, rgba(37,99,235,0.06), rgba(255,255,255,1))' }}>
        <h2 className="card__title">Your Name (Optional)</h2>
        <p className="card__text">You can bid anonymously, or add a name to show with your bids.</p>
        <form onSubmit={onNext} className="form">
          <div className="field">
            <label htmlFor="bidder-name" className="field__label">Name</label>
            <input
              id="bidder-name"
              className="field__input"
              value={bidderName}
              onChange={(e) => setBidderName(e.target.value)}
              placeholder="Anonymous"
            />
          </div>
          <button className="btn btn--primary" type="submit" disabled={busy}>
            {busy ? 'Continuing...' : 'Next'}
          </button>
        </form>
        {error ? <div className="alert alert--error" role="alert">{error}</div> : null}
      </div>
    </div>
  );
}
