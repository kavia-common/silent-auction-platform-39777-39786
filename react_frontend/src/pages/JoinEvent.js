import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

// PUBLIC_INTERFACE
export default function JoinEvent() {
  /**
   * Legacy JoinEvent page preserved for backward compatibility.
   * Immediately redirects to the new two-step flow at /join.
   */
  const navigate = useNavigate();
  useEffect(() => {
    navigate('/join', { replace: true });
  }, [navigate]);
  return null;
}
