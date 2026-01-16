// src/apiConfig.js
const rawBase = (import.meta.env.VITE_API_BASE || "").trim();
const configErrorMessage = "Не настроен адрес API (VITE_API_BASE)";
let normalizedBase = "";
let configError = "";

if (!rawBase) {
  configError = configErrorMessage;
} else {
  try {
    const url = new URL(rawBase);
    const trimmedBase = url.toString().replace(/\/+$/, "");
    const baseWithoutApi = trimmedBase.replace(/\/api$/i, "");
    normalizedBase = `${baseWithoutApi}/api`;
  } catch (err) {
    configError = configErrorMessage;
  }
}

export const API_BASE = normalizedBase;
export const API_CONFIG_ERROR = configError;

export function apiUrl(path = "") {
  if (!path) return API_BASE;
  if (/^https?:\/\//i.test(path)) return path;
  return path.startsWith("/") ? `${API_BASE}${path}` : `${API_BASE}/${path}`;
}

export function apiFetch(path, options = {}) {
  if (API_CONFIG_ERROR) {
    return Promise.reject(new Error(API_CONFIG_ERROR));
  }

  const url = apiUrl(path);
  const headers = new Headers(options.headers || {});
  const token = localStorage.getItem("token");

  const isAuthRequest =
    typeof path === "string" && (/^\/?login$/i.test(path) || /^\/?register$/i.test(path));

  if (token && !headers.has("Authorization") && !isAuthRequest) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  return fetch(url, { ...options, headers });
}
