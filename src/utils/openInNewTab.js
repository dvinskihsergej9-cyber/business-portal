const DEFAULT_POPUP_ERROR =
  "Не удалось открыть документ. Разрешите всплывающие окна для портала.";

function getPopupBlockedErrorMessage(customMessage) {
  const text = String(customMessage || "").trim();
  return text || DEFAULT_POPUP_ERROR;
}

export function openHtmlDocumentInNewTab(html, options = {}) {
  if (typeof window === "undefined") return null;

  const normalizedHtml = String(html || "");
  const allowSameTabFallback = Boolean(options.allowSameTabFallback);

  let popup = window.open("", "_blank");
  if (!popup) {
    if (!allowSameTabFallback) {
      throw new Error(getPopupBlockedErrorMessage(options.popupBlockedMessage));
    }
    popup = window;
  }

  try {
    popup.document.open();
    popup.document.write(normalizedHtml);
    popup.document.close();
  } catch {
    popup.location.href = `data:text/html;charset=utf-8,${encodeURIComponent(
      normalizedHtml
    )}`;
  }
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
  const popup = window.open("", "_blank");
  if (!popup) {
    URL.revokeObjectURL(objectUrl);
    throw new Error(popupBlockedMessage);
  }

  popup.location.href = objectUrl;

  window.setTimeout(() => {
    URL.revokeObjectURL(objectUrl);
  }, revokeAfterMs);

  popup.focus();
  return popup;
}
