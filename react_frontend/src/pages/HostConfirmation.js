import { Link, useParams } from 'react-router-dom';

// PUBLIC_INTERFACE
export default function HostConfirmation() {
  /**
   * Optional Host Confirmation page shown after event creation (not strictly required).
   * Displays the eventId and suggests using the email magic link or dashboard link.
   */
  const { eventId } = useParams();
  return (
    <div className="container page">
      <div className="card">
        <h2 className="card__title">Event Created</h2>
        <p className="card__text">Your event has been created successfully.</p>
        <div className="badge badge--primary">Event ID: {eventId}</div>
        <p className="hint">Use the link sent to your email to manage the event, or continue below.</p>
        <div style={{ marginTop: 12 }}>
          <Link className="btn btn--primary" to={`/host/${eventId}`}>Go to Host Dashboard</Link>
        </div>
      </div>
    </div>
  );
}
