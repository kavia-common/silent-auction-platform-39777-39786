import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { AUCTION_IMAGES_BUCKET } from '../constants/storage';

/**
 * PUBLIC_INTERFACE
 * Minimal runtime storage probe page for diagnostics.
 * Performs a list('') against the configured bucket to distinguish 404-not-found vs 401/403 permissions.
 * Also prints the raw error object to the console for precise visibility of status codes and error payloads.
 * This page is intentionally minimal and only used when navigated to explicitly.
 */
export default function StorageProbe() {
  const [result, setResult] = useState({ status: 'pending', message: 'Probing...' });

  // Derive project ref from the configured Supabase URL at runtime to confirm envs are loaded.
  const projectRef = useMemo(() => {
    const url = process.env.REACT_APP_SUPABASE_URL || '';
    try {
      const host = new URL(url).host;
      return host.split('.')[0] || '';
    } catch {
      return '';
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    async function run() {
      try {
        const { data, error } = await supabase.storage.from(AUCTION_IMAGES_BUCKET).list('');
        if (error) {
          // Log the full error object for developers to inspect exact structure/status
          // eslint-disable-next-line no-console
          console.error('[StorageProbe] list error:', error);

          const status = error.status || '';
          const name = error.name || '';
          const message = error.message || '';
          const lower = message.toLowerCase();

          if (status === 404 || lower.includes('not found')) {
            mounted &&
              setResult({
                status: 'error',
                message: `Bucket "${AUCTION_IMAGES_BUCKET}" not found on project "${projectRef || 'unknown'}". Verify the bucket slug in Supabase Storage (Dashboard > Storage > Buckets).`,
              });
          } else if (status === 401 || lower.includes('unauthorized') || lower.includes('401')) {
            mounted &&
              setResult({
                status: 'error',
                message: `Unauthorized (401) accessing bucket "${AUCTION_IMAGES_BUCKET}" on project "${projectRef || 'unknown'}". Check REACT_APP_SUPABASE_KEY and auth/policies.`,
              });
          } else if (status === 403 || lower.includes('forbidden') || lower.includes('permission') || lower.includes('403')) {
            mounted &&
              setResult({
                status: 'error',
                message: `Forbidden (403) accessing bucket "${AUCTION_IMAGES_BUCKET}" on project "${projectRef || 'unknown'}". Update Storage policies or bucket public setting.`,
              });
          } else {
            mounted &&
              setResult({
                status: 'error',
                message: `Other error (${status || name || 'unknown'}): ${message}`,
              });
          }
        } else {
          mounted &&
            setResult({
              status: 'ok',
              message: `OK. Bucket "${AUCTION_IMAGES_BUCKET}" is reachable on project "${projectRef || 'unknown'}".`,
            });
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('[StorageProbe] exception:', e);
        setResult({ status: 'error', message: `Exception: ${e.message || String(e)}` });
      }
    }
    run();
    return () => {
      mounted = false;
    };
  }, [projectRef]);

  return (
    <div className="container" style={{ padding: 16 }}>
      <div className="card">
        <h2 className="card__title">Storage Probe</h2>
        <p className="card__text">{result.message}</p>
        <div className="hint" style={{ marginTop: 8 }}>
          <div>Project ref: <code>{projectRef || '(unavailable)'}</code></div>
          <div>Bucket slug: <code>{AUCTION_IMAGES_BUCKET}</code></div>
          <div>Tip: Check the browser console for the raw error object.</div>
        </div>
      </div>
    </div>
  );
}
