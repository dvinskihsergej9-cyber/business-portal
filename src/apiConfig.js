// src/apiConfig.js
const rawBase = (import.meta.env.VITE_API_BASE || "").trim();
const configErrorMessage =
  "Ошибка конфигурации: не задан VITE_API_BASE. Укажите адрес API в переменных окружения Vercel (Preview/Production).";
let normalizedBase = "";
let configError = "";

if (!rawBase) {
  configError = configErrorMessage;
} else {
  try {
    const url = new URL(rawBase);
    const trimmedBase = url.toString().replace(/\/+$/, "");
    normalizedBase = trimmedBase.endsWith("/api")
      ? trimmedBase
      : `${trimmedBase}/api`;
  } catch (err) {
    configError =
      "Ошибка конфигурации: VITE_API_BASE должен быть абсолютным URL (например, https://api.example.com).";
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

  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  return fetch(url, { ...options, headers });
}
