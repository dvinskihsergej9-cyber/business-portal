import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import { FALLBACK_API_BASE, normalizeErrorMessage } from "./apiConfig";
import "./index.css";

if (typeof window !== "undefined" && !window.__fetchWrapped) {
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const firstArg = args[0];
    const urlStr =
      typeof firstArg === "string"
        ? firstArg
        : firstArg && typeof firstArg.url === "string"
          ? firstArg.url
          : "";
    const buildFallbackUrl = () => {
      if (!urlStr) return null;
      if (urlStr.startsWith(FALLBACK_API_BASE)) return null;
      if (urlStr.startsWith("/api/")) {
        return `${FALLBACK_API_BASE}${urlStr.slice(4)}`;
      }
      if (urlStr.startsWith("http://") || urlStr.startsWith("https://")) {
        try {
          const parsed = new URL(urlStr);
          return `${FALLBACK_API_BASE}${parsed.pathname.replace(/^\/api/, "")}${parsed.search}`;
        } catch {
          return null;
        }
      }
      return null;
    };

    try {
      const res = await originalFetch(...args);
      if (!res.ok) {
        const contentType = res.headers.get("content-type") || "";
        if (contentType.includes("application/json")) {
          const cloned = res.clone();
          try {
            const data = await cloned.json();
            if (data && typeof data.message === "string") {
              const normalized = normalizeErrorMessage(
                data.message,
                "Ошибка запроса."
              );
              if (normalized !== data.message) {
                const patched = { ...data, message: normalized };
                const body = JSON.stringify(patched);
                return new Response(body, {
                  status: res.status,
                  statusText: res.statusText,
                  headers: res.headers,
                });
              }
            }
          } catch {
            // ignore parsing errors, return original response
          }
        }
      }
      return res;
    } catch (err) {
      const fallbackUrl = buildFallbackUrl();
      if (fallbackUrl) {
        try {
          const retryArgs = [...args];
          retryArgs[0] = fallbackUrl;
          const retryRes = await originalFetch(...retryArgs);
          return retryRes;
        } catch (retryErr) {
          throw new Error(
            normalizeErrorMessage(retryErr, "Ошибка подключения к серверу.")
          );
        }
      }
      throw new Error(
        normalizeErrorMessage(err, "Ошибка подключения к серверу.")
      );
    }
  };
  window.__fetchWrapped = true;
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
