import { Routes, Route } from 'react-router-dom';
import './App.css';

import Navbar from './components/Navbar';
import Home from './pages/Home';
import CreateEvent from './pages/CreateEvent';
import JoinEvent from './pages/JoinEvent';
import HostDashboard from './pages/HostDashboard';
import BidderView from './pages/BidderView';
import MagicLinkCallback from './pages/MagicLinkCallback';

// PUBLIC_INTERFACE
export default function App() {
  /** Router container for the Silent Auction app. */
  return (
    <div className="app-root">
      <Navbar />
      <main className="main">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/create" element={<CreateEvent />} />
          <Route path="/join" element={<JoinEvent />} />
          <Route path="/host/:eventId" element={<HostDashboard />} />
          <Route path="/host/callback" element={<MagicLinkCallback />} />
          <Route path="/event/:eventCode" element={<BidderView />} />
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
