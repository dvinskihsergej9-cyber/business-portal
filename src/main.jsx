import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import { normalizeErrorMessage } from "./apiConfig";
import "./index.css";

if (typeof window !== "undefined" && !window.__fetchWrapped) {
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    try {
      const res = await originalFetch(...args);
      if (!res.ok) {
        const contentType = res.headers.get("content-type") || "";
        if (contentType.includes("application/json")) {
          const cloned = res.clone();
          try {
            const data = await cloned.json();
            if (data && typeof data.message === "string") {
              const normalized = normalizeErrorMessage(data.message, "Ошибка запроса.");
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
      throw new Error(normalizeErrorMessage(err, "Ошибка подключения к серверу."));
    }
  };
  window.__fetchWrapped = true;
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
