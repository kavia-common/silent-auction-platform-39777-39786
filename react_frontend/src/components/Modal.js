import { useEffect } from 'react';

// PUBLIC_INTERFACE
export default function Modal({ open, title, children, onClose, footer }) {
  /** Generic accessible modal. */
  useEffect(() => {
    const handle = (e) => e.key === 'Escape' && onClose && onClose();
    if (open) window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="modal__backdrop" onClick={onClose} aria-hidden="true">
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title || 'Dialog'}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal__header">
          <h3 className="modal__title">{title}</h3>
          <button className="btn btn--text" aria-label="Close modal" onClick={onClose}>✕</button>
        </div>
        <div className="modal__content">
          {children}
        </div>
        {footer ? <div className="modal__footer">{footer}</div> : null}
      </div>
    </div>
  );
}
