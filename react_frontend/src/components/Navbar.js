import { Link } from 'react-router-dom';

// PUBLIC_INTERFACE
export default function Navbar() {
  /** Top navigation bar for the app. */
  return (
    <header className="navbar">
      <div className="navbar__content container">
        <Link className="navbar__brand" to="/">Silent Auction</Link>
        <nav className="navbar__nav" aria-label="Main navigation">
          {(() => {
            const path = typeof window !== 'undefined' ? window.location.pathname : '';
            return (
              <>
                <Link to="/" className="nav__link" aria-current={path === '/' ? 'page' : undefined}>Home</Link>
                <Link to="/create" className="nav__link" aria-current={path.startsWith('/create') ? 'page' : undefined}>Create</Link>
                <Link to="/join" className="nav__link" aria-current={path.startsWith('/join') ? 'page' : undefined}>Join</Link>
              </>
            );
          })()}
        </nav>
      </div>
    </header>
  );
}
