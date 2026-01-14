// src/apiConfig.js
const rawBase = import.meta.env.VITE_API_BASE || "";
const trimmedBase = rawBase.replace(/\/+$/, "");
const normalizedBase = trimmedBase.endsWith("/api")
  ? trimmedBase
  : trimmedBase
  ? `${trimmedBase}/api`
  : "/api";

export const API_BASE = normalizedBase;

export function apiUrl(path = "") {
  if (!path) return API_BASE;
  if (/^https?:\/\//i.test(path)) return path;
  return path.startsWith("/") ? `${API_BASE}${path}` : `${API_BASE}/${path}`;
}

export function apiFetch(path, options = {}) {
  const url = apiUrl(path);
  const headers = new Headers(options.headers || {});
  const token = localStorage.getItem("token");

  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  return fetch(url, { ...options, headers });
}
