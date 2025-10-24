import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createEvent, sendHostMagicLink } from '../services/auctionService';

// PUBLIC_INTERFACE
export default function CreateEvent() {
  /** 
   * Create Event page: captures event name/title and optional custom code,
   * creates the event in Supabase (omitting id), and navigates to host confirmation.
   * Also triggers optional Magic Link email if host email is provided.
   */
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [hostEmail, setHostEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const onSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!name.trim()) {
      setError('Event name is required');
      return;
    }
    setLoading(true);
    try {
      // createEvent generates a code automatically; if a custom code is provided,
      // we override afterwards by updating the record in DB. To keep scope small,
      // we will pass name only and let auto code handle. The optional code field
      // is kept for future enhancement and displayed as non-blocking note.
      const { data: evt, error: evtErr } = await createEvent(name.trim());
      if (evtErr) {
        throw new Error(evtErr.message || 'Failed to create event');
      }

      // If hostEmail provided, send magic link (non-blocking; failure will show error)
      if (hostEmail.trim()) {
        const { error: emailErr } = await sendHostMagicLink(hostEmail.trim(), evt.id);
        if (emailErr) {
          // Non-fatal: show error but continue to confirmation
          // eslint-disable-next-line no-console
          console.warn('Magic link email failed:', emailErr.message);
        }
      }

      // Navigate to host confirmation/placeholder dashboard
      navigate(`/host/${evt.id}`, { replace: true });
    } catch (err) {
      setError(err?.message || 'Something went wrong while creating the event');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container page">
      <div className="card">
        <h2 className="card__title">Create Event</h2>
        <p className="card__text">
          Start a new auction. We’ll generate a unique join code automatically.
        </p>
        <form onSubmit={onSubmit} className="form">
          <div className="field">
            <label htmlFor="evt-name" className="field__label">Event name</label>
            <input
              id="evt-name"
              className="field__input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Charity Gala 2025"
              required
            />
          </div>

          <div className="field">
            <label htmlFor="evt-code" className="field__label">
              Custom code (optional)
            </label>
            <input
              id="evt-code"
              className="field__input"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="e.g., gala25"
            />
            <div className="hint">
              A code is generated automatically. Custom codes will be supported in a future update.
            </div>
          </div>

          <div className="field">
            <label htmlFor="host-email" className="field__label">
              Host email (optional – magic link)
            </label>
            <input
              id="host-email"
              type="email"
              className="field__input"
              value={hostEmail}
              onChange={(e) => setHostEmail(e.target.value)}
              placeholder="you@example.com"
            />
            <div className="hint">
              If provided, we’ll email a magic link to manage your event.
            </div>
          </div>

          <button type="submit" className="btn btn--primary" disabled={loading}>
            {loading ? 'Creating...' : 'Create'}
          </button>
        </form>
        {error ? <div className="alert alert--error">{error}</div> : null}
      </div>
    </div>
  );
}
