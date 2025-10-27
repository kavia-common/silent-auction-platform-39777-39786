import { useNavigate } from 'react-router-dom';
import { useEffect } from 'react';
import { debugListBucket } from '../lib/debugStorage';

// PUBLIC_INTERFACE
export default function Home() {
  /**
   * Minimal landing page with two buttons: Create and Join.
   * Also contains a temporary, env-guarded debug effect to list Supabase Storage contents.
   */
  const navigate = useNavigate();

  useEffect(() => {
    // Gate the entire effect behind the env flag to avoid noise.
    const debugEnabled = String(process.env.REACT_APP_DEBUG_STORAGE || '').toLowerCase() === 'true';
    if (!debugEnabled) return;

    const bucket = 'the-auction-images';
    const prefix = undefined; // e.g., 'public/' or 'events/<id>/' if desired

    // eslint-disable-next-line no-console
    console.log('[DEBUG_STORAGE] Enabled. REACT_APP_SUPABASE_URL:', process.env.REACT_APP_SUPABASE_URL || '(not set)');
    // eslint-disable-next-line no-console
    console.log('[DEBUG_STORAGE] Invoking debugListBucket:', { bucket, prefix });

    // Fire-and-forget; no state updates to avoid re-render loops.
    debugListBucket(bucket, prefix);
  }, []); // empty dependency array ensures this runs once

  return (
    <div className="container page">
      <div className="card" style={{ textAlign: 'center', background: 'linear-gradient(120deg, rgba(37,99,235,0.06), rgba(255,255,255,1))' }}>
        <h1 className="page__title" style={{ marginBottom: 8 }}>Silent Auction</h1>
        <p className="page__subtitle">Create a new event or join an existing one.</p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: 16, flexWrap: 'wrap' }}>
          <button className="btn btn--primary" onClick={() => navigate('/create')}>
            Create
          </button>
          <button className="btn btn--secondary" onClick={() => navigate('/join')}>
            Join
          </button>
        </div>
        <div className="hint" style={{ marginTop: 12 }}>
          Optional: email yourself a magic link to manage the event securely.
        </div>
      </div>
    </div>
  );
}
