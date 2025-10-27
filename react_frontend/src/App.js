import { Routes, Route, Navigate } from 'react-router-dom';
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
import StorageProbe from './pages/StorageProbe';

/**
 * PUBLIC_INTERFACE
 * Router container for the Silent Auction app.
 * Debug storage validation removed; app runs without debug side effects.
 */
export default function App() {
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
          <Route path="/_probe/storage" element={<StorageProbe />} />
          <Route
            path="*"
            element={
              <div className="container page">
                <div className="card">
                  <h2 className="card__title">Not Found</h2>
                  <p className="card__text">The page you are looking for does not exist.</p>
                </div>
              </div>
            }
          />
        </Routes>
      </main>
    </div>
  );
}
