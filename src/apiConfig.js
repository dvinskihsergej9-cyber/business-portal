// src/apiConfig.js
const envBase = import.meta.env.VITE_API_BASE?.trim();

const devFallbackBase = `${window.location.protocol}//${window.location.hostname}:3001`;
const prodFallbackBase = "https://business-portal-8nba.onrender.com";
const prodFallbackOrigin = prodFallbackBase.replace(/\/+$/, "");
export const FALLBACK_API_BASE = `${prodFallbackOrigin}/api`;

const rawBase = import.meta.env.PROD ? (envBase || "/api") : (envBase || devFallbackBase);
const cleanedBase = String(rawBase || "").trim().replace(/\s+/g, "");
const needsProtocol =
  cleanedBase &&
  !cleanedBase.startsWith("http://") &&
  !cleanedBase.startsWith("https://") &&
  !cleanedBase.startsWith("/");
const normalizedRawBase = needsProtocol ? `https://${cleanedBase}` : cleanedBase;
const isRelativeBase = normalizedRawBase.startsWith("/");
const trimmedBase = isRelativeBase
  ? (normalizedRawBase.replace(/\/+$/, "") || "/")
  : normalizedRawBase.replace(/\/+$/, "");
let normalizedBase = trimmedBase.endsWith("/api") ? trimmedBase : `${trimmedBase}/api`;

if (!isRelativeBase) {
  try {
    new URL(normalizedBase);
  } catch {
    normalizedBase = FALLBACK_API_BASE;
  }
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
    "[apiConfig] VITE_API_BASE is not set. Using /api (requires Vercel rewrite to backend):",
    normalizedBase
  );
}

if (normalizedBase === "/api" && !isLocalHost) {
  console.warn(
    "[apiConfig] API_BASE is '/api' for production; ensure Vercel rewrites to backend."
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
  if (message === "ITEM_NOT_FOUND") return "Товар не найден.";
  if (message === "ITEM_DELETE_ERROR") return "Ошибка удаления товара.";
  if (message === "ITEM_UPDATE_ERROR") return "Ошибка обновления товара.";
  if (message === "ITEMS_LIST_ERROR") return "Ошибка загрузки товаров.";
  if (message === "LOCATION_NOT_FOUND") return "Ячейка не найдена.";
  if (message === "LOCATION_UPDATE_ERROR") return "Ошибка обновления ячейки.";
  if (message === "LOCATIONS_LIST_ERROR") return "Ошибка загрузки ячеек.";
  if (message === "REQUESTS_LIST_ERROR") return "Ошибка загрузки заявок.";
  if (message === "REQUEST_UPDATE_ERROR") return "Ошибка обновления заявки.";
  if (message === "PO_RECEIVING_CONFIRM_ERROR") {
    return "Ошибка сервера при сохранении приемки.";
  }
  if (message === "PO_RECEIVING_FINALIZE_ERROR") {
    return "Ошибка сервера при завершении приемки.";
  }
  if (message === "PO_ALREADY_RECEIVED") {
    return "Заказ уже завершен.";
  }
  if (message === "NO_ACTIVE_TRUCK") {
    return "Заказ не найден в активной очереди поставщиков.";
  }
  if (message === "TAKE_ORDER_FIRST") {
    return "Сначала возьмите заказ в работу на приемку.";
  }
  if (message === "ALREADY_PROCESSED") {
    return "Данные уже обработаны. Обновите экран и повторите.";
  }
  if (message === "RECORD_CHANGED") {
    return "Запись уже изменена другим сотрудником. Обновите экран.";
  }
  if (message === "ORG_PROFILE_REQUIRED") {
    return "Для печати акта заполните реквизиты организации.";
  }
  if (message === "PRINT_RECEIVE_ACT_ERROR" || message === "PRINT_ACT_ERROR") {
    return "Не удалось сформировать акт расхождений.";
  }
  if (message === "ORG_PROFILE_GET_ERROR") {
    return "Не удалось загрузить реквизиты организации.";
  }
  if (message === "ORG_PROFILE_SAVE_ERROR") {
    return "Не удалось сохранить реквизиты организации.";
  }
  if (message === "BAD_ORG_PROFILE") {
    return "Заполните обязательные реквизиты организации.";
  }
  if (message === "ORG_REQUIRED") {
    return "Организация пользователя не настроена.";
  }
  if (message === "ORDER_SHORTAGE_CANDIDATES_ERROR") {
    return "Не удалось загрузить задания с пропусками.";
  }
  if (message === "ORDER_SHORTAGE_JOURNAL_ERROR") {
    return "Не удалось загрузить журнал закрытий.";
  }
  if (message === "ORDER_ADMIN_CLOSE_ERROR") {
    return "Не удалось закрыть задание с недостачей.";
  }
  if (message === "CLOSE_REASON_REQUIRED") {
    return "Укажите причину закрытия.";
  }
  if (message === "CLOSE_REASON_TOO_LONG") {
    return "Причина закрытия слишком длинная (максимум 500 символов).";
  }
  if (message === "ORDER_NO_ACTIVE_SKIPS") {
    return "Нельзя закрыть: в заказе нет активных пропущенных позиций.";
  }
  if (message === "ORDER_SHORTAGE_BAD_STATUS") {
    return "Этот заказ нельзя закрыть с недостачей в текущем статусе.";
  }
  if (message === "TENANT_NOT_FOUND") {
    return "Данные заказа устарели. Обновите экран и повторите.";
  }
  if (message === "INVALID_ITEM_ID") return "Некорректный идентификатор товара.";
  if (message === "TENANTS_LIST_ERROR") return "Ошибка загрузки списка клиентов.";
  if (message === "TENANT_CREATE_ERROR") return "Не удалось создать клиента.";
  if (message === "BAD_TENANT_PAYLOAD") {
    return "Заполните название компании, логин владельца и пароль (не короче 8 символов).";
  }
  if (message === "USERNAME_ALREADY_EXISTS") {
    return "Логин уже занят.";
  }
  if (message === "OWNER_EMAIL_RESERVED") {
    return "Этот email зарезервирован для владельца платформы.";
  }
  if (message === "EMAIL_ALREADY_EXISTS") {
    return "Пользователь с таким email уже существует.";
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



