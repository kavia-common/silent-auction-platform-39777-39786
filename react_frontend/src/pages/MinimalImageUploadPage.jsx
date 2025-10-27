import React from 'react';
import MinimalImageUploader from '../components/MinimalImageUploader';

/**
 * Minimal page to host the MinimalImageUploader for manual testing.
 * Intentionally no titles/descriptions beyond the selection area and status inside the uploader.
 *
 * Query params:
 *  - eventId
 *  - itemId
 */
export default function MinimalImageUploadPage() {
  const params = new URLSearchParams(window.location.search);
  const eventId = params.get('eventId') || '';
  const itemId = params.get('itemId') || '';

  return (
    <div className="container" style={{ padding: 16 }}>
      <MinimalImageUploader
        eventId={eventId}
        itemId={itemId}
      />
    </div>
  );
}
