import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createEvent, sendHostMagicLink } from '../services/auctionService';

// PUBLIC_INTERFACE
export default function Home() {
  /**
   * Landing page with Create Auction and Join Auction flows.
   * Create Auction: event name + host email to receive magic link.
   * Join Auction: enter event code to view and place bids.
   */
  const [eventName, setEventName] = useState('');
  const [hostEmail, setHostEmail] = useState('');
  const [createStatus, setCreateStatus] = useState('');
  const [createError, setCreateError] = useState('');

  const [joinCode, setJoinCode] = useState('');
  const [joinError, setJoinError] = useState('');

  const navigate = useNavigate();

  const handleCreate = async (e) => {
    e.preventDefault();
    setCreateError('');
    setCreateStatus('');
    if (!eventName.trim()) {
      setCreateError('Event name is required');
      return;
    }
    if (!hostEmail.trim()) {
      setCreateError('Host email is required');
      return;
    }
    const { data: evt, error: evtErr } = await createEvent(eventName.trim());
    if (evtErr) {
      setCreateError(evtErr.message || 'Failed to create event');
      return;
    }
    const { error: emailErr } = await sendHostMagicLink(hostEmail.trim(), evt.id);
    if (emailErr) {
      setCreateError(emailErr.message || 'Failed to send magic link');
      return;
    }
    setCreateStatus('Success! Check your email for the magic link to manage your auction.');
    setEventName('');
    setHostEmail('');
  };

  const handleJoin = (e) => {
    e.preventDefault();
    setJoinError('');
    const code = joinCode.trim();
    if (!code) {
      setJoinError('Event code is required');
      return;
    }
    navigate(`/event/${encodeURIComponent(code)}`);
  };

  return (
    <div className="container page">
      <div className="grid">
        <div className="col">
          <div className="card">
            <h2 className="card__title">Create Auction</h2>
            <p className="card__text">Start a new silent auction and get a magic link to host.</p>
            <form onSubmit={handleCreate} className="form">
              <div className="field">
                <label htmlFor="eventName" className="field__label">Event name</label>
                <input
                  id="eventName"
                  className="field__input"
                  value={eventName}
                  onChange={(e) => setEventName(e.target.value)}
                  placeholder="e.g., Charity Gala 2025"
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="hostEmail" className="field__label">Host email</label>
                <input
                  id="hostEmail"
                  type="email"
                  className="field__input"
                  value={hostEmail}
                  onChange={(e) => setHostEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                />
              </div>
              <button type="submit" className="btn btn--primary">Create Auction</button>
            </form>
            {createStatus ? <div className="alert alert--success">{createStatus}</div> : null}
            {createError ? <div className="alert alert--error">{createError}</div> : null}
          </div>
        </div>
        <div className="col">
          <div className="card">
            <h2 className="card__title">Join Auction</h2>
            <p className="card__text">Enter the code shared by the host to view items and bid.</p>
            <form onSubmit={handleJoin} className="form">
              <div className="field">
                <label htmlFor="joinCode" className="field__label">Event code</label>
                <input
                  id="joinCode"
                  className="field__input"
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value)}
                  placeholder="e.g., gala20251234"
                  required
                />
              </div>
              <button type="submit" className="btn btn--secondary">Join Auction</button>
            </form>
            {joinError ? <div className="alert alert--error">{joinError}</div> : null}
          </div>
        </div>
      </div>
    </div>
  );
}
