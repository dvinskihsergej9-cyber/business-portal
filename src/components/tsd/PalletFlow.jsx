import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { API_BASE, normalizeErrorMessage } from "../../apiConfig";
import { openHtmlDocumentInNewTab } from "../../utils/openInNewTab";
import Scanner from "./Scanner";
import TsdErrorAlert from "./TsdErrorAlert";
import TsdHeader from "./TsdHeader";

const PALLET_STATUS_LABELS = {
  RECEIVED: "Принята",
  STORED: "Размещена",
  DISPATCHED: "Отгружена",
  CANCELLED: "Отменена",
};

const PALLET_EVENT_LABELS = {
  CREATE: "Создание",
  RECEIVE: "Приемка",
  STORE: "Размещение",
  MOVE: "Перемещение",
  DISPATCH: "Отгрузка",
  CANCEL: "Отмена",
};

const ROUTE_SHEET_STATUS_LABELS = {
  DRAFT: "Черновик",
  PUBLISHED: "Опубликован",
  LOADING: "В погрузке",
  COMPLETED: "Завершен",
  CANCELLED: "Отменен",
};

const ROUTE_SHEET_ITEM_STATUS_LABELS = {
  PLANNED: "К погрузке",
  LOADED: "Погружена",
  CANCELLED: "Убрана",
};

const INITIAL_RECEIVE_FORM = {
  supplierName: "",
  inboundRef: "",
  qty: "1",
};

const INITIAL_STORE_FORM = {
  palletCode: "",
  locationCode: "",
};

const INITIAL_DISPATCH_FORM = {
  locationCode: "",
  palletCode: "",
  destinationRc: "",
  route: "",
  vehicle: "",
  driver: "",
  notes: "",
};

const INITIAL_PLANNING_FORM = {
  clientName: "",
  destinationRc: "",
  route: "",
  vehicle: "",
  driver: "",
  plannedDate: "",
  notes: "",
};

function statusLabel(status) {
  return PALLET_STATUS_LABELS[String(status || "").trim()] || String(status || "-");
}

function eventTypeLabel(type) {
  return PALLET_EVENT_LABELS[String(type || "").trim()] || String(type || "-");
}

function routeSheetStatusLabel(status) {
  return ROUTE_SHEET_STATUS_LABELS[String(status || "").trim()] || String(status || "-");
}

function routeSheetItemStatusLabel(status) {
  return ROUTE_SHEET_ITEM_STATUS_LABELS[String(status || "").trim()] || String(status || "-");
}

function formatDateTime(value) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleString("ru-RU");
}

function normalizePalletCode(rawValue) {
  const raw = String(rawValue || "").trim();
  if (!raw) return "";
  const withPrefix = raw.match(/^bp:pallet:(.+)$/i);
  const payload = withPrefix ? withPrefix[1] : raw;
  return payload.trim().toUpperCase().replace(/\s+/g, "");
}

function normalizeLocationCode(rawValue) {
  return String(rawValue || "").trim().toUpperCase().replace(/\s+/g, "");
}

function renderMeta(metaJson) {
  if (!metaJson || typeof metaJson !== "object") return "";
  const metaLabels = {
    supplierName: "Поставщик",
    inboundRef: "Машина/ТТН",
    fromLocationCode: "Из ячейки",
    toLocationCode: "В ячейку",
    toLocationName: "Ячейка",
    destinationRc: "РЦ назначения",
    route: "Маршрут",
    vehicle: "Машина",
    driver: "Водитель",
    notes: "Комментарий",
    scanLocationCode: "Скан ячейки",
  };
  const parts = Object.entries(metaJson)
    .filter(([, value]) => value != null && String(value).trim() !== "")
    .map(([key, value]) => `${metaLabels[key] || key}: ${String(value)}`);
  return parts.join(" | ");
}

