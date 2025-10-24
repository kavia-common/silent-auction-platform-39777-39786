import { useNavigate } from 'react-router-dom';

// PUBLIC_INTERFACE
export default function Home() {
  /**
   * Landing page with two primary actions: Create and Join.
   * Buttons navigate to dedicated pages for each flow.
   */
  const navigate = useNavigate();

  return (
    <div className="container page">
      <div className="card" style={{ textAlign: 'center' }}>
        <h1 className="page__title" style={{ marginBottom: 8 }}>Silent Auction</h1>
        <p className="page__subtitle">Create a new event or join an existing one.</p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: 16 }}>
          <button className="btn btn--primary" onClick={() => navigate('/create')}>
            Create
          </button>
          <button className="btn btn--secondary" onClick={() => navigate('/join')}>
            Join
          </button>
        </div>
        <div className="hint" style={{ marginTop: 12 }}>
          Magic Link hosting is supported. You can add host email during creation.
        </div>
      </div>
    </div>
  );
}
