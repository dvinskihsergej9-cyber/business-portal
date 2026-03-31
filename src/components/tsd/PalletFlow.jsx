import { useEffect, useMemo, useRef, useState } from "react";
import { API_BASE, normalizeErrorMessage } from "../../apiConfig";
import { openHtmlDocumentInNewTab, prepareDocumentTab } from "../../utils/openInNewTab";
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
  externalCode: "",
  createLabel: true,
};

const INITIAL_STORE_FORM = {
  palletCode: "",
  locationCode: "",
};

const INITIAL_DISPATCH_FORM = {
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
  const parts = Object.entries(metaJson)
    .filter(([, value]) => value != null && String(value).trim() !== "")
    .map(([key, value]) => `${key}: ${String(value)}`);
  return parts.join(" • ");
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
  if (normalized === "PALLET_DESTINATION_REQUIRED") return "Укажите РЦ назначения.";
  if (normalized === "PALLET_STORE_STATUS_INVALID")
    return "Размещение возможно только для принятых/размещенных паллет.";
  if (normalized === "PALLET_DISPATCH_STATUS_INVALID")
    return "Отгрузить можно только паллету в статусе «Размещена».";
  if (normalized === "PALLET_EXTERNAL_CODE_EXISTS")
    return "Паллета с таким внешним кодом уже существует.";
  if (normalized === "PALLET_STATE_CHANGED")
    return "Состояние паллеты изменилось другим сотрудником. Обновите данные.";
  if (normalized.startsWith("DATE_")) return "Проверьте корректность даты фильтра.";
  return fallback;
}

