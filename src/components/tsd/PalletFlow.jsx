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

function statusLabel(status) {
  return PALLET_STATUS_LABELS[String(status || "").trim()] || String(status || "-");
}

function eventTypeLabel(type) {
  return PALLET_EVENT_LABELS[String(type || "").trim()] || String(type || "-");
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
  const [searchStatus, setSearchStatus] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [historyPallet, setHistoryPallet] = useState(null);
  const [historyEvents, setHistoryEvents] = useState([]);
  const [historyCollapsed, setHistoryCollapsed] = useState(false);
  const [selectedPalletId, setSelectedPalletId] = useState(null);
  const [recentItems, setRecentItems] = useState([]);
  const [recentLoading, setRecentLoading] = useState(false);
  const [routeSheetItems, setRouteSheetItems] = useState([]);
  const [routeSheetSummary, setRouteSheetSummary] = useState(null);
  const [routeSheetLoading, setRouteSheetLoading] = useState(false);
  const [activeReceivePalletCodes, setActiveReceivePalletCodes] = useState([]);

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
    setRouteSheetItems([]);
    setRouteSheetSummary(null);
    setActiveReceivePalletCodes([]);
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
      if (!activeReceivePalletCodes.includes(palletCode)) {
        throw new Error(
          "Паллета не из текущей приемки. Используйте только паспорта, созданные в текущей приемке."
        );
      }
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
      const destinationRc = String(dispatchForm.destinationRc || "").trim();
      if (!destinationRc) {
        throw new Error("Укажите РЦ назначения.");
      }
      const dedupeKey = `${locationCode}|${palletCode}|${destinationRc}`;
      const now = Date.now();
      if (
        lastDispatchSubmitRef.current.key === dedupeKey &&
        now - lastDispatchSubmitRef.current.at < 2000
      ) {
        return;
      }
      lastDispatchSubmitRef.current = { key: dedupeKey, at: now };

      const response = await fetch(`${API_BASE}/pallets/dispatch`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          locationCode,
          palletCode,
          destinationRc,
          route: dispatchForm.route || null,
          vehicle: dispatchForm.vehicle || null,
          driver: dispatchForm.driver || null,
          notes: dispatchForm.notes || null,
        }),
      });
      const data = await readJsonSafe(response);
      if (!response.ok) {
        throw new Error(mapPalletError(data?.message, "Не удалось отгрузить паллету."));
      }

      setSuccess("Успешно");
      setDispatchStep("location");
      setDispatchForm((prev) => ({
        ...prev,
        palletCode: "",
        locationCode: "",
      }));
      await loadDispatchSheet({ silent: true, locationCodeOverride: "" });
      setSearchCode(palletCode);
    } catch (err) {
      handleFlowError(err, "Ошибка отгрузки паллеты.");
    } finally {
      dispatchSubmitLockRef.current = false;
      setLoading(false);
    }
  };

  const loadDispatchSheet = async ({ silent = false, locationCodeOverride = null } = {}) => {
    const destinationRc = String(dispatchForm.destinationRc || "").trim();
    if (!destinationRc) {
      if (!silent) {
        throw new Error("Укажите РЦ назначения, чтобы получить маршрутный лист.");
      }
      return;
    }
    setRouteSheetLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("destinationRc", destinationRc);
      if (dispatchForm.route) params.set("route", String(dispatchForm.route).trim());
      const locationCode =
        locationCodeOverride == null ? dispatchForm.locationCode : locationCodeOverride;
      if (locationCode) {
        params.set("locationCode", normalizeLocationCode(locationCode));
      }
      const response = await fetch(`${API_BASE}/pallets/dispatch-sheet?${params.toString()}`, {
        headers: authHeaders,
      });
      const data = await readJsonSafe(response);
      if (!response.ok) {
        throw new Error(mapPalletError(data?.message, "Не удалось загрузить маршрутный лист."));
      }
      const items = Array.isArray(data?.items) ? data.items : [];
      setRouteSheetItems(items);
      setRouteSheetSummary(data?.summary || { total: items.length, byLocation: [] });
      if (!silent && !items.length) {
        setSuccess("Маршрутный лист пуст.");
      }
    } finally {
      setRouteSheetLoading(false);
    }
  };

  const loadHistoryByCode = async (rawCode) => {
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
      return data?.pallet || null;
    } finally {
      setHistoryLoading(false);
    }
  };

  const loadRecentPallets = async () => {
    setRecentLoading(true);
    try {
      const params = new URLSearchParams();
      if (searchStatus) params.set("status", searchStatus);
      if (searchQuery) params.set("q", searchQuery.trim());
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

  useEffect(() => {
    if (activeTab !== "search") return;
    loadRecentPallets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, searchStatus, searchQuery]);

  useEffect(() => {
    if (activeTab !== "dispatch") return;
    if (String(dispatchForm.destinationRc || "").trim()) return;
    setRouteSheetItems([]);
    setRouteSheetSummary(null);
  }, [activeTab, dispatchForm.destinationRc]);

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
      { id: "dispatch", label: "Отгрузка" },
      { id: "search", label: "Поиск" },
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
      setActiveTab("receive");
      return;
    }

    if (activeTab === "search") {
      setActiveTab("receive");
      return;
    }

    if (typeof onBack === "function") {
      onBack();
    }
  }, [activeTab, dispatchStep, onBack, receiveStep, storeStep]);

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
      <TsdHeader
        title="Кросс-докинг"
        subtitle="Паллетный контур: приемка, размещение, отгрузка"
        onBack={handleHeaderBack}
        showBackButton={showInternalBack}
      />

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
                  if (!activeReceivePalletCodes.includes(scannedPalletCode)) {
                    handleFlowError(
                      "Эта паллета не относится к текущей приемке. Отсканируйте паллету из текущих паспортов."
                    );
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

        {activeTab === "dispatch" ? (
          <div className="tsd-list">
            <div className="tsd-card">
              <div className="tsd-card__title">Пошаговая отгрузка</div>
              <div className="tsd-card__meta">
                {dispatchStep === "setup"
                  ? "Шаг 1 из 3: задайте параметры маршрутного листа."
                  : dispatchStep === "location"
                    ? "Шаг 2 из 3: отсканируйте ячейку отбора."
                    : "Шаг 3 из 3: отсканируйте паллету для подтверждения отгрузки."}
              </div>
              <div className="tsd-card__meta">
                РЦ: {dispatchForm.destinationRc || "-"} • Ячейка: {dispatchForm.locationCode || "-"} •
                Паллета: {dispatchForm.palletCode || "-"}
              </div>
            </div>
            {dispatchStep === "setup" ? (
              <>
                <div className="tsd-info">
                  <div className="tsd-info__title">Планирование листа</div>
                  <div className="tsd-info__text">
                    Сначала задайте РЦ и маршрут, загрузите маршрутный лист, затем переходите в скан-режим.
                  </div>
                </div>
                <div className="tsd-qty-input">
                  <label className="tsd-scanner__label">РЦ назначения *</label>
                  <input
                    className="tsd-input"
                    value={dispatchForm.destinationRc}
                    onChange={(event) =>
                      setDispatchForm((prev) => ({ ...prev, destinationRc: event.target.value }))
                    }
                    placeholder="Например, РЦ-ЮГ-02"
                    disabled={loading}
                  />
                </div>
                <div className="tsd-inline tsd-inline--two">
                  <div>
                    <label className="tsd-scanner__label">Маршрут</label>
                    <input
                      className="tsd-input"
                      value={dispatchForm.route}
                      onChange={(event) =>
                        setDispatchForm((prev) => ({ ...prev, route: event.target.value }))
                      }
                      placeholder="Маршрут"
                      disabled={loading}
                    />
                  </div>
                  <div>
                    <label className="tsd-scanner__label">Машина</label>
                    <input
                      className="tsd-input"
                      value={dispatchForm.vehicle}
                      onChange={(event) =>
                        setDispatchForm((prev) => ({
                          ...prev,
                          vehicle: String(event.target.value || "").toUpperCase(),
                        }))
                      }
                      placeholder="Гос. номер"
                      disabled={loading}
                    />
                  </div>
                </div>
                <div className="tsd-qty-input">
                  <label className="tsd-scanner__label">Водитель (необязательно)</label>
                  <input
                    className="tsd-input"
                    value={dispatchForm.driver}
                    onChange={(event) =>
                      setDispatchForm((prev) => ({ ...prev, driver: event.target.value }))
                    }
                    placeholder="ФИО водителя"
                    disabled={loading}
                  />
                </div>
                <div className="tsd-qty-input">
                  <label className="tsd-scanner__label">Комментарий (необязательно)</label>
                  <textarea
                    className="tsd-input"
                    rows={3}
                    value={dispatchForm.notes}
                    onChange={(event) =>
                      setDispatchForm((prev) => ({ ...prev, notes: event.target.value }))
                    }
                    placeholder="Комментарий к отгрузке"
                    disabled={loading}
                  />
                </div>
                <div className="tsd-action-bar">
                  <button
                    type="button"
                    className="tsd-btn tsd-btn--secondary"
                    onClick={async () => {
                      try {
                        clearAlerts();
                        await loadDispatchSheet();
                      } catch (err) {
                        handleFlowError(err, "Не удалось загрузить маршрутный лист.");
                      }
                    }}
                    disabled={loading || routeSheetLoading}
                  >
                    {routeSheetLoading ? "Загружаем лист..." : "Показать маршрутный лист"}
                  </button>
                  <button
                    type="button"
                    className="tsd-btn tsd-btn--primary"
                    onClick={async () => {
                      try {
                        clearAlerts();
                        if (!String(dispatchForm.destinationRc || "").trim()) {
                          throw new Error("Укажите РЦ назначения.");
                        }
                        await loadDispatchSheet({ silent: true });
                        setDispatchStep("location");
                      } catch (err) {
                        handleFlowError(err, "Не удалось начать отгрузку.");
                      }
                    }}
                    disabled={loading || routeSheetLoading}
                  >
                    Начать отгрузку
                  </button>
                </div>
                {routeSheetSummary ? (
                  <div className="tsd-card">
                    <div className="tsd-card__title">
                      Маршрутный лист: {dispatchForm.route ? dispatchForm.route : "без номера"}
                    </div>
                    <div className="tsd-card__meta">РЦ назначения: {dispatchForm.destinationRc || "-"}</div>
                    <div className="tsd-card__meta">Паллет к отбору: {routeSheetSummary.total || 0}</div>
                  </div>
                ) : null}
                {routeSheetItems.length ? (
                  <div className="tsd-list">
                    {routeSheetItems.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        className={`tsd-card tsd-pallet-list-btn ${
                          dispatchForm.palletCode === item.palletCode ? "tsd-route-sheet-item--active" : ""
                        }`}
                        onClick={() => {
                          setDispatchForm((prev) => ({
                            ...prev,
                            palletCode: item.palletCode || "",
                            locationCode: item.currentLocation?.code || "",
                          }));
                          setDispatchStep("location");
                        }}
                      >
                        <div className="tsd-card__title">{item.palletCode}</div>
                        <div className="tsd-card__meta">Ячейка: {item.currentLocation?.code || "-"}</div>
                        <div className="tsd-card__meta">Куда везти: {dispatchForm.destinationRc || "-"}</div>
                        <div className="tsd-card__meta">
                          Поставщик: {item.supplierName || "-"} • Машина/ТТН: {item.inboundRef || "-"}
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
                    Изменить параметры
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
                    const destinationRc = String(dispatchForm.destinationRc || "").trim();
                    if (!destinationRc) {
                      handleFlowError("Сначала укажите РЦ назначения.");
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
            <Scanner
              label="Скан паллеты"
              hint="Сканируйте паллету, чтобы открыть полную историю движения"
              manualPlaceholder="bp:pallet:PLT-..."
              onScan={async (value) => {
                try {
                  clearAlerts();
                  const code = normalizePalletCode(value);
                  setSearchCode(code);
                  await loadHistoryByCode(code);
                } catch (err) {
                  handleFlowError(err, "Не удалось найти паллету.");
                }
              }}
              disabled={historyLoading}
            />

            <div className="tsd-inline tsd-inline--two">
              <input
                className="tsd-input"
                value={searchCode}
                onChange={(event) => setSearchCode(event.target.value)}
                placeholder="Введите palletCode"
                disabled={historyLoading}
              />
              <button
                type="button"
                className="tsd-btn tsd-btn--primary"
                onClick={async () => {
                  try {
                    clearAlerts();
                    await loadHistoryByCode(searchCode);
                  } catch (err) {
                    handleFlowError(err, "Не удалось найти паллету.");
                  }
                }}
                disabled={historyLoading}
              >
                {historyLoading ? "Ищем..." : "Найти"}
              </button>
            </div>

            <div className="tsd-inline tsd-inline--two">
              <select
                className="tsd-input"
                value={searchStatus}
                onChange={(event) => setSearchStatus(event.target.value)}
              >
                <option value="">Все статусы</option>
                <option value="RECEIVED">Принята</option>
                <option value="STORED">Размещена</option>
                <option value="DISPATCHED">Отгружена</option>
                <option value="CANCELLED">Отменена</option>
              </select>
              <button
                type="button"
                className="tsd-btn tsd-btn--secondary"
                onClick={loadRecentPallets}
                disabled={recentLoading}
              >
                {recentLoading ? "Обновляем..." : "Обновить"}
              </button>
            </div>
            <div className="tsd-inline tsd-inline--two">
              <input
                className="tsd-input"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Фильтр: код, поставщик, ТТН"
                disabled={recentLoading}
              />
              <div className="tsd-card__meta">Найдено: {recentItems.length}</div>
            </div>
            <div className="tsd-card">
              <div className="tsd-card__meta">
                Фильтр статуса: {searchStatus ? statusLabel(searchStatus) : "все статусы"}
              </div>
              <div className="tsd-card__meta">
                Выберите паллету из списка или отсканируйте код, чтобы открыть карточку.
              </div>
            </div>

            {historyPallet ? (
              <div className="tsd-card">
                <div className="tsd-inline tsd-inline--two">
                  <div className="tsd-card__title">Паллета {historyPallet.palletCode}</div>
                  <button
                    type="button"
                    className="tsd-btn tsd-btn--ghost"
                    onClick={() => setHistoryCollapsed((prev) => !prev)}
                  >
                    {historyCollapsed ? "Развернуть" : "Свернуть"}
                  </button>
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

            {historyEvents.length && !historyCollapsed ? (
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

            {recentItems.length ? (
              <div className="tsd-list">
                {recentItems.slice(0, 40).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`tsd-card tsd-pallet-list-btn ${
                      selectedPalletId === item.id ? "tsd-pallet-list-btn--selected" : ""
                    }`}
                    onClick={async () => {
                      try {
                        clearAlerts();
                        setSelectedPalletId(item.id);
                        setHistoryCollapsed(false);
                        setSearchCode(item.palletCode || "");
                        await loadHistoryByCode(item.palletCode || "");
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


