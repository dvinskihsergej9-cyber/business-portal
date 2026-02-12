import { useEffect, useRef } from "react";
import { focusTsdError } from "./errorAttention";

export default function TsdErrorAlert({ message }) {
  const ref = useRef(null);

  useEffect(() => {
    if (!message) return;
    const frame = requestAnimationFrame(() => {
      focusTsdError(message, ref.current);
    });
    return () => cancelAnimationFrame(frame);
  }, [message]);

  if (!message) return null;
  return (
    <div ref={ref} className="tsd-alert tsd-alert--error">
      {message}
    </div>
  );
}
