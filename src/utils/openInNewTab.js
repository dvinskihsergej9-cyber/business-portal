const DEFAULT_POPUP_ERROR =
  "Не удалось открыть документ. Разрешите всплывающие окна для портала.";

function getPopupBlockedErrorMessage(customMessage) {
  const text = String(customMessage || "").trim();
  return text || DEFAULT_POPUP_ERROR;
}

export function prepareDocumentTab(options = {}) {
  if (typeof window === "undefined") return null;

  const popup = window.open("", "_blank");
  if (!popup) return null;

  const title = String(options.title || "Документ");
  try {
    popup.document.open();
    popup.document.write(
      `<!doctype html><html lang="ru"><head><meta charset="utf-8" /><title>${title}</title></head><body style="font-family:Arial,sans-serif;padding:16px;">Формируем документ...</body></html>`
    );
    popup.document.close();
  } catch {
    // ignore
  }
  popup.focus();
  return popup;
}

export function openHtmlDocumentInNewTab(html, options = {}) {
  if (typeof window === "undefined") return null;

  const normalizedHtml = String(html || "");
  let popup = options.targetWindow || null;
  if (!popup) {
    popup = window.open("", "_blank");
  }
  if (!popup) {
    throw new Error(getPopupBlockedErrorMessage(options.popupBlockedMessage));
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
  const popup = options.targetWindow || window.open("", "_blank");
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
