import { useEffect } from "react";

export default function BottomSheet({ open, title, onClose, children }) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event) => {
      if (event.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="mobile-sheet">
      <button
        type="button"
        className="mobile-sheet__overlay"
        aria-label="Close details"
        onClick={onClose}
      />
      <div className="mobile-sheet__panel" role="dialog" aria-modal="true">
        <div className="mobile-sheet__handle" />
        <div className="mobile-sheet__header">
          <div className="mobile-sheet__title">{title}</div>
          <button
            type="button"
            className="mobile-sheet__close"
            aria-label="Close details"
            onClick={onClose}
          >
            x
          </button>
        </div>
        <div className="mobile-sheet__body">{children}</div>
      </div>
    </div>
  );
}