export default function PalletFlow({ authHeaders, onBack }) {
  const [activeTab, setActiveTab] = useState("receive");
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const receiveSubmitLockRef = useRef(false);
  const lastReceiveScanRef = useRef({ code: "", at: 0 });

  const [receiveForm, setReceiveForm] = useState(INITIAL_RECEIVE_FORM);
  const [storeForm, setStoreForm] = useState(INITIAL_STORE_FORM);
  const [dispatchForm, setDispatchForm] = useState(INITIAL_DISPATCH_FORM);

  const [searchCode, setSearchCode] = useState("");
  const [searchStatus, setSearchStatus] = useState("");
  const [historyPallet, setHistoryPallet] = useState(null);
  const [historyEvents, setHistoryEvents] = useState([]);
  const [recentItems, setRecentItems] = useState([]);
  const [recentLoading, setRecentLoading] = useState(false);

  const clearAlerts = () => {
    setError("");
    setSuccess("");
  };

  const printPalletLabel = async (palletCode) => {
    const printWindow = prepareDocumentTab({ title: "Этикетка паллеты" });
    if (!printWindow) {
      throw new Error(
        "Паллета создана, но окно печати не открылось. Разрешите всплывающие окна."
      );
    }

    const response = await fetch(`${API_BASE}/pallets/print-label`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        palletCode,
        qty: 1,
        layout: "LABEL_75X50",
      }),
    });
    const html = await response.text();
    if (!response.ok) {
      let message = "Паллета создана, но печать этикетки не выполнена.";
      try {
        const parsed = JSON.parse(html);
        message = mapPalletError(parsed?.message, message);
      } catch {
        // ignore raw html
      }
      try {
        if (!printWindow.closed) printWindow.close();
      } catch {
        // ignore
      }
      throw new Error(message);
    }
    openHtmlDocumentInNewTab(html, { targetWindow: printWindow });
  };

  const handleReceiveSubmit = async ({ externalCodeOverride = null } = {}) => {
    if (receiveSubmitLockRef.current) return;
    try {
      receiveSubmitLockRef.current = true;
      clearAlerts();
      setLoading(true);
      const normalizedExternalCode = normalizePalletCode(
        externalCodeOverride == null ? receiveForm.externalCode : externalCodeOverride
      );

      const payload = {
        supplierName: receiveForm.supplierName || null,
        inboundRef: receiveForm.inboundRef || null,
        externalCode: normalizedExternalCode || null,
        createLabel: Boolean(receiveForm.createLabel),
      };

      const response = await fetch(`${API_BASE}/pallets/receive`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify(payload),
      });
      const data = await readJsonSafe(response);
      if (!response.ok) {
        throw new Error(mapPalletError(data?.message, "Не удалось принять паллету."));
      }

      const nextPalletCode = data?.pallet?.palletCode || "";
      if (!nextPalletCode) {
        throw new Error("Паллета создана, но код не получен.");
      }

      if (payload.createLabel) {
        await printPalletLabel(nextPalletCode);
      }

      setSuccess(`Паллета ${nextPalletCode} принята.`);
      setReceiveForm((prev) => ({
        ...prev,
        externalCode: "",
      }));
      setSearchCode(nextPalletCode);
    } catch (err) {
      setError(normalizeErrorMessage(err, "Ошибка приемки паллеты."));
    } finally {
      receiveSubmitLockRef.current = false;
      setLoading(false);
    }
  };

  const handleStoreSubmit = async () => {
    try {
      clearAlerts();
      setLoading(true);
      const palletCode = normalizePalletCode(storeForm.palletCode);
      const locationCode = normalizeLocationCode(storeForm.locationCode);
      if (!palletCode) throw new Error("Отсканируйте паллету.");
      if (!locationCode) throw new Error("Отсканируйте зону размещения.");

      const response = await fetch(`${API_BASE}/pallets/store`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ palletCode, locationCode }),
      });
      const data = await readJsonSafe(response);
      if (!response.ok) {
        throw new Error(mapPalletError(data?.message, "Не удалось разместить паллету."));
      }

      setSuccess(`Паллета ${palletCode} размещена в ${data?.pallet?.currentLocation?.code || locationCode}.`);
      setStoreForm(INITIAL_STORE_FORM);
      setSearchCode(palletCode);
    } catch (err) {
      setError(normalizeErrorMessage(err, "Ошибка размещения паллеты."));
    } finally {
      setLoading(false);
    }
  };

  const handleDispatchSubmit = async () => {
    try {
      clearAlerts();
      setLoading(true);
      const palletCode = normalizePalletCode(dispatchForm.palletCode);
      if (!palletCode) throw new Error("Отсканируйте паллету.");
      if (!String(dispatchForm.destinationRc || "").trim()) {
        throw new Error("Укажите РЦ назначения.");
      }

      const response = await fetch(`${API_BASE}/pallets/dispatch`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          palletCode,
          destinationRc: dispatchForm.destinationRc,
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

      setSuccess(
        `Паллета ${palletCode} отгружена в РЦ ${data?.pallet?.dispatch?.destinationRc || dispatchForm.destinationRc}.`
      );
      setDispatchForm(INITIAL_DISPATCH_FORM);
      setSearchCode(palletCode);
    } catch (err) {
      setError(normalizeErrorMessage(err, "Ошибка отгрузки паллеты."));
    } finally {
      setLoading(false);
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
      const response = await fetch(`${API_BASE}/pallets?${params.toString()}`, {
        headers: authHeaders,
      });
      const data = await readJsonSafe(response);
      if (!response.ok) {
        throw new Error(mapPalletError(data?.message, "Не удалось загрузить список паллет."));
      }
      setRecentItems(Array.isArray(data?.items) ? data.items : []);
    } catch (err) {
      setError(normalizeErrorMessage(err, "Ошибка загрузки списка паллет."));
    } finally {
      setRecentLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab !== "search") return;
    loadRecentPallets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, searchStatus]);

  const tabs = useMemo(
    () => [
      { id: "receive", label: "Приемка" },
      { id: "store", label: "Размещение" },
      { id: "dispatch", label: "Отгрузка" },
      { id: "search", label: "Поиск" },
    ],
    []
  );

  return (
    <>
      <TsdHeader
        title="Паллеты"
        subtitle="Отдельный LPN-контур: приемка, размещение, отгрузка"
        onBack={onBack}
      />

      <div className="tsd-pallet-tabs">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`tsd-pallet-tab ${activeTab === tab.id ? "tsd-pallet-tab--active" : ""}`}
            onClick={() => {
              clearAlerts();
              setActiveTab(tab.id);
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="tsd-section">
        <TsdErrorAlert message={error} />
        {success ? <div className="tsd-alert tsd-alert--success">{success}</div> : null}

        {activeTab === "receive" ? (
          <div className="tsd-list">
            <Scanner
              label="Скан внешнего кода (необязательно)"
              hint="Если есть SSCC/штрихкод производителя"
              manualPlaceholder="SSCC или штрихкод"
              onScan={async (value) => {
                const scannedCode = normalizePalletCode(value);
                setReceiveForm((prev) => ({
                  ...prev,
                  externalCode: scannedCode,
                }));
                if (!scannedCode) return;

                const now = Date.now();
                if (
                  lastReceiveScanRef.current.code === scannedCode &&
                  now - lastReceiveScanRef.current.at < 3000
                ) {
                  return;
                }
                lastReceiveScanRef.current = { code: scannedCode, at: now };
                await handleReceiveSubmit({ externalCodeOverride: scannedCode });
              }}
              disabled={loading}
            />
            <div className="tsd-qty-input">
              <label className="tsd-scanner__label">Поставщик (необязательно)</label>
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
            <div className="tsd-qty-input">
              <label className="tsd-scanner__label">Машина / ТТН (необязательно)</label>
              <input
                className="tsd-input"
                value={receiveForm.inboundRef}
                onChange={(event) =>
                  setReceiveForm((prev) => ({ ...prev, inboundRef: event.target.value }))
                }
                placeholder="Например, А123ВС77 / ТТН-0001"
                disabled={loading}
              />
            </div>
            <div className="tsd-switch">
              <label className="tsd-switch__row">
                <input
                  type="checkbox"
                  checked={receiveForm.createLabel}
                  onChange={(event) =>
                    setReceiveForm((prev) => ({ ...prev, createLabel: event.target.checked }))
                  }
                  disabled={loading}
                />
                <span>Сразу печатать этикетку</span>
              </label>
            </div>
            <div className="tsd-action-bar">
              <button
                type="button"
                className="tsd-btn tsd-btn--primary"
                onClick={handleReceiveSubmit}
                disabled={loading}
              >
                {loading ? "Создаем..." : "Создать и напечатать"}
              </button>
            </div>
          </div>
        ) : null}

        {activeTab === "store" ? (
          <div className="tsd-list">
            <Scanner
              label="Скан паллеты"
              hint="Код формата bp:pallet:<код> или сам код"
              manualPlaceholder="bp:pallet:PLT-..."
              onScan={(value) =>
                setStoreForm((prev) => ({ ...prev, palletCode: normalizePalletCode(value) }))
              }
              disabled={loading}
            />
            <Scanner
              label="Скан паллетной зоны"
              hint="Например, YARD-A-03"
              manualPlaceholder="Код зоны"
              onScan={(value) =>
                setStoreForm((prev) => ({ ...prev, locationCode: normalizeLocationCode(value) }))
              }
              disabled={loading}
              scanKind="barcode"
            />
            <div className="tsd-action-bar">
              <button
                type="button"
                className="tsd-btn tsd-btn--primary"
                onClick={handleStoreSubmit}
                disabled={loading}
              >
                {loading ? "Сохраняем..." : "Разместить"}
              </button>
            </div>
          </div>
        ) : null}

        {activeTab === "dispatch" ? (
          <div className="tsd-list">
            <Scanner
              label="Скан паллеты"
              hint="Паллета должна быть в статусе «Размещена»"
              manualPlaceholder="bp:pallet:PLT-..."
              onScan={(value) =>
                setDispatchForm((prev) => ({ ...prev, palletCode: normalizePalletCode(value) }))
              }
              disabled={loading}
            />
            <div className="tsd-qty-input">
              <label className="tsd-scanner__label">РЦ назначения</label>
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
                    setDispatchForm((prev) => ({ ...prev, vehicle: event.target.value }))
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
                className="tsd-btn tsd-btn--primary"
                onClick={handleDispatchSubmit}
                disabled={loading}
              >
                {loading ? "Отгружаем..." : "Отгрузить"}
              </button>
            </div>
          </div>
        ) : null}

        {activeTab === "search" ? (
          <div className="tsd-list">
            <Scanner
              label="Скан паллеты"
              hint="Найти статус и историю по palletCode"
              manualPlaceholder="bp:pallet:PLT-..."
              onScan={async (value) => {
                try {
                  clearAlerts();
                  const code = normalizePalletCode(value);
                  setSearchCode(code);
                  await loadHistoryByCode(code);
                } catch (err) {
                  setError(normalizeErrorMessage(err, "Не удалось найти паллету."));
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
                    setError(normalizeErrorMessage(err, "Не удалось найти паллету."));
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

            {historyPallet ? (
              <div className="tsd-card">
                <div className="tsd-card__title">Паллета {historyPallet.palletCode}</div>
                <div className="tsd-card__meta">Статус: {statusLabel(historyPallet.status)}</div>
                <div className="tsd-card__meta">
                  Локация: {historyPallet.currentLocation?.code || "-"}
                </div>
                <div className="tsd-card__meta">
                  Принята: {formatDateTime(historyPallet.receivedAt)}
                </div>
                {historyPallet.dispatch?.destinationRc ? (
                  <div className="tsd-card__meta">
                    РЦ: {historyPallet.dispatch.destinationRc}
                  </div>
                ) : null}
              </div>
            ) : null}

            {historyEvents.length ? (
              <div className="tsd-pallet-history">
                {historyEvents.map((event) => (
                  <div key={event.id} className="tsd-pallet-event">
                    <div className="tsd-pallet-event__head">
                      <span className="tsd-pallet-event__type">{eventTypeLabel(event.type)}</span>
                      <span className="tsd-pallet-event__date">{formatDateTime(event.createdAt)}</span>
                    </div>
                    <div className="tsd-pallet-event__meta">
                      {event.user?.name || "Система"} • {statusLabel(event.fromStatus)} →{" "}
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
                {recentItems.slice(0, 20).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="tsd-card tsd-pallet-list-btn"
                    onClick={async () => {
                      try {
                        clearAlerts();
                        setSearchCode(item.palletCode || "");
                        await loadHistoryByCode(item.palletCode || "");
                      } catch (err) {
                        setError(normalizeErrorMessage(err, "Не удалось открыть паллету."));
                      }
                    }}
                  >
                    <div className="tsd-card__title">{item.palletCode}</div>
                    <div className="tsd-card__meta">Статус: {statusLabel(item.status)}</div>
                    <div className="tsd-card__meta">
                      Локация: {item.currentLocation?.code || "-"}
                    </div>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </>
  );
}
