import { useEffect, useMemo, useRef, useState } from "react";
import { showGlobalError, subscribeGlobalError } from "../utils/globalErrorModal";

const ERROR_SELECTORS = [
  ".alert--error",
  ".alert--danger",
  ".admin-alert--error",
  ".tsd-alert--error",
  ".login-card__error",
  "[data-global-error='true']",
];

function normalizeTechnicalMessage(message) {
  const raw = String(message || "");
  const lower = raw.toLowerCase();
  if (lower.includes("notfounderror")) {
    return "Камера не найдена на устройстве.";
  }
  if (lower.includes("notallowederror")) {
    return "Доступ к камере запрещен. Разрешите доступ в настройках браузера.";
  }
  if (lower.includes("notreadableerror")) {
    return "Не удалось получить доступ к камере. Возможно, она занята другим приложением.";
  }
  if (lower.includes("overconstrainederror")) {
    return "Камера не поддерживает выбранные параметры.";
  }
  if (lower.includes("securityerror")) {
    return "Браузер заблокировал доступ к камере по настройкам безопасности.";
  }
  return raw;
}

function extractMessage(node) {
  if (!(node instanceof Element)) return "";
  if (node.closest(".global-error-modal")) return "";
  const text = String(node.textContent || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "";
  if (text.length < 2) return "";
  return text;
}

function collectCandidatesFromNode(node) {
  if (!(node instanceof Element)) return [];
  const selectors = ERROR_SELECTORS.join(",");
  const list = [];
  if (node.matches(selectors)) {
    list.push(node);
  }
  node.querySelectorAll(selectors).forEach((item) => list.push(item));
  return list;
}

export default function GlobalErrorModal() {
  const [message, setMessage] = useState("");
  const [open, setOpen] = useState(false);
  const lastMessageRef = useRef("");
  const lastAtRef = useRef(0);

  const close = () => setOpen(false);

  const openMessage = useMemo(
    () => (nextMessage) => {
      const now = Date.now();
      const normalized = String(nextMessage || "")
        .replace(/\s+/g, " ")
        .trim();
      if (!normalized) return;
      const translated = normalizeTechnicalMessage(normalized);

      if (
        translated === lastMessageRef.current &&
        now - lastAtRef.current < 1200
      ) {
        return;
      }

      lastMessageRef.current = translated;
      lastAtRef.current = now;
      setMessage(translated);
      setOpen(true);
    },
    []
  );

  useEffect(() => subscribeGlobalError((next) => openMessage(next)), [openMessage]);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape") close();
    };
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof MutationObserver === "undefined") {
      return undefined;
    }

    const processNode = (node) => {
      const candidates = collectCandidatesFromNode(node);
      for (const candidate of candidates) {
        const text = extractMessage(candidate);
        if (!text) continue;
        const prev = candidate.getAttribute("data-global-error-last") || "";
        if (prev === text) continue;
        candidate.setAttribute("data-global-error-last", text);
        showGlobalError(text);
      }
    };

    document
      .querySelectorAll(ERROR_SELECTORS.join(","))
      .forEach((node) => processNode(node));

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "characterData") {
          processNode(mutation.target?.parentElement);
          continue;
        }
        if (mutation.type === "attributes") {
          processNode(mutation.target);
          continue;
        }
        mutation.addedNodes.forEach((node) => processNode(node));
      }
    });

    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["class", "style"],
    });

    return () => observer.disconnect();
  }, []);

  if (!open || !message) return null;

  return (
    <div
      className="global-error-modal"
      role="dialog"
      aria-modal="true"
      aria-label="Ошибка"
      onClick={close}
    >
      <div className="global-error-modal__panel" onClick={(e) => e.stopPropagation()}>
        <div className="global-error-modal__header">
          <div className="global-error-modal__title">Ошибка</div>
          <button
            type="button"
            className="global-error-modal__close"
            onClick={close}
            aria-label="Закрыть"
          >
            ×
          </button>
        </div>
        <div className="global-error-modal__text">{message}</div>
        <div className="global-error-modal__actions">
          <button type="button" className="btn" onClick={close}>
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );
}
