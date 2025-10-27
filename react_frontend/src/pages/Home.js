import { useNavigate } from 'react-router-dom';
import { useEffect } from 'react';

// Temporary debug import to verify Supabase Storage connectivity.
// Remove after verification.
import { debugListBucket } from '../lib/debugStorage';

// PUBLIC_INTERFACE
export default function Home() {
  /**
   * Minimal landing page with two buttons: Create and Join.
   * Also contains a temporary, env-guarded debug effect to list Supabase Storage contents.
   */
  const navigate = useNavigate();

  // Temporary debug effect: enable by setting REACT_APP_DEBUG_STORAGE=true in .env
  useEffect(() => {
    const debugEnabled = String(process.env.REACT_APP_DEBUG_STORAGE || '').toLowerCase() === 'true';
    if (!debugEnabled) return;

    const bucket = 'the-auction-images';
    const prefix = undefined; // set to e.g., 'public/' or 'events/<id>/' if desired

    // eslint-disable-next-line no-console
    console.log('[DEBUG_STORAGE] Enabled. REACT_APP_SUPABASE_URL:', process.env.REACT_APP_SUPABASE_URL || '(not set)');
    // eslint-disable-next-line no-console
    console.log('[DEBUG_STORAGE] Invoking debugListBucket:', { bucket, prefix });

    debugListBucket(bucket, prefix);
  }, []);

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

        {/*
          DEBUG INSTRUCTIONS:
          - To enable temporary storage listing logs, set REACT_APP_DEBUG_STORAGE=true in your .env.
          - Visit the Home page and check the browser console.
          - After verifying, set REACT_APP_DEBUG_STORAGE=false (or remove it), and remove:
              import { debugListBucket } from '../lib/debugStorage';
              and this useEffect block.
          - You may also delete src/lib/debugStorage.js to fully remove debug utilities.
        */}
      </div>
    </div>
  );
}
