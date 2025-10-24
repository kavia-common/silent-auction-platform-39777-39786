import { Link } from 'react-router-dom';

// PUBLIC_INTERFACE
export default function Navbar() {
  /** Top navigation bar for the app. */
  return (
    <header className="navbar">
      <div className="navbar__content container">
        <Link className="navbar__brand" to="/">Silent Auction</Link>
    <nav className="navbar__nav">
      <Link to="/" className="nav__link">Home</Link>
      <Link to="/create" className="nav__link">Create</Link>
      <Link to="/join" className="nav__link">Join</Link>
    </nav>
      </div>
    </header>
  );
}
