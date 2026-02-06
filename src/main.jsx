import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import { normalizeErrorMessage } from "./apiConfig";
import "./index.css";

if (typeof window !== "undefined" && !window.__fetchWrapped) {
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    try {
      return await originalFetch(...args);
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