async function readJsonSafe(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function extractSuppliersFromPalletItems(items, limit = 200) {
  const source = Array.isArray(items) ? items : [];
  const seen = new Set();
  const result = [];
  for (const item of source) {
    const supplier = String(item?.supplierName || "").trim();
    if (!supplier) continue;
    const normalized = supplier.toLowerCase();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(supplier);
    if (result.length >= limit) break;
  }
  return result.sort((a, b) => a.localeCompare(b, "ru"));
}

function mapPalletError(code, fallback = "Не удалось выполнить операцию.") {
  const normalized = String(code || "").trim().toUpperCase();
  if (normalized === "PALLET_NOT_FOUND") return "Паллета не найдена.";
  if (normalized === "PALLET_CODE_REQUIRED") return "Отсканируйте код паллеты.";
  if (normalized === "PALLET_LOCATION_REQUIRED") return "Отсканируйте код паллетной зоны.";
  if (normalized === "PALLET_SUPPLIER_REQUIRED") return "Укажите поставщика.";
  if (normalized === "PALLET_INBOUND_REF_REQUIRED") return "Укажите машину/ТТН.";
  if (normalized === "PALLET_DESTINATION_REQUIRED") return "Укажите РЦ назначения.";
  if (normalized === "PALLET_STORE_STATUS_INVALID")
    return "Размещение возможно только для принятых/размещенных паллет.";
  if (normalized === "PALLET_STORE_RECEIVE_EXPIRED")
    return "Размещение разрешено только для паллет текущей приемки (до 24 часов).";
  if (normalized === "PALLET_ALREADY_STORED")
    return "Паллета уже размещена. Повторное размещение через этот шаг недоступно.";
  if (normalized === "PALLET_DISPATCH_STATUS_INVALID")
    return "Отгрузить можно только паллету в статусе «Размещена».";
  if (normalized === "PALLET_LOCATION_MISMATCH")
    return "Скан ячейки не совпадает с текущей ячейкой паллеты.";
  if (normalized === "PALLET_DB_PERMISSION_USER_TABLE")
    return "Ошибка прав БД: нет доступа к таблице пользователей.";
  if (normalized === "PALLET_USER_FK_ERROR")
    return "Ошибка связей БД: пользователь не найден для фиксации события приемки.";
  if (normalized === "PALLET_DB_QUERY_ERROR")
    return "Ошибка запроса к БД при приемке паллеты. Проверьте права и схему БД.";
  if (normalized === "PALLET_CONFLICT")
    return "Конфликт при создании паллеты. Повторите приемку.";
  if (normalized === "PALLET_STATE_CHANGED")
    return "Состояние паллеты изменилось другим сотрудником. Обновите данные.";
  if (normalized === "PALLET_DISPATCH_SHEET_ERROR")
    return "Не удалось загрузить маршрутный лист.";
  if (normalized === "PALLET_SUPPLIER_LIST_ERROR")
    return "Не удалось загрузить список поставщиков для фильтра.";
  if (normalized === "ROUTE_SHEET_NOT_FOUND") return "Маршрутный лист не найден.";
  if (normalized === "ROUTE_SHEET_ID_REQUIRED") return "Не указан маршрутный лист.";
  if (normalized === "ROUTE_SHEET_STATUS_INVALID")
    return "Маршрутный лист в неподходящем статусе для этого действия.";
  if (normalized === "ROUTE_SHEET_CLIENT_REQUIRED") return "Укажите клиента.";
  if (normalized === "ROUTE_SHEET_VEHICLE_REQUIRED") return "Укажите номер машины.";
  if (normalized === "ROUTE_SHEET_DRIVER_REQUIRED") return "Укажите водителя.";
  if (normalized === "ROUTE_SHEET_DATE_REQUIRED") return "Укажите дату отгрузки.";
  if (normalized === "ROUTE_SHEET_EMPTY")
    return "Нельзя выгрузить пустой маршрутный лист. Добавьте паллеты.";
  if (normalized === "ROUTE_SHEET_PALLET_NOT_STORED")
    return "Некоторые паллеты уже не в статусе «Размещена». Обновите список.";
  if (normalized === "ROUTE_SHEET_PALLET_ALREADY_PLANNED")
    return "Некоторые паллеты уже включены в другой активный маршрутный лист.";
  if (normalized === "ROUTE_SHEET_PALLET_NOT_IN_SHEET")
    return "Эта паллета не входит в выбранный маршрутный лист.";
  if (normalized === "ROUTE_SHEET_PALLET_ALREADY_LOADED")
    return "Эта паллета уже погружена по выбранному маршрутному листу.";
  if (normalized === "ROUTE_SHEET_ITEM_NOT_FOUND") return "Позиция маршрутного листа не найдена.";
  if (normalized === "ROUTE_SHEET_ITEM_STATUS_INVALID")
    return "Позиция маршрутного листа в неподходящем статусе.";
  if (normalized === "ROUTE_SHEET_LIST_ERROR") return "Не удалось загрузить список маршрутных листов.";
  if (normalized === "ROUTE_SHEET_DETAIL_ERROR") return "Не удалось загрузить маршрутный лист.";
  if (normalized === "ROUTE_SHEET_CREATE_ERROR") return "Не удалось создать маршрутный лист.";
  if (normalized === "ROUTE_SHEET_ADD_ITEMS_ERROR")
    return "Не удалось добавить паллеты в маршрутный лист.";
  if (normalized === "ROUTE_SHEET_REMOVE_ITEM_ERROR")
    return "Не удалось удалить паллету из маршрутного листа.";
  if (normalized === "ROUTE_SHEET_PUBLISH_ERROR")
    return "Не удалось выгрузить маршрутный лист на склад.";
  if (normalized === "ROUTE_SHEET_DISPATCH_ERROR")
    return "Не удалось выполнить отгрузку по маршрутному листу.";
  if (normalized.startsWith("DATE_")) return "Проверьте корректность даты фильтра.";
  return fallback;
}

export default function PalletFlow({ authHeaders, onBack, showInternalBack = true }) {
  const [activeTab, setActiveTab] = useState("receive");
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [printFallback, setPrintFallback] = useState({ label: "", html: "" });
  const receiveSubmitLockRef = useRef(false);
  const storeSubmitLockRef = useRef(false);
  const dispatchSubmitLockRef = useRef(false);
  const lastStoreSubmitRef = useRef({ key: "", at: 0 });
  const lastDispatchSubmitRef = useRef({ key: "", at: 0 });

  const [receiveForm, setReceiveForm] = useState(INITIAL_RECEIVE_FORM);
  const [receiveStep, setReceiveStep] = useState("supplier");
  const [storeForm, setStoreForm] = useState(INITIAL_STORE_FORM);
  const [dispatchForm, setDispatchForm] = useState(INITIAL_DISPATCH_FORM);
  const [storeStep, setStoreStep] = useState("pallet");
  const [dispatchStep, setDispatchStep] = useState("setup");

  const [searchCode, setSearchCode] = useState("");
  const [searchStatus, setSearchStatus] = useState("ACTIVE");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchSupplier, setSearchSupplier] = useState("");
  const [searchDateFrom, setSearchDateFrom] = useState("");
  const [searchDateTo, setSearchDateTo] = useState("");
  const [searchSuppliers, setSearchSuppliers] = useState([]);
  const [searchSuppliersLoading, setSearchSuppliersLoading] = useState(false);
  const [searchView, setSearchView] = useState("list");
  const [historyPallet, setHistoryPallet] = useState(null);
  const [historyEvents, setHistoryEvents] = useState([]);
  const [historyCollapsed, setHistoryCollapsed] = useState(false);
  const [selectedPalletId, setSelectedPalletId] = useState(null);
  const [recentItems, setRecentItems] = useState([]);
  const [recentLoading, setRecentLoading] = useState(false);
  const [planningForm, setPlanningForm] = useState(INITIAL_PLANNING_FORM);
  const [planningSheet, setPlanningSheet] = useState(null);
  const [planningSheets, setPlanningSheets] = useState([]);
  const [planningSheetsLoading, setPlanningSheetsLoading] = useState(false);
  const [planningCandidates, setPlanningCandidates] = useState([]);
  const [planningCandidatesLoading, setPlanningCandidatesLoading] = useState(false);
  const [planningCandidateQuery, setPlanningCandidateQuery] = useState("");
  const [planningSelectedCodes, setPlanningSelectedCodes] = useState([]);
  const [planningBusy, setPlanningBusy] = useState(false);
  const [dispatchSheets, setDispatchSheets] = useState([]);
  const [dispatchSheetsLoading, setDispatchSheetsLoading] = useState(false);
  const [dispatchRouteSheetId, setDispatchRouteSheetId] = useState(null);
  const [routeSheetItems, setRouteSheetItems] = useState([]);
  const [routeSheetSummary, setRouteSheetSummary] = useState(null);
  const [routeSheetLoading, setRouteSheetLoading] = useState(false);
  const [activeReceivePalletCodes, setActiveReceivePalletCodes] = useState([]);
  const [storeReceiveScopeLocked, setStoreReceiveScopeLocked] = useState(false);

  const clearAlerts = () => {
    setError("");
    setSuccess("");
  };

  const resetToCrossdockStart = () => {
    setActiveTab("receive");
    setReceiveStep("supplier");
    setReceiveForm(INITIAL_RECEIVE_FORM);
    setPrintFallback({ label: "", html: "" });
    setStoreStep("pallet");
    setStoreForm(INITIAL_STORE_FORM);
    setDispatchStep("setup");
    setDispatchForm(INITIAL_DISPATCH_FORM);
    setDispatchRouteSheetId(null);
    setDispatchSheets([]);
    setRouteSheetItems([]);
    setRouteSheetSummary(null);
    setPlanningForm(INITIAL_PLANNING_FORM);
    setPlanningSheet(null);
    setPlanningSheets([]);
    setPlanningCandidates([]);
    setPlanningCandidateQuery("");
    setPlanningSelectedCodes([]);
    setSearchCode("");
    setSearchStatus("ACTIVE");
    setSearchQuery("");
    setSearchSupplier("");
    setSearchDateFrom("");
    setSearchDateTo("");
    setSearchSuppliers([]);
    setSearchView("list");
    setActiveReceivePalletCodes([]);
    setStoreReceiveScopeLocked(false);
    receiveSubmitLockRef.current = false;
    storeSubmitLockRef.current = false;
    dispatchSubmitLockRef.current = false;
    lastStoreSubmitRef.current = { key: "", at: 0 };
    lastDispatchSubmitRef.current = { key: "", at: 0 };
  };

  const handleFlowError = (rawError, fallbackMessage) => {
    const message =
      typeof rawError === "string"
        ? rawError
        : normalizeErrorMessage(rawError, fallbackMessage || "Ошибка в кросс-докинге.");
    setSuccess("");
    setError(message);
    resetToCrossdockStart();
  };

  const isStorePalletEligibleByBackend = async (palletCode) => {
    const params = new URLSearchParams();
    params.set("status", "RECEIVED");
    params.set("q", palletCode);
    const response = await fetch(`${API_BASE}/pallets?${params.toString()}`, {
      headers: authHeaders,
    });
    const data = await readJsonSafe(response);
    if (!response.ok) {
      throw new Error(mapPalletError(data?.message, "Не удалось проверить паллету для размещения."));
    }
    const items = Array.isArray(data?.items) ? data.items : [];
    const matched = items.find(
      (item) => normalizePalletCode(item?.palletCode || "") === normalizePalletCode(palletCode)
    );
    if (!matched) {
      return false;
    }

    const receivedAtMs = matched?.receivedAt ? new Date(matched.receivedAt).getTime() : NaN;
    const maxStoreAgeMs = 24 * 60 * 60 * 1000;
    if (!Number.isFinite(receivedAtMs) || Date.now() - receivedAtMs > maxStoreAgeMs) {
      return false;
    }
    return true;
  };

  const ensureStorePalletAllowed = async (palletCode) => {
    const normalizedCode = normalizePalletCode(palletCode);
    if (!normalizedCode) {
      throw new Error("Отсканируйте паллету.");
    }
    if (activeReceivePalletCodes.includes(normalizedCode)) {
      return true;
    }
    if (storeReceiveScopeLocked && activeReceivePalletCodes.length > 0) {
      throw new Error(
        "Эта паллета не относится к текущей приемке. Отсканируйте паллету из текущих паспортов."
      );
    }

    const isEligible = await isStorePalletEligibleByBackend(normalizedCode);
    if (!isEligible) {
      throw new Error(
        "Эта паллета недоступна для размещения. Используйте паллеты текущей приемки в статусе «Принята»."
      );
    }
    setActiveReceivePalletCodes((prev) =>
      prev.includes(normalizedCode) ? prev : [...prev, normalizedCode]
    );
    return true;
  };

  const resetStoreScanFlow = () => {
    setStoreStep("pallet");
    setStoreForm(INITIAL_STORE_FORM);
  };

  const resetReceiveScanFlow = () => {
    setReceiveStep("supplier");
    setReceiveForm(INITIAL_RECEIVE_FORM);
    setPrintFallback({ label: "", html: "" });
  };

  const resetDispatchScanFlow = () => {
    setDispatchStep("setup");
    setDispatchForm(INITIAL_DISPATCH_FORM);
    setDispatchRouteSheetId(null);
    setRouteSheetItems([]);
    setRouteSheetSummary(null);
  };

  const openPrintFallback = () => {
    if (!printFallback.html) return;
    try {
      openHtmlDocumentInNewTab(printFallback.html, {
        popupBlockedMessage:
          "Не удалось открыть новый таб. Документ откроется в текущем окне.",
      });
    } catch {
      const blob = new Blob([printFallback.html], { type: "text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      window.location.href = url;
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    }
  };

  const printPalletPassports = async (palletCodes) => {
    clearAlerts();
    setLoading(true);
    try {
      const printReady = await buildPalletLabelsBatchHtml(palletCodes);
      setPrintFallback(printReady);
      try {
        openHtmlDocumentInNewTab(printReady.html, {
          popupBlockedMessage:
            "Не удалось открыть новый таб. Документ откроется в текущем окне.",
        });
      } catch {
        const blob = new Blob([printReady.html], { type: "text/html;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        window.location.href = url;
        window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      }
    } catch (err) {
      handleFlowError(err, "Не удалось подготовить паспорт паллеты.");
    } finally {
      setLoading(false);
    }
  };

  const fetchPalletPassportHtml = async (palletCode) => {
    const response = await fetch(`${API_BASE}/pallets/print-label`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        palletCode,
        qty: 1,
        layout: "A4_PASSPORT",
      }),
    });
    const html = await response.text();
    if (!response.ok) {
      let message = "Паллета создана, но печать паспорта не выполнена.";
      try {
        const parsed = JSON.parse(html);
        message = mapPalletError(parsed?.message, message);
      } catch {
        // ignore raw html
      }
      throw new Error(message);
    }
    return html;
  };

  const mergePassportHtml = (htmlList, palletCodes) => {
    const firstHtml = String(htmlList?.[0] || "");
    const styleMatch = firstHtml.match(/<style[\s\S]*?<\/style>/i);
    const sharedStyle = styleMatch ? styleMatch[0] : "";

    const bodyParts = htmlList.map((html) => {
      const bodyMatch = String(html || "").match(/<body[^>]*>([\s\S]*?)<\/body>/i);
      const body = bodyMatch ? bodyMatch[1] : String(html || "");
      return body
        .replace(/<div class="print-actions"[\s\S]*?<\/div>/gi, "")
        .replace(/<script[\s\S]*?<\/script>/gi, "");
    });
    const pages = bodyParts
      .map((body, index) => `${index > 0 ? '<div class="passport-page-break"></div>' : ""}${body}`)
      .join("");

    return `
      <html>
        <head>
          <meta charset="utf-8" />
          <title>Паспорта паллет (${palletCodes.length})</title>
          ${sharedStyle}
          <style>
            .passport-page-break {
              height: 0;
              break-before: page;
              page-break-before: always;
            }
            @media print {
              .passport-page-break {
                height: 0;
                break-before: page;
                page-break-before: always;
              }
            }
          </style>
        </head>
        <body>
          ${pages}
          <div class="print-actions">
            <button class="print-btn" onclick="window.print()">Печать</button>
            <button class="print-btn" onclick="returnToApp()">Закрыть</button>
          </div>
          <script>
            function returnToApp() {
              try {
                if (window.opener && !window.opener.closed) {
                  window.close();
                  return;
                }
              } catch (e) {}
              if (window.history.length > 1) {
                window.history.back();
                return;
              }
              window.location.href = "/warehouse?section=tsd";
            }
            window.setTimeout(() => window.print(), 180);
          </script>
        </body>
      </html>
    `;
  };

  const buildPalletLabelsBatchHtml = async (palletCodes) => {
    const codes = Array.from(
      new Set(
        (Array.isArray(palletCodes) ? palletCodes : [])
          .map((item) => normalizePalletCode(item))
          .filter(Boolean)
      )
    );
    if (!codes.length) {
      throw new Error("Нет паллет для печати.");
    }

    const htmlList = [];
    for (const code of codes) {
      htmlList.push(await fetchPalletPassportHtml(code));
    }
    const finalHtml = codes.length > 1 ? mergePassportHtml(htmlList, codes) : htmlList[0];
    return {
      label: codes.length > 1 ? `Паллет: ${codes.length}` : codes[0],
      html: finalHtml,
    };
  };

  const handleReceiveSubmit = async () => {
    if (receiveSubmitLockRef.current) return;
    try {
      receiveSubmitLockRef.current = true;
      clearAlerts();
      setLoading(true);
      const supplierName = String(receiveForm.supplierName || "").trim();
      const inboundRef = String(receiveForm.inboundRef || "").trim();
      if (!supplierName) {
        throw new Error("Укажите поставщика.");
      }
      if (!inboundRef) {
        throw new Error("Укажите машину/ТТН.");
      }
      const qtyRaw = String(receiveForm.qty || "").trim();
      const qty = Number.parseInt(qtyRaw, 10);
      if (!Number.isInteger(qty) || qty < 1 || qty > 30) {
        throw new Error("Укажите количество паллет от 1 до 30.");
      }

      setPrintFallback({ label: "", html: "" });
      const createdCodes = [];
      for (let index = 0; index < qty; index += 1) {
        const response = await fetch(`${API_BASE}/pallets/receive`, {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({ supplierName, inboundRef }),
        });
        const data = await readJsonSafe(response);
        if (!response.ok) {
          throw new Error(mapPalletError(data?.message, "Не удалось принять паллету."));
        }
        const code = data?.pallet?.palletCode || "";
        if (!code) {
          throw new Error("Паллета создана, но код не получен.");
        }
        createdCodes.push(code);
      }

      const printReady = await buildPalletLabelsBatchHtml(createdCodes);
      setPrintFallback(printReady);
      setActiveReceivePalletCodes(
        Array.from(new Set(createdCodes.map((code) => normalizePalletCode(code)).filter(Boolean)))
      );
      setStoreReceiveScopeLocked(true);
      const lastCode = createdCodes[createdCodes.length - 1] || "";
      setSuccess("Успешно");
      setStoreForm((prev) => ({
        ...prev,
        palletCode: lastCode,
      }));
      setReceiveStep("print");
      setStoreStep("pallet");
      setSearchCode(lastCode);
    } catch (err) {
      handleFlowError(err, "Ошибка приемки паллеты.");
    } finally {
      receiveSubmitLockRef.current = false;
      setLoading(false);
    }
  };

  const handleStoreSubmit = async ({
    palletCodeOverride = null,
    locationCodeOverride = null,
  } = {}) => {
    if (storeSubmitLockRef.current) return;
    try {
      storeSubmitLockRef.current = true;
      clearAlerts();
      setLoading(true);
      const palletCode = normalizePalletCode(
        palletCodeOverride == null ? storeForm.palletCode : palletCodeOverride
      );
      const locationCode = normalizeLocationCode(
        locationCodeOverride == null ? storeForm.locationCode : locationCodeOverride
      );
      if (!palletCode) throw new Error("Отсканируйте паллету.");
      if (!locationCode) throw new Error("Отсканируйте зону размещения.");
      await ensureStorePalletAllowed(palletCode);
      const dedupeKey = `${locationCode}|${palletCode}`;
      const now = Date.now();
      if (
        lastStoreSubmitRef.current.key === dedupeKey &&
        now - lastStoreSubmitRef.current.at < 2000
      ) {
        return;
      }
      lastStoreSubmitRef.current = { key: dedupeKey, at: now };

      const response = await fetch(`${API_BASE}/pallets/store`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ palletCode, locationCode }),
      });
      const data = await readJsonSafe(response);
      if (!response.ok) {
        throw new Error(mapPalletError(data?.message, "Не удалось разместить паллету."));
      }

      setSuccess("Успешно");
      setStoreStep("pallet");
      setStoreForm(INITIAL_STORE_FORM);
      setActiveReceivePalletCodes((prev) => prev.filter((code) => code !== palletCode));
      setDispatchForm((prev) => ({
        ...prev,
        palletCode,
      }));
      setSearchCode(palletCode);
    } catch (err) {
      handleFlowError(err, "Ошибка размещения паллеты.");
    } finally {
      storeSubmitLockRef.current = false;
      setLoading(false);
    }
  };

  const handleDispatchSubmit = async ({
    palletCodeOverride = null,
    locationCodeOverride = null,
  } = {}) => {
    if (dispatchSubmitLockRef.current) return;
    try {
      dispatchSubmitLockRef.current = true;
      clearAlerts();
      setLoading(true);
      const locationCode = normalizeLocationCode(
        locationCodeOverride == null ? dispatchForm.locationCode : locationCodeOverride
      );
      const palletCode = normalizePalletCode(
        palletCodeOverride == null ? dispatchForm.palletCode : palletCodeOverride
      );
      if (!locationCode) throw new Error("Отсканируйте ячейку отбора.");
      if (!palletCode) throw new Error("Отсканируйте паллету.");
      const routeSheetId = Number(dispatchRouteSheetId || 0);
      if (!routeSheetId) {
        throw new Error("Сначала выберите маршрутный лист.");
      }
      const dedupeKey = `${routeSheetId}|${locationCode}|${palletCode}`;
      const now = Date.now();
      if (
        lastDispatchSubmitRef.current.key === dedupeKey &&
        now - lastDispatchSubmitRef.current.at < 2000
      ) {
        return;
      }
      lastDispatchSubmitRef.current = { key: dedupeKey, at: now };

      const response = await fetch(`${API_BASE}/pallets/route-sheets/${routeSheetId}/dispatch`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          locationCode,
          palletCode,
        }),
      });
      const data = await readJsonSafe(response);
      if (!response.ok) {
        throw new Error(mapPalletError(data?.message, "Не удалось отгрузить паллету."));
      }

      setSuccess("Успешно");
      const updatedSheet = data?.routeSheet || null;
      if (updatedSheet) {
        setRouteSheetItems(Array.isArray(updatedSheet.items) ? updatedSheet.items : []);
        setRouteSheetSummary(updatedSheet.summary || null);
        setDispatchForm((prev) => ({
          ...prev,
          destinationRc: updatedSheet.destinationRc || "",
          route: updatedSheet.route || "",
          vehicle: updatedSheet.vehicle || "",
          driver: updatedSheet.driver || "",
          notes: updatedSheet.notes || "",
        }));
        if (updatedSheet.status === "COMPLETED") {
          setDispatchStep("setup");
          setDispatchRouteSheetId(null);
          setRouteSheetItems([]);
          setRouteSheetSummary(null);
          await loadDispatchSheets();
        } else {
          setDispatchStep("location");
        }
      } else {
        setDispatchStep("location");
        await loadRouteSheetDetails(routeSheetId, { target: "dispatch", silent: true });
      }
      setDispatchForm((prev) => ({
        ...prev,
        palletCode: "",
        locationCode: "",
      }));
      setSearchCode(palletCode);
    } catch (err) {
      handleFlowError(err, "Ошибка отгрузки паллеты.");
    } finally {
      dispatchSubmitLockRef.current = false;
      setLoading(false);
    }
  };

  const loadRouteSheetDetails = async (routeSheetId, { target = "dispatch", silent = false } = {}) => {
    const normalizedRouteSheetId = Number(routeSheetId || 0);
    if (!normalizedRouteSheetId) {
      if (!silent) {
        throw new Error("Маршрутный лист не выбран.");
      }
      return null;
    }
    setRouteSheetLoading(true);
    try {
      const response = await fetch(`${API_BASE}/pallets/route-sheets/${normalizedRouteSheetId}`, {
        headers: authHeaders,
      });
      const data = await readJsonSafe(response);
      if (!response.ok) {
        throw new Error(mapPalletError(data?.message, "Не удалось загрузить маршрутный лист."));
      }
      const routeSheet = data?.routeSheet || null;
      if (!routeSheet) {
        throw new Error("Маршрутный лист не найден.");
      }
      const items = Array.isArray(routeSheet.items) ? routeSheet.items : [];
      const summary = routeSheet.summary || {
        total: items.length,
        planned: items.filter((item) => item.status === "PLANNED").length,
        loaded: items.filter((item) => item.status === "LOADED").length,
        cancelled: items.filter((item) => item.status === "CANCELLED").length,
        remainingToLoad: items.filter((item) => item.status === "PLANNED").length,
      };
      setRouteSheetItems(items);
      setRouteSheetSummary(summary);
      if (target === "planning") {
        setPlanningSheet(routeSheet);
      }
      if (target === "dispatch") {
        setDispatchRouteSheetId(routeSheet.id);
        setDispatchForm((prev) => ({
          ...prev,
          destinationRc: routeSheet.destinationRc || "",
          route: routeSheet.route || "",
          vehicle: routeSheet.vehicle || "",
          driver: routeSheet.driver || "",
          notes: routeSheet.notes || "",
        }));
      }
      return routeSheet;
    } finally {
      setRouteSheetLoading(false);
    }
  };

  const loadPlanningSheets = async () => {
    setPlanningSheetsLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("statuses", "DRAFT,PUBLISHED,LOADING,COMPLETED");
      params.set("limit", "120");
      const response = await fetch(`${API_BASE}/pallets/route-sheets?${params.toString()}`, {
        headers: authHeaders,
      });
      const data = await readJsonSafe(response);
      if (!response.ok) {
        throw new Error(mapPalletError(data?.message, "Не удалось загрузить маршрутные листы."));
      }
      setPlanningSheets(Array.isArray(data?.items) ? data.items : []);
    } catch (err) {
      handleFlowError(err, "Не удалось загрузить маршрутные листы.");
    } finally {
      setPlanningSheetsLoading(false);
    }
  };

  const loadDispatchSheets = async () => {
    setDispatchSheetsLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("statuses", "PUBLISHED,LOADING");
      params.set("limit", "80");
      const response = await fetch(`${API_BASE}/pallets/route-sheets?${params.toString()}`, {
        headers: authHeaders,
      });
      const data = await readJsonSafe(response);
      if (!response.ok) {
        throw new Error(mapPalletError(data?.message, "Не удалось загрузить маршрутные листы."));
      }
      setDispatchSheets(Array.isArray(data?.items) ? data.items : []);
    } catch (err) {
      handleFlowError(err, "Не удалось загрузить маршрутные листы.");
    } finally {
      setDispatchSheetsLoading(false);
    }
  };

  const createPlanningRouteSheet = async () => {
    setPlanningBusy(true);
    try {
      clearAlerts();
      const payload = {
        clientName: String(planningForm.clientName || "").trim(),
        destinationRc: String(planningForm.destinationRc || "").trim(),
        route: String(planningForm.route || "").trim() || null,
        vehicle: String(planningForm.vehicle || "").trim().toUpperCase(),
        driver: String(planningForm.driver || "").trim(),
        plannedDate: planningForm.plannedDate ? new Date(planningForm.plannedDate).toISOString() : "",
        notes: String(planningForm.notes || "").trim() || null,
      };
      const response = await fetch(`${API_BASE}/pallets/route-sheets`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify(payload),
      });
      const data = await readJsonSafe(response);
      if (!response.ok) {
        throw new Error(mapPalletError(data?.message, "Не удалось создать маршрутный лист."));
      }
      const routeSheet = data?.routeSheet || null;
      if (!routeSheet?.id) {
        throw new Error("Маршрутный лист создан, но карточка не получена.");
      }
      setPlanningSheet(routeSheet);
      setPlanningSelectedCodes([]);
      setPlanningCandidates([]);
      setPlanningCandidateQuery("");
      setSuccess("Маршрутный лист создан.");
      await loadPlanningSheets();
      await loadRouteSheetDetails(routeSheet.id, { target: "planning", silent: true });
    } catch (err) {
      handleFlowError(err, "Не удалось создать маршрутный лист.");
    } finally {
      setPlanningBusy(false);
    }
  };

  const loadPlanningCandidates = async () => {
    setPlanningCandidatesLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("status", "STORED");
      if (planningCandidateQuery) {
        params.set("q", planningCandidateQuery.trim());
      }
      const response = await fetch(`${API_BASE}/pallets?${params.toString()}`, {
        headers: authHeaders,
      });
      const data = await readJsonSafe(response);
      if (!response.ok) {
        throw new Error(mapPalletError(data?.message, "Не удалось загрузить паллеты для МЛ."));
      }
      const items = Array.isArray(data?.items) ? data.items : [];
      const plannedCodes = new Set(
        Array.isArray(planningSheet?.items)
          ? planningSheet.items
              .filter((item) => item?.status === "PLANNED")
              .map((item) => normalizePalletCode(item?.pallet?.palletCode || ""))
              .filter(Boolean)
          : []
      );
      setPlanningCandidates(
        items.filter((item) => !plannedCodes.has(normalizePalletCode(item?.palletCode || "")))
      );
    } catch (err) {
      handleFlowError(err, "Не удалось загрузить паллеты для МЛ.");
    } finally {
      setPlanningCandidatesLoading(false);
    }
  };

  const addSelectedPalletsToPlanningSheet = async () => {
    const routeSheetId = Number(planningSheet?.id || 0);
    if (!routeSheetId) {
      handleFlowError("Сначала создайте или выберите маршрутный лист.");
      return;
    }
    const palletCodes = planningSelectedCodes
      .map((code) => normalizePalletCode(code))
      .filter(Boolean);
    if (!palletCodes.length) {
      handleFlowError("Выберите хотя бы одну паллету для добавления.");
      return;
    }

    setPlanningBusy(true);
    try {
      clearAlerts();
      const response = await fetch(`${API_BASE}/pallets/route-sheets/${routeSheetId}/items`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ palletCodes }),
      });
      const data = await readJsonSafe(response);
      if (!response.ok) {
        throw new Error(mapPalletError(data?.message, "Не удалось добавить паллеты в маршрутный лист."));
      }
      setPlanningSelectedCodes([]);
      setSuccess("Паллеты добавлены в маршрутный лист.");
      await loadRouteSheetDetails(routeSheetId, { target: "planning", silent: true });
      await loadPlanningCandidates();
      await loadPlanningSheets();
    } catch (err) {
      handleFlowError(err, "Не удалось добавить паллеты в маршрутный лист.");
    } finally {
      setPlanningBusy(false);
    }
  };

  const removePlanningSheetItem = async (itemId) => {
    const routeSheetId = Number(planningSheet?.id || 0);
    const normalizedItemId = Number(itemId || 0);
    if (!routeSheetId || !normalizedItemId) return;
    setPlanningBusy(true);
    try {
      clearAlerts();
      const response = await fetch(
        `${API_BASE}/pallets/route-sheets/${routeSheetId}/items/${normalizedItemId}`,
        {
          method: "DELETE",
          headers: authHeaders,
        }
      );
      const data = await readJsonSafe(response);
      if (!response.ok) {
        throw new Error(mapPalletError(data?.message, "Не удалось удалить паллету из маршрутного листа."));
      }
      setSuccess("Паллета удалена из маршрутного листа.");
      await loadRouteSheetDetails(routeSheetId, { target: "planning", silent: true });
      await loadPlanningCandidates();
      await loadPlanningSheets();
    } catch (err) {
      handleFlowError(err, "Не удалось удалить паллету из маршрутного листа.");
    } finally {
      setPlanningBusy(false);
    }
  };

  const publishPlanningSheet = async () => {
    const routeSheetId = Number(planningSheet?.id || 0);
    if (!routeSheetId) {
      handleFlowError("Маршрутный лист не выбран.");
      return;
    }
    setPlanningBusy(true);
    try {
      clearAlerts();
      const response = await fetch(`${API_BASE}/pallets/route-sheets/${routeSheetId}/publish`, {
        method: "POST",
        headers: authHeaders,
      });
      const data = await readJsonSafe(response);
      if (!response.ok) {
        throw new Error(mapPalletError(data?.message, "Не удалось выгрузить маршрутный лист на склад."));
      }
      setPlanningSheet(data?.routeSheet || null);
      setSuccess("Маршрутный лист выгружен на склад.");
      await loadPlanningSheets();
      await loadDispatchSheets();
    } catch (err) {
      handleFlowError(err, "Не удалось выгрузить маршрутный лист на склад.");
    } finally {
      setPlanningBusy(false);
    }
  };

  const loadHistoryByCode = async (rawCode, { openDetail = true } = {}) => {
    const palletCode = normalizePalletCode(rawCode);
    if (!palletCode) {
      throw new Error("Отсканируйте код паллеты.");
    }

    setHistoryLoading(true);
    try {
      const response = await fetch(
        `${API_BASE}/pallets/${encodeURIComponent(palletCode)}/history`,
        { headers: authHeaders }
      );
      const data = await readJsonSafe(response);
      if (!response.ok) {
        throw new Error(mapPalletError(data?.message, "Не удалось загрузить историю паллеты."));
      }
      setHistoryPallet(data?.pallet || null);
      setHistoryEvents(Array.isArray(data?.events) ? data.events : []);
      setHistoryCollapsed(false);
      setSelectedPalletId(data?.pallet?.id || null);
      if (openDetail) {
        setSearchView("detail");
      }
      return data?.pallet || null;
    } finally {
      setHistoryLoading(false);
    }
  };

  const loadRecentPallets = async () => {
    setRecentLoading(true);
    try {
      const params = new URLSearchParams();
      if (searchStatus === "ACTIVE") params.set("statuses", "RECEIVED,STORED");
      if (searchStatus === "DISPATCHED") params.set("statuses", "DISPATCHED");
      if (searchQuery) params.set("q", searchQuery.trim());
      if (searchSupplier) params.set("supplierName", searchSupplier.trim());
      if (searchDateFrom) params.set("dateFrom", searchDateFrom);
      if (searchDateTo) params.set("dateTo", searchDateTo);
      const response = await fetch(`${API_BASE}/pallets?${params.toString()}`, {
        headers: authHeaders,
      });
      const data = await readJsonSafe(response);
      if (!response.ok) {
        throw new Error(mapPalletError(data?.message, "Не удалось загрузить список паллет."));
      }
      setRecentItems(Array.isArray(data?.items) ? data.items : []);
    } catch (err) {
      handleFlowError(err, "Ошибка загрузки списка паллет.");
    } finally {
      setRecentLoading(false);
    }
  };

  const loadSearchSuppliers = async () => {
    setSearchSuppliersLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("limit", "200");
      const response = await fetch(`${API_BASE}/pallets/suppliers?${params.toString()}`, {
        headers: authHeaders,
      });
      const data = await readJsonSafe(response);
      if (response.ok) {
        setSearchSuppliers(Array.isArray(data?.items) ? data.items : []);
        return;
      }

      // Fallback для окружений, где endpoint /pallets/suppliers еще не развернут.
      const fallbackResponse = await fetch(`${API_BASE}/pallets`, {
        headers: authHeaders,
      });
      const fallbackData = await readJsonSafe(fallbackResponse);
      if (fallbackResponse.ok) {
        setSearchSuppliers(extractSuppliersFromPalletItems(fallbackData?.items, 200));
        return;
      }

      setSearchSuppliers([]);
      console.warn("search suppliers load failed", {
        suppliersEndpointMessage: data?.message || null,
        fallbackMessage: fallbackData?.message || null,
      });
    } catch (err) {
      setSearchSuppliers([]);
      console.warn("search suppliers load error", err);
    } finally {
      setSearchSuppliersLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab !== "search") return;
    if (searchView !== "list") return;
    loadRecentPallets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, searchStatus, searchQuery, searchSupplier, searchDateFrom, searchDateTo, searchView]);

  useEffect(() => {
    if (activeTab !== "search") return;
    if (searchView !== "list") return;
    loadSearchSuppliers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, searchView]);

  useEffect(() => {
    if (activeTab !== "dispatch") return;
    loadDispatchSheets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  useEffect(() => {
    if (activeTab !== "planning") return;
    loadPlanningSheets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  useEffect(() => {
    if (activeTab !== "planning") return;
    if (!planningSheet?.id) return;
    if (planningSheet.status !== "DRAFT") return;
    loadPlanningCandidates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, planningSheet?.id, planningSheet?.status]);

  useEffect(() => {
    if (!success) return;
    const timer = window.setTimeout(() => {
      setSuccess("");
    }, 2200);
    return () => window.clearTimeout(timer);
  }, [success]);

  const tabs = useMemo(
    () => [
      { id: "receive", label: "Приемка" },
      { id: "store", label: "Размещение" },
      { id: "planning", label: "Планирование МЛ" },
      { id: "dispatch", label: "Отгрузка" },
      { id: "search", label: "Поиск паллет" },
    ],
    []
  );
  const strictStepLock = activeTab === "store" || (activeTab === "dispatch" && dispatchStep !== "setup");

  const handleHeaderBack = useCallback(() => {
    setError("");
    setSuccess("");

    if (activeTab === "receive") {
      if (receiveStep === "inbound") {
        setReceiveStep("supplier");
        return;
      }
      if (receiveStep === "qty") {
        setReceiveStep("inbound");
        return;
      }
      if (receiveStep === "print") {
        setReceiveStep("qty");
        return;
      }
    }

    if (activeTab === "store") {
      if (storeStep === "location") {
        setStoreStep("pallet");
        setStoreForm((prev) => ({ ...prev, locationCode: "" }));
        return;
      }
      setStoreStep("pallet");
      setStoreForm(INITIAL_STORE_FORM);
      setActiveTab("receive");
      return;
    }

    if (activeTab === "dispatch") {
      if (dispatchStep === "pallet") {
        setDispatchStep("location");
        setDispatchForm((prev) => ({ ...prev, palletCode: "" }));
        return;
      }
      if (dispatchStep === "location") {
        setDispatchStep("setup");
        setDispatchForm((prev) => ({ ...prev, locationCode: "", palletCode: "" }));
        return;
      }
      if (dispatchRouteSheetId) {
        setDispatchRouteSheetId(null);
        setRouteSheetItems([]);
        setRouteSheetSummary(null);
        setDispatchForm(INITIAL_DISPATCH_FORM);
        return;
      }
      setActiveTab("receive");
      return;
    }

    if (activeTab === "planning") {
      if (planningSheet?.id) {
        setPlanningSheet(null);
        setPlanningSelectedCodes([]);
        setPlanningCandidates([]);
        return;
      }
      setActiveTab("receive");
      return;
    }

    if (activeTab === "search") {
      if (searchView === "detail") {
        setSearchView("list");
        return;
      }
      setActiveTab("receive");
      return;
    }

    if (typeof onBack === "function") {
      onBack();
    }
  }, [
    activeTab,
    dispatchRouteSheetId,
    dispatchStep,
    onBack,
    planningSheet,
    receiveStep,
    searchView,
    storeStep,
  ]);

  useEffect(() => {
    const handleExternalBack = (event) => {
      handleHeaderBack();
      if (typeof event?.preventDefault === "function") {
        event.preventDefault();
      }
    };

    window.addEventListener("crossdock:back-request", handleExternalBack);
    return () => window.removeEventListener("crossdock:back-request", handleExternalBack);
  }, [handleHeaderBack]);

  return (
    <>
      {showInternalBack ? (
        <TsdHeader
          title="Кросс-докинг"
          subtitle="Паллетный контур: приемка, размещение, отгрузка"
          onBack={handleHeaderBack}
          showBackButton={showInternalBack}
        />
      ) : null}

      {!strictStepLock ? (
        <div className="tsd-pallet-tabs">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`tsd-pallet-tab ${activeTab === tab.id ? "tsd-pallet-tab--active" : ""}`}
              onClick={() => {
                clearAlerts();
                if (tab.id === "receive") {
                  resetReceiveScanFlow();
                }
                if (tab.id === "store") {
                  resetStoreScanFlow();
                }
                if (tab.id === "dispatch") {
                  resetDispatchScanFlow();
                }
                if (tab.id === "planning") {
                  setPlanningSheet(null);
                  setPlanningSelectedCodes([]);
                  setPlanningCandidates([]);
                  setPlanningCandidateQuery("");
                }
                if (tab.id === "search") {
                  setSearchView("list");
                }
                setActiveTab(tab.id);
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
      ) : null}

      <div className="tsd-section">
        <TsdErrorAlert message={error} />

        {activeTab === "receive" ? (
          <div className="tsd-list">
            <div className="tsd-card">
              <div className="tsd-card__title">Пошаговая приемка</div>
              <div className="tsd-card__meta">
                {receiveStep === "supplier"
                  ? "Шаг 1 из 3: укажите поставщика."
                  : receiveStep === "inbound"
                    ? "Шаг 2 из 3: укажите машину / ТТН."
                    : receiveStep === "qty"
                      ? "Шаг 3 из 3: укажите количество паллет."
                      : "Паспорта сформированы. Откройте и распечатайте."}
              </div>
              <div className="tsd-card__meta">
                Поставщик: {String(receiveForm.supplierName || "").trim() || "-"} • Машина/ТТН:{" "}
                {String(receiveForm.inboundRef || "").trim() || "-"} • Кол-во:{" "}
                {String(receiveForm.qty || "").trim() || "-"}
              </div>
            </div>

            {receiveStep === "supplier" ? (
              <>
                <div className="tsd-qty-input">
                  <label className="tsd-scanner__label">Поставщик *</label>
                  <input
                    className="tsd-input"
                    value={receiveForm.supplierName}
                    onChange={(event) =>
                      setReceiveForm((prev) => ({ ...prev, supplierName: event.target.value }))
                    }
                    placeholder="Название поставщика"
                    disabled={loading}
                  />
                </div>
                <div className="tsd-action-bar">
                  <button
                    type="button"
                    className="tsd-btn tsd-btn--primary"
                    onClick={() => {
                      if (!String(receiveForm.supplierName || "").trim()) {
                        handleFlowError("Укажите поставщика.");
                        return;
                      }
                      clearAlerts();
                      setReceiveStep("inbound");
                    }}
                    disabled={loading || !String(receiveForm.supplierName || "").trim()}
                  >
                    Далее
                  </button>
                </div>
              </>
            ) : null}

            {receiveStep === "inbound" ? (
              <>
                <div className="tsd-qty-input">
                  <label className="tsd-scanner__label">Машина / ТТН *</label>
                  <input
                    className="tsd-input"
                    value={receiveForm.inboundRef}
                    onChange={(event) =>
                      setReceiveForm((prev) => ({
                        ...prev,
                        inboundRef: String(event.target.value || "").toUpperCase(),
                      }))
                    }
                    placeholder="Например, А123ВС77 / ТТН-0001"
                    disabled={loading}
                  />
                </div>
                <div className="tsd-action-bar">
                  <button
                    type="button"
                    className="tsd-btn tsd-btn--primary"
                    onClick={() => {
                      if (!String(receiveForm.inboundRef || "").trim()) {
                        handleFlowError("Укажите машину/ТТН.");
                        return;
                      }
                      clearAlerts();
                      setReceiveStep("qty");
                    }}
                    disabled={loading || !String(receiveForm.inboundRef || "").trim()}
                  >
                    Далее
                  </button>
                </div>
              </>
            ) : null}

            {receiveStep === "qty" ? (
              <>
                <div className="tsd-qty-input">
                  <label className="tsd-scanner__label">Сколько паллет привезли? *</label>
                  <input
                    className="tsd-input"
                    type="number"
                    min={1}
                    max={30}
                    value={receiveForm.qty}
                    onChange={(event) =>
                      setReceiveForm((prev) => ({ ...prev, qty: event.target.value }))
                    }
                    placeholder="Например, 3"
                    disabled={loading}
                  />
                </div>
                <div className="tsd-action-bar">
                  <button
                    type="button"
                    className="tsd-btn tsd-btn--primary"
                    onClick={handleReceiveSubmit}
                    disabled={
                      loading ||
                      !String(receiveForm.supplierName || "").trim() ||
                      !String(receiveForm.inboundRef || "").trim() ||
                      !Number.isInteger(Number.parseInt(String(receiveForm.qty || "").trim(), 10)) ||
                      Number.parseInt(String(receiveForm.qty || "").trim(), 10) < 1 ||
                      Number.parseInt(String(receiveForm.qty || "").trim(), 10) > 30
                    }
                  >
                    {loading ? "Создаем..." : "Создать и напечатать"}
                  </button>
                </div>
              </>
            ) : null}
            {receiveStep === "print" ? (
              <div className="tsd-card">
                <div className="tsd-card__title">Паспорта готовы</div>
                <div className="tsd-card__meta">
                  {printFallback.label ? `${printFallback.label}.` : ""}
                  Нажмите кнопку, чтобы открыть и распечатать.
                </div>
                <div className="tsd-action-bar">
                  <button
                    type="button"
                    className="tsd-btn tsd-btn--ghost"
                    onClick={resetReceiveScanFlow}
                    disabled={loading}
                  >
                    Новая приемка
                  </button>
                  <button
                    type="button"
                    className="tsd-btn tsd-btn--primary tsd-btn--center"
                    onClick={openPrintFallback}
                  >
                    Открыть паспорт A4
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {activeTab === "store" ? (
          <div className="tsd-list">
            <div className="tsd-card">
              <div className="tsd-card__title">Пошаговое размещение</div>
              <div className="tsd-card__meta">
                {storeStep === "pallet"
                  ? "Шаг 1 из 2: отсканируйте паллету."
                  : "Шаг 2 из 2: отсканируйте ячейку размещения для подтверждения."}
              </div>
              <div className="tsd-card__meta">
                Ячейка: {storeForm.locationCode || "-"} • Паллета: {storeForm.palletCode || "-"}
              </div>
              <div className="tsd-card__meta">
                Паллет текущей приемки: {activeReceivePalletCodes.length}
              </div>
            </div>

            {storeStep === "pallet" ? (
              <Scanner
                label="Шаг 1. Скан паллеты"
                hint="Сканируйте паспорт паллеты"
                manualPlaceholder="bp:pallet:PLT-..."
                onScan={async (value) => {
                  const scannedPalletCode = normalizePalletCode(value);
                  if (!scannedPalletCode) return;
                  try {
                    await ensureStorePalletAllowed(scannedPalletCode);
                  } catch (err) {
                    handleFlowError(err, "Не удалось проверить паллету для размещения.");
                    return;
                  }
                  setStoreForm((prev) => ({
                    ...prev,
                    palletCode: scannedPalletCode,
                    locationCode: "",
                  }));
                  setStoreStep("location");
                }}
                disabled={loading}
                autoStart
                showManual={false}
              />
            ) : null}

            {storeStep === "location" ? (
              <>
                <div className="tsd-action-inline">
                  <button
                    type="button"
                    className="tsd-btn tsd-btn--ghost tsd-btn--center"
                    onClick={resetStoreScanFlow}
                    disabled={loading}
                  >
                    Сканировать другую паллету
                  </button>
                </div>
                <Scanner
                  label="Шаг 2. Скан ячейки размещения"
                  hint={`Паллета ${storeForm.palletCode || "-"} принята. Сканируйте ячейку.`}
                  manualPlaceholder="Код ячейки"
                  onScan={async (value) => {
                    const scannedLocationCode = normalizeLocationCode(value);
                    if (!scannedLocationCode) return;
                    const normalizedPalletCode = normalizePalletCode(storeForm.palletCode);
                    if (!normalizedPalletCode) {
                      handleFlowError("Сначала отсканируйте паллету.");
                      return;
                    }
                    setStoreForm((prev) => ({ ...prev, locationCode: scannedLocationCode }));
                    await handleStoreSubmit({
                      palletCodeOverride: normalizedPalletCode,
                      locationCodeOverride: scannedLocationCode,
                    });
                  }}
                  disabled={loading}
                  autoStart
                  scanKind="barcode"
                  showManual={false}
                />
              </>
            ) : null}
          </div>
        ) : null}

        {activeTab === "planning" ? (
          <div className="tsd-list">
            {!planningSheet?.id ? (
              <>
                <div className="tsd-card">
                  <div className="tsd-card__title">Планирование маршрутного листа</div>
                  <div className="tsd-card__meta">
                    Заполните рейс, затем добавьте паллеты и выгрузите МЛ на склад.
                  </div>
                </div>
                <div className="tsd-qty-input">
                  <label className="tsd-scanner__label">Клиент *</label>
                  <input
                    className="tsd-input"
                    value={planningForm.clientName}
                    onChange={(event) =>
                      setPlanningForm((prev) => ({ ...prev, clientName: event.target.value }))
                    }
                    placeholder="Клиент"
                    disabled={planningBusy}
                  />
                </div>
                <div className="tsd-inline tsd-inline--two">
                  <input
                    className="tsd-input"
                    value={planningForm.destinationRc}
                    onChange={(event) =>
                      setPlanningForm((prev) => ({ ...prev, destinationRc: event.target.value }))
                    }
                    placeholder="РЦ назначения *"
                    disabled={planningBusy}
                  />
                  <input
                    className="tsd-input"
                    type="date"
                    value={planningForm.plannedDate}
                    onChange={(event) =>
                      setPlanningForm((prev) => ({ ...prev, plannedDate: event.target.value }))
                    }
                    disabled={planningBusy}
                  />
                </div>
                <div className="tsd-inline tsd-inline--two">
                  <input
                    className="tsd-input"
                    value={planningForm.vehicle}
                    onChange={(event) =>
                      setPlanningForm((prev) => ({
                        ...prev,
                        vehicle: String(event.target.value || "").toUpperCase(),
                      }))
                    }
                    placeholder="Машина *"
                    disabled={planningBusy}
                  />
                  <input
                    className="tsd-input"
                    value={planningForm.driver}
                    onChange={(event) =>
                      setPlanningForm((prev) => ({ ...prev, driver: event.target.value }))
                    }
                    placeholder="Водитель *"
                    disabled={planningBusy}
                  />
                </div>
                <div className="tsd-qty-input">
                  <input
                    className="tsd-input"
                    value={planningForm.route}
                    onChange={(event) =>
                      setPlanningForm((prev) => ({ ...prev, route: event.target.value }))
                    }
                    placeholder="Маршрут (необязательно)"
                    disabled={planningBusy}
                  />
                </div>
                <div className="tsd-qty-input">
                  <textarea
                    className="tsd-input"
                    rows={2}
                    value={planningForm.notes}
                    onChange={(event) =>
                      setPlanningForm((prev) => ({ ...prev, notes: event.target.value }))
                    }
                    placeholder="Комментарий к маршруту (необязательно)"
                    disabled={planningBusy}
                  />
                </div>
                <div className="tsd-action-bar">
                  <button
                    type="button"
                    className="tsd-btn tsd-btn--primary"
                    onClick={createPlanningRouteSheet}
                    disabled={planningBusy}
                  >
                    {planningBusy ? "Создаем..." : "Создать МЛ"}
                  </button>
                  <button
                    type="button"
                    className="tsd-btn tsd-btn--secondary"
                    onClick={loadPlanningSheets}
                    disabled={planningSheetsLoading}
                  >
                    {planningSheetsLoading ? "Обновляем..." : "Обновить список МЛ"}
                  </button>
                </div>
                {planningSheets.length ? (
                  <div className="tsd-list">
                    {planningSheets
                      .filter((sheet) => ["DRAFT", "PUBLISHED", "LOADING"].includes(sheet.status))
                      .map((sheet) => (
                        <button
                          key={sheet.id}
                          type="button"
                          className="tsd-card tsd-pallet-list-btn"
                          onClick={async () => {
                            try {
                              clearAlerts();
                              await loadRouteSheetDetails(sheet.id, { target: "planning" });
                            } catch (err) {
                              handleFlowError(err, "Не удалось открыть маршрутный лист.");
                            }
                          }}
                        >
                          <div className="tsd-card__title">{sheet.sheetNumber}</div>
                          <div className="tsd-card__meta">
                            {routeSheetStatusLabel(sheet.status)} • Клиент: {sheet.clientName || "-"}
                          </div>
                          <div className="tsd-card__meta">
                            К погрузке: {sheet.summary?.planned || 0} • Погружено:{" "}
                            {sheet.summary?.loaded || 0}
                          </div>
                        </button>
                      ))}
                  </div>
                ) : null}
              </>
            ) : (
              <>
                <div className="tsd-card">
                  <div className="tsd-inline tsd-inline--two">
                    <div className="tsd-card__title">МЛ {planningSheet.sheetNumber}</div>
                  </div>
                  <div className="tsd-card__meta">
                    {routeSheetStatusLabel(planningSheet.status)} • Клиент: {planningSheet.clientName || "-"}
                  </div>
                  <div className="tsd-card__meta">
                    РЦ: {planningSheet.destinationRc || "-"} • Машина: {planningSheet.vehicle || "-"}
                  </div>
                  <div className="tsd-card__meta">
                    К погрузке: {planningSheet.summary?.planned || 0} • Погружено:{" "}
                    {planningSheet.summary?.loaded || 0}
                  </div>
                </div>

                {planningSheet.status === "DRAFT" ? (
                  <>
                    <div className="tsd-inline tsd-inline--two">
                      <input
                        className="tsd-input"
                        value={planningCandidateQuery}
                        onChange={(event) => setPlanningCandidateQuery(event.target.value)}
                        placeholder="Поиск паллет: код, поставщик, ТТН"
                        disabled={planningCandidatesLoading || planningBusy}
                      />
                      <button
                        type="button"
                        className="tsd-btn tsd-btn--secondary"
                        onClick={loadPlanningCandidates}
                        disabled={planningCandidatesLoading || planningBusy}
                      >
                        {planningCandidatesLoading ? "Загружаем..." : "Найти паллеты"}
                      </button>
                    </div>

                    {planningCandidates.length ? (
                      <div className="tsd-list">
                        {planningCandidates.slice(0, 120).map((item) => {
                          const code = normalizePalletCode(item?.palletCode || "");
                          const checked = planningSelectedCodes.includes(code);
                          return (
                            <label key={item.id} className="tsd-card tsd-pallet-list-btn">
                              <div className="tsd-inline tsd-inline--two">
                                <div className="tsd-card__title">{item.palletCode}</div>
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={(event) => {
                                    setPlanningSelectedCodes((prev) => {
                                      if (!event.target.checked) return prev.filter((value) => value !== code);
                                      return prev.includes(code) ? prev : [...prev, code];
                                    });
                                  }}
                                  disabled={planningBusy}
                                />
                              </div>
                              <div className="tsd-card__meta">Ячейка: {item.currentLocation?.code || "-"}</div>
                              <div className="tsd-card__meta">
                                Поставщик: {item.supplierName || "-"} • Машина/ТТН: {item.inboundRef || "-"}
                              </div>
                            </label>
                          );
                        })}
                      </div>
                    ) : null}

                    <div className="tsd-action-bar">
                      <button
                        type="button"
                        className="tsd-btn tsd-btn--primary"
                        onClick={addSelectedPalletsToPlanningSheet}
                        disabled={planningBusy || !planningSelectedCodes.length}
                      >
                        Добавить выбранные ({planningSelectedCodes.length})
                      </button>
                      <button
                        type="button"
                        className="tsd-btn tsd-btn--secondary"
                        onClick={publishPlanningSheet}
                        disabled={planningBusy}
                      >
                        Выгрузить МЛ на склад
                      </button>
                    </div>
                  </>
                ) : null}

                {Array.isArray(planningSheet.items) && planningSheet.items.length ? (
                  <div className="tsd-list">
                    {planningSheet.items.map((item) => (
                      <div key={item.id} className="tsd-card">
                        <div className="tsd-inline tsd-inline--two">
                          <div className="tsd-card__title">{item.pallet?.palletCode || "-"}</div>
                          <div className="tsd-card__meta">{routeSheetItemStatusLabel(item.status)}</div>
                        </div>
                        <div className="tsd-card__meta">
                          Ячейка: {item.pallet?.currentLocation?.code || "-"} • Поставщик:{" "}
                          {item.pallet?.supplierName || "-"}
                        </div>
                        <div className="tsd-card__meta">Добавлена: {formatDateTime(item.plannedAt)}</div>
                        {planningSheet.status === "DRAFT" && item.status === "PLANNED" ? (
                          <div className="tsd-action-inline">
                            <button
                              type="button"
                              className="tsd-btn tsd-btn--ghost"
                              onClick={() => removePlanningSheetItem(item.id)}
                              disabled={planningBusy}
                            >
                              Удалить из МЛ
                            </button>
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : null}
              </>
            )}
          </div>
        ) : null}

        {activeTab === "dispatch" ? (
          <div className="tsd-list">
            <div className="tsd-card">
              <div className="tsd-card__title">Пошаговая отгрузка по МЛ</div>
              <div className="tsd-card__meta">
                {dispatchStep === "setup"
                  ? "Шаг 1 из 3: выберите маршрутный лист."
                  : dispatchStep === "location"
                    ? "Шаг 2 из 3: отсканируйте ячейку отбора."
                    : "Шаг 3 из 3: отсканируйте паллету для подтверждения отгрузки."}
              </div>
              <div className="tsd-card__meta">
                МЛ: {dispatchRouteSheetId || "-"} • РЦ: {dispatchForm.destinationRc || "-"} • Ячейка:{" "}
                {dispatchForm.locationCode || "-"} • Паллета: {dispatchForm.palletCode || "-"}
              </div>
            </div>
            {dispatchStep === "setup" ? (
              <>
                <div className="tsd-action-bar">
                  <button
                    type="button"
                    className="tsd-btn tsd-btn--secondary"
                    onClick={loadDispatchSheets}
                    disabled={loading || dispatchSheetsLoading}
                  >
                    {dispatchSheetsLoading ? "Обновляем..." : "Обновить МЛ"}
                  </button>
                </div>

                {dispatchRouteSheetId && routeSheetSummary ? (
                  <div className="tsd-card">
                    <div className="tsd-card__title">Выбранный маршрутный лист #{dispatchRouteSheetId}</div>
                    <div className="tsd-card__meta">РЦ назначения: {dispatchForm.destinationRc || "-"}</div>
                    <div className="tsd-card__meta">
                      Машина: {dispatchForm.vehicle || "-"} • Водитель: {dispatchForm.driver || "-"}
                    </div>
                    <div className="tsd-card__meta">
                      К погрузке: {routeSheetSummary.planned || 0} • Погружено: {routeSheetSummary.loaded || 0}
                    </div>
                    <div className="tsd-action-bar">
                      <button
                        type="button"
                        className="tsd-btn tsd-btn--primary"
                        onClick={() => setDispatchStep("location")}
                        disabled={loading}
                      >
                        Начать отгрузку
                      </button>
                      <button
                        type="button"
                        className="tsd-btn tsd-btn--ghost"
                        onClick={() => {
                          setDispatchRouteSheetId(null);
                          setDispatchForm(INITIAL_DISPATCH_FORM);
                          setRouteSheetItems([]);
                          setRouteSheetSummary(null);
                        }}
                        disabled={loading}
                      >
                        Сменить МЛ
                      </button>
                    </div>
                  </div>
                ) : null}

                {dispatchSheets.length ? (
                  <div className="tsd-list">
                    {dispatchSheets.map((sheet) => (
                      <button
                        key={sheet.id}
                        type="button"
                        className={`tsd-card tsd-pallet-list-btn ${
                          dispatchRouteSheetId === sheet.id ? "tsd-route-sheet-item--active" : ""
                        }`}
                        onClick={async () => {
                          try {
                            clearAlerts();
                            await loadRouteSheetDetails(sheet.id, { target: "dispatch" });
                          } catch (err) {
                            handleFlowError(err, "Не удалось открыть маршрутный лист.");
                          }
                        }}
                      >
                        <div className="tsd-card__title">{sheet.sheetNumber || `МЛ ${sheet.id}`}</div>
                        <div className="tsd-card__meta">
                          Статус: {routeSheetStatusLabel(sheet.status)} • Клиент: {sheet.clientName || "-"}
                        </div>
                        <div className="tsd-card__meta">РЦ: {sheet.destinationRc || "-"}</div>
                        <div className="tsd-card__meta">
                          К погрузке: {sheet.summary?.planned || 0} • Погружено: {sheet.summary?.loaded || 0}
                        </div>
                      </button>
                    ))}
                  </div>
                ) : null}
              </>
            ) : null}

            {dispatchStep === "location" ? (
              <>
                <div className="tsd-action-inline">
                  <button
                    type="button"
                    className="tsd-btn tsd-btn--ghost tsd-btn--center"
                    onClick={() => {
                      setDispatchStep("setup");
                      setDispatchForm((prev) => ({ ...prev, locationCode: "", palletCode: "" }));
                    }}
                    disabled={loading}
                  >
                    Сменить МЛ
                  </button>
                </div>
                <Scanner
                  label="Шаг 2. Скан ячейки отбора"
                  hint="Отсканируйте текущую ячейку паллеты перед отгрузкой"
                  manualPlaceholder="Код ячейки"
                  onScan={async (value) => {
                    const scannedLocationCode = normalizeLocationCode(value);
                    if (!scannedLocationCode) return;
                    setDispatchForm((prev) => ({
                      ...prev,
                      locationCode: scannedLocationCode,
                      palletCode: "",
                    }));
                    setDispatchStep("pallet");
                  }}
                  disabled={loading}
                  autoStart
                  scanKind="barcode"
                  showManual={false}
                />
              </>
            ) : null}

            {dispatchStep === "pallet" ? (
              <>
                <div className="tsd-action-inline">
                  <button
                    type="button"
                    className="tsd-btn tsd-btn--ghost tsd-btn--center"
                    onClick={() => {
                      setDispatchStep("location");
                      setDispatchForm((prev) => ({ ...prev, palletCode: "" }));
                    }}
                    disabled={loading}
                  >
                    Сканировать другую ячейку
                  </button>
                </div>
                <Scanner
                  label="Шаг 3. Скан паллеты"
                  hint={`Ячейка ${dispatchForm.locationCode || "-"} принята. Сканируйте паллету.`}
                  manualPlaceholder="bp:pallet:PLT-..."
                  onScan={async (value) => {
                    const scannedPalletCode = normalizePalletCode(value);
                    if (!scannedPalletCode) return;
                    const locationCode = normalizeLocationCode(dispatchForm.locationCode);
                    if (!locationCode) {
                      handleFlowError("Сначала отсканируйте ячейку отбора.");
                      return;
                    }
                    const routeSheetId = Number(dispatchRouteSheetId || 0);
                    if (!routeSheetId) {
                      handleFlowError("Сначала выберите маршрутный лист.");
                      return;
                    }
                    const itemByCode = new Map(
                      routeSheetItems
                        .map((item) => ({
                          code: normalizePalletCode(item?.pallet?.palletCode || ""),
                          status: String(item?.status || "").trim().toUpperCase(),
                        }))
                        .filter((item) => item.code)
                        .map((item) => [item.code, item.status])
                    );
                    const scannedStatus = itemByCode.get(scannedPalletCode);
                    if (!scannedStatus) {
                      handleFlowError("Эта паллета не входит в выбранный маршрутный лист.");
                      return;
                    }
                    if (scannedStatus === "LOADED") {
                      handleFlowError("Эта паллета уже загружена по выбранному маршрутному листу.");
                      return;
                    }
                    if (scannedStatus !== "PLANNED") {
                      handleFlowError("Эта паллета недоступна для погрузки в текущем маршрутном листе.");
                      return;
                    }
                    setDispatchForm((prev) => ({ ...prev, palletCode: scannedPalletCode }));
                    await handleDispatchSubmit({
                      palletCodeOverride: scannedPalletCode,
                      locationCodeOverride: locationCode,
                    });
                  }}
                  disabled={loading}
                  autoStart
                  showManual={false}
                />
              </>
            ) : null}
          </div>
        ) : null}

        {activeTab === "search" ? (
          <div className="tsd-list">
            {searchView === "list" ? (
              <Scanner
                label="Скан паллеты"
                hint="Сканируйте паллету, чтобы открыть полную историю движения"
                manualPlaceholder="Введите код паллеты, например: PLT-..."
                onScan={async (value) => {
                  try {
                    clearAlerts();
                    const code = normalizePalletCode(value);
                    setSearchCode(code);
                    await loadHistoryByCode(code, { openDetail: true });
                  } catch (err) {
                    handleFlowError(err, "Не удалось найти паллету.");
                  }
                }}
                disabled={historyLoading}
              />
            ) : null}

            {searchView === "list" ? (
              <div className="tsd-inline tsd-inline--two">
                <input
                  className="tsd-input"
                  value={searchCode}
                  onChange={(event) => setSearchCode(event.target.value)}
                  placeholder="Введите код паллеты"
                  disabled={historyLoading}
                />
                <button
                  type="button"
                  className="tsd-btn tsd-btn--primary"
                  onClick={async () => {
                    try {
                      clearAlerts();
                      await loadHistoryByCode(searchCode, { openDetail: true });
                    } catch (err) {
                      handleFlowError(err, "Не удалось найти паллету.");
                    }
                  }}
                  disabled={historyLoading}
                >
                  {historyLoading ? "Ищем..." : "Найти"}
                </button>
              </div>
            ) : null}

            {searchView === "list" ? (
              <>
                <div className="tsd-inline tsd-inline--two">
                  <select
                    className="tsd-input"
                    value={searchStatus}
                    onChange={(event) => setSearchStatus(event.target.value)}
                  >
                    <option value="ACTIVE">Принято</option>
                    <option value="DISPATCHED">Отгружено</option>
                  </select>
                  <select
                    className="tsd-input"
                    value={searchSupplier}
                    onChange={(event) => setSearchSupplier(event.target.value)}
                    disabled={recentLoading || searchSuppliersLoading}
                  >
                    <option value="">Все поставщики</option>
                    {searchSuppliers.map((supplier) => (
                      <option key={supplier} value={supplier}>
                        {supplier}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="tsd-inline tsd-inline--two">
                  <input
                    className="tsd-input"
                    type="date"
                    value={searchDateFrom}
                    onChange={(event) => setSearchDateFrom(event.target.value)}
                    disabled={recentLoading}
                  />
                  <input
                    className="tsd-input"
                    type="date"
                    value={searchDateTo}
                    onChange={(event) => setSearchDateTo(event.target.value)}
                    disabled={recentLoading}
                  />
                </div>
                <div className="tsd-inline tsd-inline--two">
                  <button
                    type="button"
                    className="tsd-btn tsd-btn--secondary"
                    onClick={async () => {
                      await loadRecentPallets();
                      await loadSearchSuppliers();
                    }}
                    disabled={recentLoading || searchSuppliersLoading}
                  >
                    {recentLoading || searchSuppliersLoading ? "Обновляем..." : "Обновить"}
                  </button>
                  <button
                    type="button"
                    className="tsd-btn tsd-btn--ghost"
                    onClick={() => {
                      setSearchStatus("ACTIVE");
                      setSearchSupplier("");
                      setSearchDateFrom("");
                      setSearchDateTo("");
                      setSearchQuery("");
                    }}
                    disabled={recentLoading}
                  >
                    Сбросить фильтры
                  </button>
                </div>
              </>
            ) : null}

            {historyPallet && searchView === "detail" ? (
              <div className="tsd-card">
                <div className="tsd-inline tsd-inline--two">
                  <div className="tsd-card__title">Паллета {historyPallet.palletCode}</div>
                  <div className="tsd-inline tsd-inline--two">
                    <button
                      type="button"
                      className="tsd-btn tsd-btn--secondary tsd-btn--compact"
                      onClick={async () => {
                        await printPalletPassports([historyPallet.palletCode]);
                      }}
                      disabled={loading}
                    >
                      Печать паспорта
                    </button>
                  </div>
                </div>
                {!historyCollapsed ? (
                  <>
                    <div className="tsd-card__meta">Статус: {statusLabel(historyPallet.status)}</div>
                    <div className="tsd-card__meta">
                      Поставщик: {historyPallet.supplierName || "-"} • Машина/ТТН:{" "}
                      {historyPallet.inboundRef || "-"}
                    </div>
                    <div className="tsd-card__meta">
                      Текущая ячейка: {historyPallet.currentLocation?.code || "-"}
                    </div>
                    <div className="tsd-card__meta">
                      Принята: {formatDateTime(historyPallet.receivedAt)}
                    </div>
                    <div className="tsd-card__meta">
                      Принял: {historyPallet.createdBy?.name || historyPallet.createdBy?.email || "-"}
                    </div>
                    {historyPallet.storedAt ? (
                      <div className="tsd-card__meta">
                        Размещена: {formatDateTime(historyPallet.storedAt)}
                      </div>
                    ) : null}
                    {historyPallet.dispatch?.destinationRc ? (
                      <div className="tsd-card__meta">
                        РЦ назначения: {historyPallet.dispatch.destinationRc}
                      </div>
                    ) : null}
                    {historyPallet.dispatchedAt ? (
                      <div className="tsd-card__meta">
                        Отгружена: {formatDateTime(historyPallet.dispatchedAt)}
                      </div>
                    ) : null}
                  </>
                ) : null}
              </div>
            ) : null}

            {historyEvents.length && !historyCollapsed && searchView === "detail" ? (
              <div className="tsd-pallet-history">
                {historyEvents.map((event) => (
                  <div key={event.id} className="tsd-pallet-event">
                    <div className="tsd-pallet-event__head">
                      <span className="tsd-pallet-event__type">{eventTypeLabel(event.type)}</span>
                      <span className="tsd-pallet-event__date">{formatDateTime(event.createdAt)}</span>
                    </div>
                    <div className="tsd-pallet-event__meta">
                      {event.user?.name || event.user?.email || "Система"} • {statusLabel(event.fromStatus)} →{" "}
                      {statusLabel(event.toStatus)}
                    </div>
                    {renderMeta(event.metaJson) ? (
                      <div className="tsd-pallet-event__meta">{renderMeta(event.metaJson)}</div>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}

            {recentItems.length && searchView === "list" ? (
              <div className="tsd-list">
                {recentItems.slice(0, 40).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`tsd-card tsd-pallet-list-btn ${
                      item.status === "STORED" ? "tsd-pallet-list-btn--stored" : ""
                    } ${selectedPalletId === item.id ? "tsd-pallet-list-btn--selected" : ""}`}
                    onClick={async () => {
                      try {
                        clearAlerts();
                        setSelectedPalletId(item.id);
                        setHistoryCollapsed(false);
                        setSearchCode(item.palletCode || "");
                        await loadHistoryByCode(item.palletCode || "", { openDetail: true });
                      } catch (err) {
                        handleFlowError(err, "Не удалось открыть паллету.");
                      }
                    }}
                  >
                    <div className="tsd-card__title">{item.palletCode}</div>
                    <div className="tsd-card__meta">Статус: {statusLabel(item.status)}</div>
                    <div className="tsd-card__meta">
                      Локация: {item.currentLocation?.code || "-"}
                    </div>
                    <div className="tsd-card__meta">
                      Поставщик: {item.supplierName || "-"} • Машина/ТТН: {item.inboundRef || "-"}
                    </div>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {success ? (
        <div
          className="tsd-modal"
          role="dialog"
          aria-modal="true"
          onClick={(event) => {
            if (event.target === event.currentTarget) setSuccess("");
          }}
        >
          <div className="tsd-modal__card tsd-modal__card--success">
            <div className="tsd-modal__title">Успешно</div>
            <div className="tsd-modal__text">{success}</div>
            <div className="tsd-modal__actions">
              <button
                type="button"
                className="tsd-btn tsd-btn--primary"
                onClick={() => setSuccess("")}
              >
                Закрыть
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}


