import { showGlobalError } from "./utils/globalErrorModal";
// src/apiConfig.js
const envBase = import.meta.env.VITE_API_BASE?.trim();

const devFallbackBase = `${window.location.protocol}//${window.location.hostname}:3001`;
const prodFallbackBase = "https://api.skladonline.tw1.su";
const prodFallbackOrigin = prodFallbackBase.replace(/\/+$/, "");
export const FALLBACK_API_BASE = `${prodFallbackOrigin}/api`;

const rawBase = import.meta.env.PROD ? (envBase || FALLBACK_API_BASE) : (envBase || devFallbackBase);
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
    "[apiConfig] VITE_API_BASE is not set. Using fallback backend API URL:",
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
const CODE_LIKE_PATTERN = /^[A-Z0-9_]+$/;

const EXTRA_ERROR_MESSAGES = {
  BAD_ID: "Некорректный идентификатор.",
  BAD_INVITE: "Некорректное приглашение.",
  BAD_INVITE_ID: "Некорректный идентификатор приглашения.",
  BAD_ITEMS: "Некорректный список товаров.",
  BAD_ITEM_ID: "Некорректный идентификатор товара.",
  BAD_KIND: "Некорректный тип операции.",
  BAD_LINES: "Некорректные строки документа.",
  BAD_LOCATION_ID: "Некорректная ячейка.",
  BAD_MOVEMENT_TYPE: "Некорректный тип движения.",
  BAD_NAME: "Некорректное название.",
  BAD_ORDER_ID: "Некорректный идентификатор заказа.",
  BAD_PO_ID: "Некорректный идентификатор заказа поставщику.",
  BAD_RANGE: "Некорректный период.",
  BAD_REQUEST: "Некорректный запрос.",
  BAD_DAYS: "Укажите корректное количество дней продления.",
  BAD_TENANT_ID: "Некорректный идентификатор клиента.",
  BAD_REVISION_ID: "Некорректный идентификатор ревизии.",
  BAD_SESSION_ID: "Некорректная сессия.",
  BAD_STATUS: "Некорректный статус.",
  BAD_TOKEN: "Некорректный токен.",
  BAD_USER_ID: "Некорректный идентификатор пользователя.",
  BOX_CODE_REQUIRED: "Введите код короба.",
  AUTH_DB_PERMISSION_USER_TABLE:
    "Сервер БД не выдал доступ к таблице пользователей (User). Проверьте права роли подключения.",
  AUTH_DB_PERMISSION_ORG_TABLE:
    "Сервер БД не выдал доступ к таблице организаций (Organization). Проверьте права роли подключения.",
  AUTH_DB_QUERY_ERROR:
    "Ошибка запроса к базе данных при входе. Проверьте подключение, схему и права роли в БД.",
  COUNT_CELL_NOT_EMPTY: "Ячейка не пуста. Операция недоступна.",
  COUNT_DATE_MISMATCH: "Дата не совпадает с остатком в ячейке.",
  COUNT_ITEM_NOT_IN_LOCATION: "Товар отсутствует в выбранной ячейке.",
  COUNT_MINUS_ONLY: "Для этого режима допустимо только уменьшение количества.",
  COUNT_PLUS_ONLY: "Для этого режима допустимо только увеличение количества.",
  HOLD_EXCEEDS_AVAILABLE: "Нельзя заблокировать больше доступного остатка.",
  HOLD_QTY_BLOCKED: "Часть остатка уже заблокирована.",
  INSUFFICIENT_QTY: "Недостаточно количества для операции.",
  INSUFFICIENT_STOCK: "Недостаточно остатка на складе.",
  INVALID_LOCATION_ID: "Некорректная ячейка.",
  ITEM_MISMATCH: "Товар не совпадает с ожидаемым.",
  LINE_ITEM_NOT_LINKED: "Позиция не связана с товаром.",
  LINE_NOT_FOUND: "Позиция не найдена.",
  LOCATION_EXISTS: "Ячейка с таким кодом уже существует.",
  MAIL_TIMEOUT: "Почтовый сервер не ответил вовремя.",
  EMAIL_ALREADY_EXISTS: "Пользователь с такой почтой уже существует.",
  EMAIL_ALREADY_VERIFIED: "Почта уже подтверждена.",
  EMAIL_NOT_VERIFIED: "Подтвердите почту кодом из письма.",
  EMAIL_VERIFY_CODE_EXPIRED: "Срок действия кода истек. Запросите новый код.",
  EMAIL_VERIFY_CODE_INVALID: "Неверный код подтверждения.",
  EMAIL_VERIFY_TOO_MANY_ATTEMPTS: "Превышено число попыток. Запросите новый код.",
  EMAIL_VERIFY_RATE_LIMIT: "Слишком часто. Подождите и повторите.",
  EMAIL_VERIFY_DELIVERY_FAILED:
    "Не удалось отправить код подтверждения. Проверьте почтовые настройки и повторите попытку.",
  EMAIL_VERIFY_ERROR: "Не удалось подтвердить почту. Повторите попытку.",
  MANUFACTURED_AT_REQUIRED: "Укажите дату изготовления.",
  NAME_REQUIRED: "Укажите название.",
  NOTHING_TO_PRINT: "Нет данных для печати.",
  NOT_ALLOWED: "Недостаточно прав для выполнения операции.",
  NOT_ASSIGNED_TO_YOU: "Эта задача назначена другому сотруднику.",
  NO_ACCESS: "Нет доступа к операции.",
  NO_LOCATION: "Ячейка не выбрана.",
  OPEN_POS_ERROR: "Не удалось загрузить открытые позиции.",
  ORDER_ALREADY_SHIPPED: "Заказ уже отгружен.",
  ORDER_ALREADY_TAKEN: "Заказ уже взят другим сотрудником.",
  ORDER_BAD_STATUS: "Операция недоступна для текущего статуса заказа.",
  ORDER_LOCKED: "Заказ сейчас обрабатывается другим сотрудником.",
  ORDER_NOT_FULLY_PICKED: "Сначала завершите отбор всех позиций заказа.",
  ORG_CODE_REQUIRED: "Укажите код организации.",
  ORG_NOT_FOUND: "Организация не найдена.",
  OWNER_ONLY_COMPANY: "Раздел доступен только владельцу компании.",
  OWNER_TENANT_FORBIDDEN: "Для владельца платформы продление не требуется.",
  PAYMENT_AMOUNT_MISMATCH: "Сумма платежа не совпадает с тарифом.",
  PAYMENT_METADATA_MISMATCH: "Ошибка данных платежа.",
  PAYMENT_USER_MISMATCH: "Платеж относится к другому пользователю.",
  PO_NOT_FOUND: "Заказ поставщику не найден.",
  QTY_EXCEEDS_REMAINING: "Количество больше доступного остатка.",
  RECEIVING_LOCATION_CREATE_FAILED: "Не удалось создать служебную ячейку приемки.",
  REVISION_NOT_FOUND: "Ревизия не найдена.",
  SAME_LOCATION: "Ячейки отправления и назначения совпадают.",
  SESSION_NOT_FOUND: "Сессия не найдена или уже завершена.",
  SKIP_NOT_FOUND: "Пропущенная позиция не найдена.",
  TAKE_RECEIVING_ORDER_ERROR: "Не удалось взять заказ в приемку.",
  TENANT_CONFLICT: "Клиент с такими данными уже существует.",
  TOKEN_INVALID: "Недействительный или устаревший токен.",
  TRIAL_CONFIG_INVALID: "Некорректная конфигурация пробного периода.",
  USER_INACTIVE: "Пользователь отключен.",
  USER_NOT_FOUND: "Пользователь не найден.",
  PALLET_DB_PERMISSION_USER_TABLE:
    "Сервер БД не выдал права на таблицу User для паллетного контура. Проверьте GRANT для роли подключения.",
  PALLET_USER_FK_ERROR:
    "Сервер БД не смог проверить связь с пользователем при создании паллеты. Проверьте целостность таблицы User.",
  PALLET_DB_QUERY_ERROR:
    "Ошибка запроса к БД при приёмке паллеты. Проверьте права роли подключения и схему БД.",
  TENANT_GRANT_FREE_ACCESS_ERROR: "Не удалось продлить бесплатный доступ клиенту.",
  TENANT_TOGGLE_ACCESS_ERROR: "Не удалось изменить состояние доступа клиента.",
  TENANT_SUBSCRIPTION_NOT_FOUND:
    "У клиента нет активной подписки. Для возобновления используйте бесплатное продление.",
  MARKETING_SETTINGS_LOAD_ERROR: "Не удалось загрузить настройки рассылки.",
  MARKETING_SETTINGS_SAVE_ERROR: "Не удалось сохранить настройки рассылки.",
  UNSUBSCRIBE_ERROR: "Не удалось обработать отписку. Попробуйте позже.",
  WEAK_PASSWORD: "Пароль слишком короткий (минимум 8 символов).",
  YOOKASSA_CONFIG_MISSING: "Платежи не настроены. Заполните ключи ЮKassa в окружении.",
};

