import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { AUCTION_IMAGES_BUCKET } from '../constants/storage';

/**
 * PUBLIC_INTERFACE
 * Minimal runtime storage probe page for diagnostics.
 * Performs a list('') against the configured bucket to distinguish 404-not-found vs 401/403 permissions.
 * This page is intentionally minimal and only used when navigated to explicitly.
 */
export default function StorageProbe() {
  const [result, setResult] = useState({ status: 'pending', message: 'Probing...' });

  useEffect(() => {
    let mounted = true;
    async function run() {
      try {
        const { data, error } = await supabase.storage.from(AUCTION_IMAGES_BUCKET).list('');
        if (error) {
          const msg = (error.message || '').toLowerCase();
          if (msg.includes('not found')) {
            mounted && setResult({ status: 'error', message: `Bucket "${AUCTION_IMAGES_BUCKET}" not found.` });
          } else if (msg.includes('unauthorized') || msg.includes('401')) {
            mounted && setResult({ status: 'error', message: `Unauthorized (401) accessing bucket "${AUCTION_IMAGES_BUCKET}".` });
          } else if (msg.includes('forbidden') || msg.includes('permission') || msg.includes('403')) {
            mounted && setResult({ status: 'error', message: `Forbidden (403) accessing bucket "${AUCTION_IMAGES_BUCKET}".` });
          } else {
            mounted && setResult({ status: 'error', message: `Other error: ${error.message}` });
          }
        } else {
          mounted && setResult({ status: 'ok', message: `OK. Bucket "${AUCTION_IMAGES_BUCKET}" is reachable.` });
        }
      } catch (e) {
        mounted && setResult({ status: 'error', message: `Exception: ${e.message || String(e)}` });
      }
    }
    run();
    return () => { mounted = false; };
  }, []);

  return (
    <div className="container" style={{ padding: 16 }}>
      <div className="card">
        <h2 className="card__title">Storage Probe</h2>
        <p className="card__text">{result.message}</p>
      </div>
    </div>
  );
}
