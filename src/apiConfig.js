// src/apiConfig.js
const rawBase =
  import.meta.env.VITE_API_BASE ||
  `${window.location.protocol}//${window.location.hostname}:3001`;
const trimmedBase = rawBase.replace(/\/+$/, "");
const normalizedBase = trimmedBase.endsWith("/api")
  ? trimmedBase
  : `${trimmedBase}/api`;

if (import.meta.env.DEV && normalizedBase.includes("/api/api")) {
  console.warn(
    "[apiConfig] VITE_API_BASE already contains /api, but normalized base has /api/api:",
    normalizedBase
  );
}

export const API_BASE = normalizedBase;

export const apiFetch = (path, options) => {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  if (import.meta.env.DEV && normalizedPath.startsWith("/api/")) {
    console.warn(
      "[apiFetch] Do not include '/api' in endpoint when using apiFetch:",
      path
    );
  }
  return fetch(`${API_BASE}${normalizedPath}`, options);
};
