const GLOBAL_ERROR_EVENT = "bp:global-error";

function normalizeMessage(message) {
  return String(message || "")
    .replace(/\s+/g, " ")
    .trim();
}

export function showGlobalError(message) {
  if (typeof window === "undefined") return;
  const normalized = normalizeMessage(message);
  if (!normalized) return;

  window.dispatchEvent(
    new CustomEvent(GLOBAL_ERROR_EVENT, {
      detail: { message: normalized, at: Date.now() },
    })
  );
}

export function subscribeGlobalError(handler) {
  if (typeof window === "undefined" || typeof handler !== "function") {
    return () => {};
  }

  const wrapped = (event) => {
    const message = normalizeMessage(event?.detail?.message || "");
    if (!message) return;
    handler(message, event?.detail || {});
  };

  window.addEventListener(GLOBAL_ERROR_EVENT, wrapped);
  return () => window.removeEventListener(GLOBAL_ERROR_EVENT, wrapped);
}

