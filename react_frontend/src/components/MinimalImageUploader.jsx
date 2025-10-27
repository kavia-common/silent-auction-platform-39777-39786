import React, { useCallback, useMemo, useRef, useState } from 'react';
import { uploadPublicImageToBucket } from '../services/storageService';

/**
 * Minimal image uploader with drag-and-drop or click-to-select.
 * No titles or descriptions; only an image selection area and upload status text.
 *
 * Props:
 * - eventId: string (required)
 * - itemId: string (required)
 * - onComplete?: (result: { path: string|null, publicUrl: string|null, error: Error|null }) => void
 */
// PUBLIC_INTERFACE
export default function MinimalImageUploader({ eventId, itemId, onComplete }) {
  /** Minimal image uploader showing only selection area and status. */
  const [dragOver, setDragOver] = useState(false);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);

  const disabled = useMemo(() => busy || !eventId || !itemId, [busy, eventId, itemId]);

  const handleFiles = useCallback(async (files) => {
    const file = files && files[0];
    if (!file || !eventId || !itemId) return;
    setBusy(true);
    setStatus('Uploading...');
    try {
      const result = await uploadPublicImageToBucket(eventId, itemId, file);
      if (result.error) {
        setStatus(result.error.message || 'Upload failed');
      } else {
        setStatus('Image uploaded successfully.');
      }
      if (typeof onComplete === 'function') onComplete(result);
    } catch (e) {
      setStatus(e?.message || 'Unexpected error');
      if (typeof onComplete === 'function') onComplete({ path: null, publicUrl: null, error: e });
    } finally {
      setBusy(false);
    }
  }, [eventId, itemId, onComplete]);

  const onDrop = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    if (disabled) return;
    const files = e.dataTransfer?.files;
    if (files && files.length) {
      handleFiles(files);
    }
  }, [disabled, handleFiles]);

  const onDragOver = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!disabled) setDragOver(true);
  }, [disabled]);

  const onDragLeave = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  }, []);

  const onPick = useCallback((e) => {
    const files = e.target.files;
    if (files && files.length) {
      handleFiles(files);
      // Reset the input so selecting the same file again will retrigger change
      e.target.value = '';
    }
  }, [handleFiles]);

  const onClick = useCallback(() => {
    if (!disabled && inputRef.current) inputRef.current.click();
  }, [disabled]);

  // Minimal styles inline to keep footprint small
  const baseStyle = {
    width: '100%',
    minHeight: 140,
    borderRadius: 8,
    border: '2px dashed #cbd5e1',
    background: dragOver ? '#eef2ff' : '#f8fafc',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#374151',
    cursor: disabled ? 'not-allowed' : 'pointer',
    userSelect: 'none',
    transition: 'background 120ms ease, border-color 120ms ease'
  };

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        onClick={onClick}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onClick()}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        aria-disabled={disabled}
        style={baseStyle}
      >
        {busy ? 'Uploading...' : (dragOver ? 'Drop image to upload' : 'Click or drop an image')}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        onChange={onPick}
        style={{ display: 'none' }}
        aria-hidden="true"
        tabIndex={-1}
        disabled={disabled}
      />
      <div aria-live="polite" style={{ marginTop: 8, minHeight: 20, fontSize: 14, color: '#111827' }}>
        {status}
      </div>
    </div>
  );
}