const normalizeBackendCodeMessage = (value) => {
  const code = String(value || "").trim().toUpperCase();
  if (!code || !CODE_LIKE_PATTERN.test(code)) return "";
  if (EXTRA_ERROR_MESSAGES[code]) return EXTRA_ERROR_MESSAGES[code];

  if (code.startsWith("BAD_")) {
    return "Переданы некорректные данные запроса.";
  }
  if (code.endsWith("_REQUIRED")) {
    return "Заполните обязательные поля и повторите.";
  }
  if (code.endsWith("_NOT_FOUND")) {
    return "Запись не найдена. Проверьте данные и повторите.";
  }
  if (code === "FORBIDDEN" || code.endsWith("_FORBIDDEN")) {
    return "Недостаточно прав для выполнения операции.";
  }
  if (code.endsWith("_TIMEOUT")) {
    return "Превышено время ожидания ответа сервера.";
  }
  if (code.includes("LIMIT")) {
    return "Превышено допустимое ограничение для этой операции.";
  }
  if (code.endsWith("_ERROR")) {
    return "Не удалось выполнить операцию. Повторите попытку.";
  }
  return "Не удалось выполнить операцию. Повторите попытку.";
};

export const normalizeErrorMessage = (err, fallback = "Не удалось выполнить запрос.") => {
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
  if (lower.includes("notfounderror")) {
    return "Камера не найдена на устройстве.";
  }
  if (lower.includes("notallowederror")) {
    return "Доступ к камере запрещен. Разрешите доступ в настройках браузера.";
  }
  if (lower.includes("notreadableerror")) {
    return "Не удалось получить доступ к камере. Возможно, она занята другим приложением.";
  }
  if (lower.includes("overconstrainederror")) {
    return "Камера не поддерживает выбранные параметры.";
  }
  if (lower.includes("securityerror")) {
    return "Браузер заблокировал доступ к камере по настройкам безопасности.";
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
  if (message === "LOCATION_OCCUPIED") {
    return "В этой ячейке уже другой товар. Разместите в другую ячейку.";
  }
  if (message === "LOCATION_CONFLICT_CONFIRM") {
    return "В ячейке есть такой же товар, но с другой датой. Подтвердите размещение повторно.";
  }
  if (message === "BAD_QTY") return "Некорректное количество.";
  if (message === "RECEIVING_LINE_NOT_FOUND") {
    return "Позиция приемки уже обработана. Обновите экран и выберите позицию заново.";
  }
  if (message === "CODE_REQUIRED") return "Скан не распознан. Повторите сканирование.";
  if (message === "CODE_NOT_FOUND") return "Код не найден.";
  if (message === "SCAN_RESOLVE_ERROR") {
    return "Не удалось распознать код. Повторите сканирование.";
  }
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
  if (message === "ORDER_PICKING_JOURNAL_ERROR") {
    return "Не удалось загрузить общий журнал отбора.";
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
  if (message === "TRIAL_ALREADY_USED") {
    return "Пробный период уже использован.";
  }
  if (message === "START_PLAN_ALREADY_USED") {
    return "Тариф «Старт» можно оплатить только один раз.";
  }
  if (message === "PAYMENT_CREATE_ERROR") {
    return "Не удалось создать платеж. Проверьте настройки ЮKassa.";
  }
  if (message === "PAYMENT_STATUS_ERROR") {
    return "Не удалось проверить статус оплаты.";
  }
  if (message === "PAYMENT_ID_REQUIRED") {
    return "Не указан идентификатор платежа.";
  }
  if (message === "PAYMENT_NOT_FOUND") {
    return "Платеж не найден.";
  }
  if (message === "PAYMENT_FORBIDDEN") {
    return "Нет доступа к этому платежу.";
  }
  if (message === "PLAN_NOT_FOUND") {
    return "Выбранный тариф не найден.";
  }
  if (message === "PLAN_PERIOD_NOT_SUPPORTED") {
    return "Выбранный период оплаты недоступен для этого тарифа.";
  }
  if (message === "BILLING_USER_REQUIRED") {
    return "Не найден плательщик для этой организации.";
  }
  if (message === "PAYMENT_METHOD_INVALID") {
    return "Некорректный способ оплаты.";
  }
  if (message === "PLAN_USER_LIMIT_REACHED") {
    return "Достигнут лимит сотрудников для текущего тарифа.";
  }
  const mappedBackendCode = normalizeBackendCodeMessage(message);
  if (mappedBackendCode) {
    return mappedBackendCode;
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
  const {
    signal: externalSignal,
    timeoutMs,
    suppressGlobalError = false,
    ...restOptions
  } = options || {};
  const normalizedTimeoutMs =
    Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) > 0
      ? Number(timeoutMs)
      : API_TIMEOUT_MS;
  const timeoutId = setTimeout(() => controller.abort(), normalizedTimeoutMs);
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
    const message =
      err?.name === "AbortError"
        ? "Не удалось подключиться к серверу."
        : normalizeErrorMessage(err, "Не удалось подключиться к серверу.");
    if (!suppressGlobalError) {
      showGlobalError(message);
    }
    throw new Error(message);
  } finally {
    clearTimeout(timeoutId);
  }
};




