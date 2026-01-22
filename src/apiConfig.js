// src/apiConfig.js
const rawBase = (import.meta.env.VITE_API_BASE || "").trim();
const configErrorMessage = "Не настроен адрес API (VITE_API_BASE)";
const networkErrorMessage = "Не удалось подключиться к серверу. Проверьте адрес API и сеть.";
const unknownErrorMessage = "Произошла ошибка запроса. Попробуйте еще раз.";
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

function normalizeClientError(err) {
  const message = String(err?.message || err || "");
  if (message.includes("The string did not match the expected pattern")) {
    return "Ошибка конфигурации: не задан VITE_API_BASE. Укажите адрес API в переменных окружения.";
  }
  if (message.includes("Failed to fetch") || message.includes("NetworkError")) {
    return networkErrorMessage;
  }
  return unknownErrorMessage;
}

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

  return fetch(url, { ...options, headers }).catch((err) => {
    throw new Error(normalizeClientError(err));
  });
}
