import { Routes, Route, Navigate } from 'react-router-dom';
import { useEffect } from 'react';
import './App.css';

import Navbar from './components/Navbar';
import Home from './pages/Home';
import CreateEvent from './pages/CreateEvent';
import JoinEvent from './pages/JoinEvent';
import JoinEventCode from './pages/JoinEventCode';
import JoinEventName from './pages/JoinEventName';
import HostDashboard from './pages/HostDashboard';
import BidderView from './pages/BidderView';
import MagicLinkCallback from './pages/MagicLinkCallback';
import MinimalImageUploadPage from './pages/MinimalImageUploadPage';
import { validateBucket } from './lib/validateBucket';
import { AUCTION_IMAGES_BUCKET } from './constants/storage';

// PUBLIC_INTERFACE
export default function App() {
  /** Router container for the Silent Auction app. Also triggers optional storage validation on app load. */
  useEffect(() => {
    const debugEnabled = String(process.env.REACT_APP_DEBUG_STORAGE || '').toLowerCase() === 'true';
    if (!debugEnabled) return;

    (async () => {
      try {
        await validateBucket(AUCTION_IMAGES_BUCKET);
        // eslint-disable-next-line no-console
        console.log('[DEBUG_STORAGE] App boot storage validation passed for', AUCTION_IMAGES_BUCKET);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('[DEBUG_STORAGE] App boot storage validation failed:', e?.message || e);
      }
    })();
  }, []);

  return (
    <div className="app-root">
      <Navbar />
      <main className="main">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/create" element={<CreateEvent />} />
          {/* Backward compatibility: old JoinEvent redirects to new step 1 */}
          <Route path="/join-legacy" element={<JoinEvent />} />
          <Route path="/join" element={<JoinEventCode />} />
          <Route path="/join/:eventCode/name" element={<JoinEventName />} />
          <Route path="/host/:eventId" element={<HostDashboard />} />
          <Route path="/host/callback" element={<MagicLinkCallback />} />
          {/* Bidder routes: new canonical /auction/:eventCode; keep old aliases */}
          <Route path="/auction/:eventCode" element={<BidderView />} />
          <Route path="/event/:eventCode" element={<Navigate to="/auction/:eventCode" replace />} />
          <Route path="/bid/:eventCode" element={<Navigate to="/auction/:eventCode" replace />} />
          <Route path="/minimal-upload" element={<MinimalImageUploadPage />} />
          <Route path="*" element={
            <div className="container page">
              <div className="card">
                <h2 className="card__title">Not Found</h2>
                <p className="card__text">The page you are looking for does not exist.</p>
              </div>
            </div>
          } />
        </Routes>
      </main>
    </div>
  );
}
