const DEFAULT_POPUP_ERROR =
  "Не удалось открыть документ. Разрешите всплывающие окна для портала.";

function getPopupBlockedErrorMessage(customMessage) {
  const text = String(customMessage || "").trim();
  return text || DEFAULT_POPUP_ERROR;
}

export function openHtmlDocumentInNewTab(html, options = {}) {
  if (typeof window === "undefined") return null;

  const popup = window.open("about:blank", "_blank", "noopener,noreferrer");
  if (!popup) {
    throw new Error(getPopupBlockedErrorMessage(options.popupBlockedMessage));
  }

  popup.document.open();
  popup.document.write(String(html || ""));
  popup.document.close();
  popup.focus();
  return popup;
}

export function openBlobInNewTab(blob, options = {}) {
  if (typeof window === "undefined") return null;

  const popupBlockedMessage = getPopupBlockedErrorMessage(
    options.popupBlockedMessage
  );
  const revokeAfterMs =
    Number.isFinite(options.revokeAfterMs) && options.revokeAfterMs > 0
      ? options.revokeAfterMs
      : 60_000;

  const objectUrl = URL.createObjectURL(blob);
  const popup = window.open(objectUrl, "_blank", "noopener,noreferrer");

  if (!popup) {
    URL.revokeObjectURL(objectUrl);
    throw new Error(popupBlockedMessage);
  }

  window.setTimeout(() => {
    URL.revokeObjectURL(objectUrl);
  }, revokeAfterMs);

  popup.focus();
  return popup;
}
