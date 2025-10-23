import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import supabase from '../lib/supabaseClient';

// PUBLIC_INTERFACE
export default function MagicLinkCallback() {
  /**
   * Finalizes magic link login and redirects host to their dashboard.
   * Assumes the redirect URL contains an optional eventId query parameter.
   *
   * TODO: For PKCE or custom flows, use supabase.auth.exchangeCodeForSession as needed.
   */
  const [message, setMessage] = useState('Finalizing sign-in...');
  const navigate = useNavigate();

  useEffect(() => {
    const url = new URL(window.location.href);
    const eventId = url.searchParams.get('eventId');

    const run = async () => {
      try {
        // Check if session is present (Supabase usually handles magic link on load)
        const { data: sessionData, error } = await supabase.auth.getSession();
        if (error) throw error;
        const session = sessionData?.session;

        if (!session) {
          setMessage('No active session found. Please try the magic link again.');
          setTimeout(() => navigate('/'), 2000);
          return;
        }

        setMessage('Success! Redirecting to your dashboard...');
        setTimeout(() => {
          if (eventId) {
            navigate(`/host/${eventId}`);
          } else {
            navigate('/');
          }
        }, 1000);
      } catch (e) {
        setMessage(e?.message || 'Failed to finalize sign-in');
        setTimeout(() => navigate('/'), 2000);
      }
    };

    run();
  }, [navigate]);

  return (
    <div className="container page">
      <div className="card">
        <h2 className="card__title">Magic Link</h2>
        <p className="card__text">{message}</p>
      </div>
    </div>
  );
}
