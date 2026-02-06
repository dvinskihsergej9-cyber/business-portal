// src/apiConfig.js
const envBase = import.meta.env.VITE_API_BASE?.trim();

const devFallbackBase = `${window.location.protocol}//${window.location.hostname}:3001`;
const prodFallbackBase = "https://business-portal-8nba.onrender.com";

const rawBase = import.meta.env.PROD ? prodFallbackBase : (envBase || devFallbackBase);
const cleanedBase = String(rawBase || "").trim().replace(/\s+/g, "");
const rawLooksLikeEnv =
  cleanedBase &&
  !cleanedBase.startsWith("http://") &&
  !cleanedBase.startsWith("https://") &&
  !cleanedBase.startsWith("/");
const needsProtocol =
  cleanedBase &&
  !cleanedBase.startsWith("http://") &&
  !cleanedBase.startsWith("https://") &&
  !cleanedBase.startsWith("/");
const normalizedRawBase = needsProtocol ? `https://${cleanedBase}` : cleanedBase;
const trimmedBase = normalizedRawBase.replace(/\/+$/, "");
let normalizedBase = trimmedBase.endsWith("/api") ? trimmedBase : `${trimmedBase}/api`;
try {
  new URL(normalizedBase);
} catch {
  const fallback = prodFallbackBase.replace(/\/+$/, "");
  normalizedBase = fallback.endsWith("/api") ? fallback : `${fallback}/api`;
}

if (import.meta.env.PROD && rawLooksLikeEnv) {
  const fallback = prodFallbackBase.replace(/\/+$/, "");
  normalizedBase = fallback.endsWith("/api") ? fallback : `${fallback}/api`;
}

const isLocalHost = ["localhost", "127.0.0.1"].includes(window.location.hostname);

if (import.meta.env.DEV && normalizedBase.includes("/api/api")) {
  console.warn(
    "[apiConfig] VITE_API_BASE already contains /api, but normalized base has /api/api:",
    normalizedBase
  );
}

if (!envBase && import.meta.env.PROD) {
  console.warn(
    "[apiConfig] VITE_API_BASE is not set. Falling back to production API:",
    normalizedBase
  );
}

if (normalizedBase === "/api" && !isLocalHost) {
  console.warn(
    "[apiConfig] VITE_API_BASE is not set; API_BASE is '/api' which likely breaks on Vercel. Set VITE_API_BASE to https://business-portal-8nba.onrender.com"
  );
}

export const API_BASE = normalizedBase;

const API_TIMEOUT_MS = 20_000;

export const normalizeErrorMessage = (err, fallback = "Ошибка запроса.") => {
  const message = String(err?.message || err || "").trim();
  if (!message) return fallback;
  const lower = message.toLowerCase();
  const hasCyrillic = /[А-Яа-яЁё]/.test(message);
  const isAsciiOnly = /^[\x00-\x7F\s]*$/.test(message);

  if (lower.includes("string did not match")) {
    return "Некорректный адрес сервера.";
  }
  if (lower.includes("failed to fetch") || lower.includes("networkerror")) {
    return "Не удалось подключиться к серверу.";
  }
  if (lower.includes("aborterror") || lower.includes("timeout")) {
    return "Превышено время ожидания ответа сервера.";
  }
  if (lower.includes("api unreachable")) {
    return "Не удалось подключиться к серверу.";
  }
  if (!hasCyrillic && isAsciiOnly) {
    return fallback;
  }
  return message;
};

export const apiFetch = async (path, options = {}) => {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  if (import.meta.env.DEV && normalizedPath.startsWith("/api/")) {
    console.warn(
      "[apiFetch] Do not include '/api' in endpoint when using apiFetch:",
      path
    );
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  const { signal: externalSignal, ...restOptions } = options || {};
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener("abort", () => controller.abort(), {
        once: true,
      });
    }
  }

  try {
    return await fetch(`${API_BASE}${normalizedPath}`, {
      ...restOptions,
      signal: controller.signal,
    });
  } catch (err) {
    if (err?.name === "AbortError") {
      throw new Error("Не удалось подключиться к серверу.");
    }
    throw new Error(normalizeErrorMessage(err, "Ошибка подключения к серверу."));
  } finally {
    clearTimeout(timeoutId);
  }
};



