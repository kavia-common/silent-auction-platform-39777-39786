import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createEvent, sendHostMagicLink } from '../services/auctionService';

// PUBLIC_INTERFACE
export default function CreateEvent() {
  /**
   * Create Event page: Insert into events without id; show Supabase errors.
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
      const { data: evt, error: evtErr } = await createEvent(name.trim(), code.trim() || undefined);
      if (evtErr) {
        throw new Error(evtErr.message || 'Failed to create event');
      }

      if (hostEmail.trim()) {
        const { error: emailErr } = await sendHostMagicLink(hostEmail.trim(), evt.id);
        if (emailErr) {
          // eslint-disable-next-line no-console
          console.warn('Magic link email failed:', emailErr.message);
        }
      }

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
        <p className="card__text">We’ll generate a unique join code automatically (or use your custom one).</p>
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
            <label htmlFor="evt-code" className="field__label">Custom code (optional)</label>
            <input
              id="evt-code"
              className="field__input"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="e.g., gala25"
            />
            <div className="hint">Leave blank to auto-generate a code.</div>
          </div>

          <div className="field">
            <label htmlFor="host-email" className="field__label">Host email (optional – magic link)</label>
            <input
              id="host-email"
              type="email"
              className="field__input"
              value={hostEmail}
              onChange={(e) => setHostEmail(e.target.value)}
              placeholder="you@example.com"
            />
            <div className="hint">We’ll email a magic link so you can manage your event.</div>
          </div>

          <button type="submit" className="btn btn--primary" disabled={loading}>
            {loading ? 'Creating...' : 'Create'}
          </button>
        </form>
        {error ? <div className="alert alert--error" role="alert" aria-live="assertive">{error}</div> : null}
      </div>
    </div>
  );
}
