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
  receiveGate: "",
  qty: "1",
};

const INITIAL_STORE_FORM = {
  palletCode: "",
  locationCode: "",
};

const INITIAL_DISPATCH_FORM = {
  dispatchGate: "",
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
  vehicle: "",
  driver: "",
  plannedDate: "",
  notes: "",
};

const CROSSDOCK_TAB_IDS = new Set([
  "receive",
  "store",
  "planning",
  "dispatch",
  "locationControl",
  "discrepancies",
  "search",
]);

function statusLabel(status) {
  const normalized = String(status || "").trim().toUpperCase();
  if (!normalized) return "-";
  return PALLET_STATUS_LABELS[normalized] || "Неизвестный статус";
}

function eventTypeLabel(type) {
  const normalized = String(type || "").trim().toUpperCase();
  if (!normalized) return "-";
  return PALLET_EVENT_LABELS[normalized] || "Событие";
}

function routeSheetStatusLabel(status) {
  const normalized = String(status || "").trim().toUpperCase();
  if (!normalized) return "-";
  return ROUTE_SHEET_STATUS_LABELS[normalized] || "Неизвестный статус";
}

function routeSheetItemStatusLabel(status) {
  const normalized = String(status || "").trim().toUpperCase();
  if (!normalized) return "-";
  return ROUTE_SHEET_ITEM_STATUS_LABELS[normalized] || "Неизвестный статус";
}

function formatDateTime(value) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleString("ru-RU");
}

function formatDateOnly(value) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleDateString("ru-RU");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizePalletCode(rawValue) {
  const raw = String(rawValue || "").trim();
  if (!raw) return "";
  const withPrefix = raw.match(/^bp:pallet:(.+)$/i);
  const payload = withPrefix ? withPrefix[1] : raw;
  return payload.trim().toUpperCase().replace(/\s+/g, "");
}

function normalizeLocationCode(rawValue) {
  const normalized = String(rawValue || "").trim().toUpperCase().replace(/\s+/g, "");
  if (!normalized) return "";
  const map = {
    А: "A",
    В: "B",
    Е: "E",
    К: "K",
    М: "M",
    Н: "H",
    О: "O",
    Р: "P",
    С: "C",
    Т: "T",
    У: "Y",
    Х: "X",
  };
  return normalized
    .split("")
    .map((char) => map[char] || char)
    .join("");
}

function toCyrillicLocationAlias(rawValue) {
  const normalized = String(rawValue || "").trim().toUpperCase().replace(/\s+/g, "");
  if (!normalized) return "";
  const map = {
    A: "А",
    B: "В",
    C: "С",
    E: "Е",
    H: "Н",
    K: "К",
    M: "М",
    O: "О",
    P: "Р",
    T: "Т",
    X: "Х",
    Y: "У",
  };
  return normalized
    .split("")
    .map((char) => map[char] || char)
    .join("");
}

function buildLocationCodeCandidates(rawValue) {
  const source = String(rawValue || "").trim().toUpperCase().replace(/\s+/g, "");
  const latin = normalizeLocationCode(source);
  const cyrillic = toCyrillicLocationAlias(latin || source);
  return Array.from(new Set([latin, cyrillic, source].filter(Boolean)));
}

function locationDisplayName(location) {
  const name = String(location?.name || "").trim();
  const code = String(location?.code || "").trim();
  if (name && name !== code) return name;
  return name || code || "-";
}

function discrepancyStatusLabel(status, writeoffStatus = "") {
  const normalizedWriteoff = String(writeoffStatus || "").trim().toUpperCase();
  if (normalizedWriteoff === "APPROVED") return "Списана с баланса";
  const normalized = String(status || "").trim().toUpperCase();
  if (normalized === "OPEN") return "Не найдена";
  if (normalized === "CLOSED") return "Найдена";
  return "Неизвестно";
}

function discrepancyWriteoffStatusLabel(status) {
  const normalized = String(status || "").trim().toUpperCase();
  if (normalized === "PENDING") return "Ожидает решения админа/владельца";
  if (normalized === "APPROVED") return "Списана с баланса";
  if (normalized === "REJECTED") return "Списание отклонено";
  if (normalized === "CANCELLED") return "Отменено: паллета найдена";
  return "";
}

function isArchivedDiscrepancyItem(item) {
  const writeoffStatus = String(item?.writeoffRequest?.status || "").trim().toUpperCase();
  return writeoffStatus === "APPROVED";
}

function isOpenDiscrepancyItem(item) {
  const status = String(item?.status || "").trim().toUpperCase();
  return status === "OPEN";
}

function buildRouteSheetPrintHtml(routeSheet) {
  const sheetNumber = String(routeSheet?.sheetNumber || "").trim() || `МЛ-${routeSheet?.id || "-"}`;
  const printedAt = new Date().toLocaleString("ru-RU");
  const plannedDate = formatDateOnly(routeSheet?.plannedDate);
  const items = Array.isArray(routeSheet?.items) ? routeSheet.items : [];

  const rows = items
    .map((item, index) => {
      const palletCode = String(item?.pallet?.palletCode || "").trim() || "-";
      const location = locationDisplayName(item?.pallet?.currentLocation);
      const supplierName = String(item?.pallet?.supplierName || "").trim() || "-";
      const inboundRef = String(item?.pallet?.inboundRef || "").trim() || "-";
      const status = routeSheetItemStatusLabel(item?.status);
      return `
        <tr>
          <td>${index + 1}</td>
          <td>${escapeHtml(palletCode)}</td>
          <td>${escapeHtml(location)}</td>
          <td>${escapeHtml(supplierName)}</td>
          <td>${escapeHtml(inboundRef)}</td>
          <td>${escapeHtml(status)}</td>
        </tr>
      `;
    })
    .join("");

  return `
    <html>
      <head>
        <meta charset="utf-8" />
        <title>Маршрутный лист ${escapeHtml(sheetNumber)}</title>
        <style>
          body {
            margin: 18px;
            font-family: "Segoe UI", Arial, sans-serif;
            color: #0f172a;
          }
          h1 {
            margin: 0 0 8px;
            font-size: 26px;
          }
          .meta {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 8px 16px;
            margin: 12px 0 16px;
            font-size: 14px;
          }
          .meta-item {
            border: 1px solid #cbd5e1;
            border-radius: 10px;
            padding: 8px 10px;
            background: #f8fafc;
          }
          .meta-item b {
            color: #1e293b;
          }
          table {
            width: 100%;
            border-collapse: collapse;
          }
          th, td {
            border: 1px solid #cbd5e1;
            padding: 8px 10px;
            font-size: 13px;
            text-align: left;
            vertical-align: top;
          }
          th {
            background: #e2e8f0;
            font-weight: 700;
          }
          .print-actions {
            position: sticky;
            bottom: 0;
            margin-top: 16px;
            display: flex;
            gap: 10px;
            justify-content: flex-end;
            padding-top: 10px;
            background: #fff;
          }
          .print-btn {
            border: 1px solid #94a3b8;
            border-radius: 10px;
            background: #f8fafc;
            padding: 8px 12px;
            cursor: pointer;
            font-weight: 600;
          }
          .print-btn-primary {
            background: #0284c7;
            border-color: #0284c7;
            color: #fff;
          }
          @media print {
            .print-actions { display: none; }
            body { margin: 8mm; }
          }
        </style>
      </head>
      <body>
        <h1>Маршрутный лист ${escapeHtml(sheetNumber)}</h1>
        <div style="font-size:12px;color:#475569;">Отпечатан: ${escapeHtml(printedAt)}</div>
        <div class="meta">
          <div class="meta-item"><b>Клиент:</b> ${escapeHtml(routeSheet?.clientName || "-")}</div>
          <div class="meta-item"><b>РЦ:</b> ${escapeHtml(routeSheet?.destinationRc || "-")}</div>
          <div class="meta-item"><b>Дата рейса:</b> ${escapeHtml(plannedDate)}</div>
          <div class="meta-item"><b>Машина:</b> ${escapeHtml(routeSheet?.vehicle || "-")}</div>
          <div class="meta-item"><b>Водитель:</b> ${escapeHtml(routeSheet?.driver || "-")}</div>
          <div class="meta-item"><b>Статус:</b> ${escapeHtml(routeSheetStatusLabel(routeSheet?.status))}</div>
          <div class="meta-item"><b>Паллет в плане:</b> ${Number(routeSheet?.summary?.planned || 0)}</div>
        </div>
        <table>
          <thead>
            <tr>
              <th>№</th>
              <th>Паллета</th>
              <th>Ячейка</th>
              <th>Поставщик</th>
              <th>Машина/ТТН</th>
              <th>Статус</th>
            </tr>
          </thead>
          <tbody>
            ${
              rows ||
              '<tr><td colspan="6" style="text-align:center;color:#64748b;">В маршрутном листе пока нет паллет.</td></tr>'
            }
          </tbody>
        </table>
        <div class="print-actions">
          <button class="print-btn print-btn-primary" onclick="window.print()">Печать</button>
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
            window.location.href = "/warehouse?section=crossdock&crossdockTab=planning";
          }
          window.setTimeout(function() { window.print(); }, 180);
        </script>
      </body>
    </html>
  `;
}

const META_FIELD_DEFINITIONS = [
  { canonical: "supplierName", label: "Поставщик", keys: ["supplierName"] },
  { canonical: "inboundRef", label: "Машина/ТТН", keys: ["inboundRef"] },
  { canonical: "receiveGate", label: "Ворота приемки", keys: ["receiveGate", "receive_gate"] },
  { canonical: "dispatchGate", label: "Ворота отгрузки", keys: ["dispatchGate", "dispatch_gate"] },
  { canonical: "gate", label: "Ворота", keys: ["gate"] },
  {
    canonical: "fromLocationCode",
    label: "Из ячейки",
    keys: ["fromLocationCode", "from_location_code"],
  },
  { canonical: "toLocationCode", label: "В ячейку", keys: ["toLocationCode", "to_location_code"] },
  { canonical: "toLocationName", label: "Ячейка", keys: ["toLocationName", "to_location_name"] },
  { canonical: "locationCode", label: "Ячейка", keys: ["locationCode", "location_code"] },
  {
    canonical: "scanLocationCode",
    label: "Скан ячейки",
    keys: ["scanLocationCode", "scan_location_code"],
  },
  { canonical: "destinationRc", label: "РЦ назначения", keys: ["destinationRc", "destination_rc"] },
  { canonical: "route", label: "Маршрут", keys: ["route"] },
  { canonical: "vehicle", label: "Машина", keys: ["vehicle"] },
  { canonical: "driver", label: "Водитель", keys: ["driver"] },
  { canonical: "notes", label: "Комментарий", keys: ["notes"] },
  {
    canonical: "routeSheetId",
    label: "ID маршрутного листа",
    keys: ["routeSheetId", "route_sheet_id"],
  },
  {
    canonical: "routeSheetNumber",
    label: "Номер маршрутного листа",
    keys: ["routeSheetNumber", "route_sheet_number", "sheetNumber", "sheet_number"],
  },
  {
    canonical: "plannedCount",
    label: "Паллет в плане",
    keys: ["plannedCount", "planned_count"],
  },
];

function normalizeMetaValue(value) {
  if (value == null) return "";
  if (typeof value === "boolean") return value ? "Да" : "Нет";
  const text = String(value).trim();
  return text;
}

function renderMeta(metaJson) {
  if (!metaJson || typeof metaJson !== "object") return "";
  const valueByCanonical = new Map();
  for (const field of META_FIELD_DEFINITIONS) {
    for (const key of field.keys) {
      const normalizedValue = normalizeMetaValue(metaJson?.[key]);
      if (!normalizedValue) continue;
      valueByCanonical.set(field.canonical, normalizedValue);
      break;
    }
  }
  const plainGate = valueByCanonical.get("gate");
  const receiveGate = valueByCanonical.get("receiveGate");
  const dispatchGate = valueByCanonical.get("dispatchGate");
  if (plainGate && (plainGate === receiveGate || plainGate === dispatchGate)) {
    valueByCanonical.delete("gate");
  }

  const parts = META_FIELD_DEFINITIONS.flatMap((field) => {
    const value = valueByCanonical.get(field.canonical);
    if (!value) return [];
    return [`${field.label}: ${value}`];
  });
  return parts.join(" | ");
}

function extractGateFromMeta(metaJson) {
  if (!metaJson || typeof metaJson !== "object") return "";
  const keys = ["receiveGate", "dispatchGate", "gate", "receive_gate", "dispatch_gate"];
  for (const key of keys) {
    const value = metaJson?.[key];
    if (value == null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return "";
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

function normalizePalletStatusValue(value) {
  return String(value || "").trim().toUpperCase();
}

function applySearchStatusPreset(items, statusPreset) {
  const source = Array.isArray(items) ? items : [];
  const preset = String(statusPreset || "").trim().toUpperCase();
  if (preset === "ACTIVE") {
    return source.filter((item) => {
      const status = normalizePalletStatusValue(item?.status);
      return status === "RECEIVED" || status === "STORED";
    });
  }
  if (preset === "DISPATCHED") {
    return source.filter((item) => normalizePalletStatusValue(item?.status) === "DISPATCHED");
  }
  if (preset === "ARCHIVE") {
    return source.filter((item) => normalizePalletStatusValue(item?.status) === "CANCELLED");
  }
  return source;
}

function mapPalletError(code, fallback = "Не удалось выполнить операцию.") {
  const normalized = String(code || "").trim().toUpperCase();
  if (normalized === "PALLET_NOT_FOUND") return "Паллета не найдена.";
  if (normalized === "PALLET_CODE_REQUIRED") return "Сканируйте или введите код паллеты.";
  if (normalized === "PALLET_LOCATION_REQUIRED") return "Сканируйте или введите код ячейки.";
  if (normalized === "PALLET_LOCATION_NOT_FOUND") return "Ячейка не найдена.";
  if (normalized === "PALLET_SUPPLIER_REQUIRED") return "Укажите поставщика.";
  if (normalized === "PALLET_INBOUND_REF_REQUIRED") return "Укажите машину/ТТН.";
  if (normalized === "PALLET_DESTINATION_REQUIRED") return "Укажите РЦ назначения.";
  if (normalized === "PALLET_GATE_REQUIRED") return "Введите номер ворот.";
  if (normalized === "PALLET_STORE_STATUS_INVALID")
    return "Размещение возможно только для принятых/размещенных паллет.";
  if (normalized === "PALLET_STORE_RECEIVE_EXPIRED")
    return "Размещение разрешено только для паллет текущей приемки (до 24 часов).";
  if (normalized === "PALLET_ALREADY_STORED")
    return "Паллета уже размещена. Повторное размещение через этот шаг недоступно.";
  if (normalized === "PALLET_DISPATCH_STATUS_INVALID")
    return "Отгрузить можно только паллету в статусе «Размещена».";
  if (normalized === "PALLET_ARCHIVE_STATUS_INVALID")
    return "Нельзя отправить в архив паллету в статусе «Отгружена».";
  if (normalized === "PALLET_ARCHIVE_OWNER_ONLY")
    return "Отправить паллету в архив может только админ или владелец бизнеса.";
  if (normalized === "PALLET_ARCHIVE_ERROR")
    return "Не удалось отправить паллету в архив.";
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
  if (normalized === "ROUTE_SHEET_NEXT_NUMBER_ERROR")
    return "Не удалось получить следующий номер маршрутного листа.";
  if (normalized === "ROUTE_SHEET_DISPATCH_ERROR")
    return "Не удалось выполнить отгрузку по маршрутному листу.";
  if (normalized === "PALLET_LOCATION_CONTROL_EXPECTED_ERROR")
    return "Не удалось загрузить ожидаемые паллеты по ячейке.";
  if (normalized === "PALLET_LOCATION_CONTROL_RECONCILE_ERROR")
    return "Не удалось зафиксировать результат контроля ячейки.";
  if (normalized === "PALLET_DISCREPANCIES_LIST_ERROR")
    return "Не удалось загрузить список расхождений.";
  if (normalized === "PALLET_ID_REQUIRED") return "Не передана паллета для операции.";
  if (normalized === "PALLET_DISCREPANCY_NOT_FOUND")
    return "Открытое расхождение по паллете не найдено.";
  if (normalized === "PALLET_DISCREPANCY_MARK_FOUND_ERROR")
    return "Не удалось закрыть расхождение как найденное.";
  if (normalized === "PALLET_DISCREPANCY_WRITEOFF_ALREADY_PENDING")
    return "Запрос на списание уже отправлен владельцу.";
  if (normalized === "PALLET_DISCREPANCY_WRITEOFF_REQUEST_ERROR")
    return "Не удалось отправить запрос на списание.";
  if (normalized === "PALLET_DISCREPANCY_WRITEOFF_OWNER_ONLY")
    return "Подтвердить или отклонить списание может только админ или владелец бизнеса.";
  if (normalized === "PALLET_DISCREPANCY_WRITEOFF_NOT_PENDING")
    return "Запрос на списание уже обработан или не создан.";
  if (normalized === "PALLET_DISCREPANCY_WRITEOFF_DECISION_INVALID")
    return "Некорректное решение по списанию.";
  if (normalized === "PALLET_DISCREPANCY_WRITEOFF_DECISION_ERROR")
    return "Не удалось обработать решение владельца.";
  if (normalized.startsWith("DATE_")) return "Проверьте корректность даты фильтра.";
  return fallback;
}

export default function PalletFlow({
  authHeaders,
  onBack,
  showInternalBack = true,
  initialTab = "",
  onTabChange,
}) {
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
  const lastAppliedInitialTabRef = useRef("");

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
  const [searchLocationCode, setSearchLocationCode] = useState("");
  const [searchLocationItems, setSearchLocationItems] = useState([]);
  const [searchLocationLoading, setSearchLocationLoading] = useState(false);
  const [searchLocationName, setSearchLocationName] = useState("");
  const [locationControlStep, setLocationControlStep] = useState("scan");
  const [locationControlFoundCodes, setLocationControlFoundCodes] = useState([]);
  const [locationControlSubmitting, setLocationControlSubmitting] = useState(false);
  const [locationControlResult, setLocationControlResult] = useState(null);
  const [discrepanciesItems, setDiscrepanciesItems] = useState([]);
  const [discrepanciesLoading, setDiscrepanciesLoading] = useState(false);
  const [discrepancyTrackingEnabled, setDiscrepancyTrackingEnabled] = useState(true);
  const [discrepancyPermissions, setDiscrepancyPermissions] = useState({
    canApproveWriteoff: false,
  });
  const [discrepancyActionKey, setDiscrepancyActionKey] = useState("");
  const [discrepancyView, setDiscrepancyView] = useState("active");
  const [foundDiscrepancyDraft, setFoundDiscrepancyDraft] = useState({
    palletId: null,
    palletCode: "",
    locationCode: "",
  });
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
  const [planningNextNumber, setPlanningNextNumber] = useState("");
  const [planningNextNumberLoading, setPlanningNextNumberLoading] = useState(false);
  const [dispatchSheets, setDispatchSheets] = useState([]);
  const [dispatchSheetsLoading, setDispatchSheetsLoading] = useState(false);
  const [dispatchRouteSheetId, setDispatchRouteSheetId] = useState(null);
  const [routeSheetItems, setRouteSheetItems] = useState([]);
  const [routeSheetSummary, setRouteSheetSummary] = useState(null);
  const [routeSheetLoading, setRouteSheetLoading] = useState(false);
  const [warehouseLocations, setWarehouseLocations] = useState([]);
  const [warehouseLocationsLoading, setWarehouseLocationsLoading] = useState(false);
  const [activeReceivePalletCodes, setActiveReceivePalletCodes] = useState([]);
  const [storeReceiveScopeLocked, setStoreReceiveScopeLocked] = useState(false);
  const locationControlLastSyncedKeyRef = useRef("");
  const strictStepLock = activeTab === "dispatch" && dispatchStep !== "setup";

  const clearAlerts = () => {
    setError("");
    setSuccess("");
  };

  const buildLocationControlSyncKey = (rawLocationCode, foundCodes) => {
    const locationCode = normalizeLocationCode(rawLocationCode);
    const codes = Array.from(
      new Set((Array.isArray(foundCodes) ? foundCodes : []).map((code) => normalizePalletCode(code)).filter(Boolean))
    ).sort();
    return `${locationCode}|${codes.join(",")}`;
  };

  const locationControlSuccessMessage = (result) => {
    const missingCount = Array.isArray(result?.missingPalletCodes) ? result.missingPalletCodes.length : 0;
    if (missingCount > 0) {
      if (result?.discrepancyEnabled !== false) {
        return `Контроль сохранен: не найдено ${missingCount} паллет. Расхождения зафиксированы.`;
      }
      return `Контроль сохранен: не найдено ${missingCount} паллет. Журнал расхождений временно недоступен (БД).`;
    }
    if (Number(result?.openedCount || 0) > 0 || Number(result?.alreadyOpenCount || 0) > 0) {
      return "Контроль сохранен: расхождения зафиксированы.";
    }
    return "Контроль сохранен: расхождений не найдено.";
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
    setPlanningNextNumber("");
    setSearchCode("");
    setSearchStatus("ACTIVE");
    setSearchQuery("");
    setSearchSupplier("");
    setSearchDateFrom("");
    setSearchDateTo("");
    setSearchSuppliers([]);
    setSearchLocationCode("");
    setSearchLocationItems([]);
    setSearchLocationName("");
    setLocationControlStep("scan");
    setLocationControlFoundCodes([]);
    setLocationControlResult(null);
    locationControlLastSyncedKeyRef.current = "";
    setDiscrepanciesItems([]);
    setDiscrepancyTrackingEnabled(true);
    setDiscrepancyPermissions({ canApproveWriteoff: false });
    setDiscrepancyActionKey("");
    setDiscrepancyView("active");
    setFoundDiscrepancyDraft({
      palletId: null,
      palletCode: "",
      locationCode: "",
    });
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

  const openPrintableHtml = (html) => {
    const normalizedHtml = String(html || "");
    if (!normalizedHtml) return;
    try {
      openHtmlDocumentInNewTab(normalizedHtml, {
        popupBlockedMessage: "Не удалось открыть новый таб. Документ откроется в текущем окне.",
      });
    } catch {
      const blob = new Blob([normalizedHtml], { type: "text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      window.location.href = url;
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    }
  };

  const openPrintFallback = () => {
    if (!printFallback.html) return;
    openPrintableHtml(printFallback.html);
  };

  const printPalletPassports = async (palletCodes) => {
    clearAlerts();
    setLoading(true);
    try {
      const printReady = await buildPalletLabelsBatchHtml(palletCodes);
      setPrintFallback(printReady);
      openPrintableHtml(printReady.html);
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
      const receiveGate = String(receiveForm.receiveGate || "").trim().toUpperCase();
      if (!supplierName) {
        throw new Error("Укажите поставщика.");
      }
      if (!inboundRef) {
        throw new Error("Укажите машину/ТТН.");
      }
      if (!receiveGate) {
        throw new Error("Введите номер ворот.");
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
          body: JSON.stringify({ supplierName, inboundRef, receiveGate }),
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
      if (!palletCode) throw new Error("Сканируйте или введите паллету.");
      if (!locationCode) throw new Error("Сканируйте или введите ячейку размещения.");
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
      setActiveTab("receive");
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
      const dispatchGate = String(dispatchForm.dispatchGate || "").trim().toUpperCase();
      if (!dispatchGate) throw new Error("Введите номер ворот.");
      if (!locationCode) throw new Error("Сканируйте или введите ячейку отбора.");
      if (!palletCode) throw new Error("Сканируйте или введите паллету.");
      const routeSheetId = Number(dispatchRouteSheetId || 0);
      if (!routeSheetId) {
        throw new Error("Сначала выберите маршрутный лист.");
      }
      const dedupeKey = `${routeSheetId}|${dispatchGate}|${locationCode}|${palletCode}`;
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
          dispatchGate,
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
        ...(updatedSheet?.status === "COMPLETED" ? { dispatchGate: "" } : {}),
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

  const loadPlanningNextNumber = async (rawPlannedDate = planningForm.plannedDate) => {
    const plannedDate = String(rawPlannedDate || "").trim();
    if (!plannedDate) {
      setPlanningNextNumber("");
      return;
    }
    setPlanningNextNumberLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("plannedDate", plannedDate);
      const response = await fetch(`${API_BASE}/pallets/route-sheets/next-number?${params.toString()}`, {
        headers: authHeaders,
      });
      const data = await readJsonSafe(response);
      if (!response.ok) {
        throw new Error(mapPalletError(data?.message, "Не удалось получить следующий номер МЛ."));
      }
      setPlanningNextNumber(String(data?.sheetNumber || "").trim());
    } catch (err) {
      console.warn("planning next-number load failed", err);
      setPlanningNextNumber("");
    } finally {
      setPlanningNextNumberLoading(false);
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

  const loadWarehouseLocations = async () => {
    setWarehouseLocationsLoading(true);
    try {
      const response = await fetch(`${API_BASE}/warehouse/locations`, {
        headers: authHeaders,
      });
      const data = await readJsonSafe(response);
      if (!response.ok) {
        throw new Error(mapPalletError(data?.message, "Не удалось загрузить список ячеек."));
      }

      const items = (Array.isArray(data) ? data : [])
        .map((row) => {
          const code = normalizeLocationCode(row?.code || "");
          const name = String(row?.name || "").trim();
          const value = code || normalizeLocationCode(name);
          if (!value) return null;
          return {
            id: row?.id || value,
            value,
            code,
            name,
            label: name && code && name !== code ? `${name} (${code})` : name || code,
          };
        })
        .filter(Boolean)
        .sort((left, right) => String(left.label || "").localeCompare(String(right.label || ""), "ru"));
      setWarehouseLocations(items);
    } catch (err) {
      console.warn("warehouse locations load failed", err);
      setWarehouseLocations([]);
    } finally {
      setWarehouseLocationsLoading(false);
    }
  };

  const createPlanningRouteSheet = async () => {
    setPlanningBusy(true);
    try {
      clearAlerts();
      const payload = {
        clientName: String(planningForm.clientName || "").trim(),
        destinationRc: String(planningForm.destinationRc || "").trim(),
        route: null,
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
      const statusPreset = searchStatus;
      if (statusPreset === "ACTIVE") params.set("statuses", "RECEIVED,STORED");
      if (statusPreset === "DISPATCHED") params.set("statuses", "DISPATCHED");
      if (statusPreset === "ARCHIVE") params.set("statuses", "CANCELLED");
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
      setRecentItems(applySearchStatusPreset(data?.items, statusPreset));
    } catch (err) {
      handleFlowError(err, "Ошибка загрузки списка паллет.");
    } finally {
      setRecentLoading(false);
    }
  };

  const handlePlanningSheetPrint = () => {
    if (!planningSheet?.id) {
      setSuccess("");
      setError("Сначала создайте или откройте маршрутный лист.");
      return;
    }
    try {
      clearAlerts();
      const printHtml = buildRouteSheetPrintHtml(planningSheet);
      openPrintableHtml(printHtml);
      setSuccess("Маршрутный лист открыт для печати.");
    } catch (err) {
      setSuccess("");
      setError(normalizeErrorMessage(err, "Не удалось подготовить печать маршрутного листа."));
    }
  };

  const handleSearchOpenDetails = async (item) => {
    try {
      clearAlerts();
      setSelectedPalletId(item?.id || null);
      setHistoryCollapsed(false);
      setSearchCode(item?.palletCode || "");
      await loadHistoryByCode(item?.palletCode || "", { openDetail: true });
    } catch (err) {
      handleFlowError(err, "Не удалось открыть паллету.");
    }
  };

  const archivePalletFromSearch = async (item) => {
    const palletCode = normalizePalletCode(item?.palletCode || "");
    if (!palletCode) return;
    const confirmed = window.confirm(`Отправить паллету ${palletCode} в архив?`);
    if (!confirmed) return;
    const reason = window.prompt("Причина архивирования (необязательно):", "");
    if (reason === null) return;

    setLoading(true);
    try {
      clearAlerts();
      const response = await fetch(`${API_BASE}/pallets/${encodeURIComponent(palletCode)}/archive`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ reason: String(reason || "").trim() }),
      });
      const data = await readJsonSafe(response);
      if (!response.ok) {
        throw new Error(mapPalletError(data?.message, "Не удалось отправить паллету в архив."));
      }
      setSuccess(`Паллета ${palletCode} отправлена в архив.`);
      if (historyPallet?.palletCode === palletCode && data?.pallet) {
        setHistoryPallet(data.pallet);
        await loadHistoryByCode(palletCode, { openDetail: true });
      }
      await loadRecentPallets();
    } catch (err) {
      setSuccess("");
      setError(normalizeErrorMessage(err, "Не удалось отправить паллету в архив."));
    } finally {
      setLoading(false);
    }
  };

  const loadLocationPallets = async (rawLocationCode) => {
    const sourceLocationCode = rawLocationCode || searchLocationCode;
    const locationCode = normalizeLocationCode(sourceLocationCode);
    if (!locationCode) {
      handleFlowError("Отсканируйте или введите код ячейки.");
      return;
    }

    setSearchLocationLoading(true);
    try {
      clearAlerts();
      const response = await fetch(
        `${API_BASE}/pallets/location-control/${encodeURIComponent(locationCode)}/expected`,
        {
          headers: authHeaders,
        }
      );
      const data = await readJsonSafe(response);
      if (!response.ok) {
        const codedError = new Error(
          mapPalletError(data?.message, "Не удалось загрузить ожидаемые паллеты.")
        );
        codedError.code = String(data?.message || "").trim().toUpperCase();
        throw codedError;
      }
      const location = data?.location || null;
      const discrepancyEnabled = data?.summary?.discrepancyEnabled !== false;
      const items = Array.isArray(data?.expectedPallets) ? data.expectedPallets : [];
      const foundCodes = items
        .map((item) => normalizePalletCode(item?.palletCode))
        .filter(Boolean);
      setSearchLocationCode(normalizeLocationCode(location?.code || locationCode));
      setSearchLocationName(String(location?.name || "").trim());
      setSearchLocationItems(items);
      setLocationControlFoundCodes(foundCodes);
      setLocationControlResult(null);
      locationControlLastSyncedKeyRef.current = "";
      setDiscrepancyTrackingEnabled(discrepancyEnabled);
      setLocationControlStep("confirm");
    } catch (err) {
      const errorCode = String(err?.code || "").trim().toUpperCase();
      if (errorCode === "PALLET_LOCATION_NOT_FOUND") {
        setSuccess("");
        setError("Ячейка не найдена.");
        return;
      }
      const fallbackCandidates = buildLocationCodeCandidates(sourceLocationCode);
      let fallbackItems = [];
      let fallbackHadSuccess = false;
      let fallbackError = null;

      for (const candidate of fallbackCandidates) {
        try {
          const params = new URLSearchParams();
          params.set("status", "STORED");
          params.set("locationCode", candidate);
          const fallbackResponse = await fetch(`${API_BASE}/pallets?${params.toString()}`, {
            headers: authHeaders,
          });
          const fallbackData = await readJsonSafe(fallbackResponse);
          if (!fallbackResponse.ok) {
            fallbackError = new Error(
              mapPalletError(fallbackData?.message, "Не удалось загрузить ожидаемые паллеты.")
            );
            continue;
          }
          fallbackHadSuccess = true;
          const items = Array.isArray(fallbackData?.items) ? fallbackData.items : [];
          fallbackItems = fallbackItems.concat(items);
        } catch (fallbackErr) {
          fallbackError = fallbackErr;
        }
      }

      const fallbackByCode = new Map();
      for (const item of fallbackItems) {
        const code = normalizePalletCode(item?.palletCode);
        if (!code) continue;
        if (!fallbackByCode.has(code)) {
          fallbackByCode.set(code, item);
        }
      }
      const mergedFallbackItems = Array.from(fallbackByCode.values());
      if (fallbackHadSuccess) {
        const firstLocation = mergedFallbackItems[0]?.currentLocation || null;
        const fallbackFoundCodes = mergedFallbackItems
          .map((item) => normalizePalletCode(item?.palletCode))
          .filter(Boolean);
        setSearchLocationCode(
          normalizeLocationCode(firstLocation?.code || fallbackCandidates[0] || locationCode)
        );
        setSearchLocationName(String(firstLocation?.name || "").trim());
        setSearchLocationItems(mergedFallbackItems);
        setLocationControlFoundCodes(fallbackFoundCodes);
        setLocationControlResult(null);
        locationControlLastSyncedKeyRef.current = "";
        setLocationControlStep("confirm");
        if (mergedFallbackItems.length > 0) {
          setSuccess("Ожидаемые паллеты загружены.");
        } else {
          setSuccess("Ожидаемых паллет в ячейке нет.");
        }
        setError("");
      } else {
        setSuccess("");
        setError(
          normalizeErrorMessage(
            fallbackError || err,
            "Не удалось загрузить ожидаемые паллеты по ячейке."
          )
        );
      }
    } finally {
      setSearchLocationLoading(false);
    }
  };

  const loadDiscrepancies = async () => {
    setDiscrepanciesLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("status", "ALL");
      params.set("limit", "300");
      params.set("_ts", String(Date.now()));
      const response = await fetch(`${API_BASE}/pallets/discrepancies?${params.toString()}`, {
        headers: authHeaders,
        cache: "no-store",
      });
      const data = await readJsonSafe(response);
      if (!response.ok) {
        throw new Error(mapPalletError(data?.message, "Не удалось загрузить список расхождений."));
      }
      setDiscrepancyTrackingEnabled(data?.discrepancyEnabled !== false);
      setDiscrepancyPermissions({
        canApproveWriteoff: data?.permissions?.canApproveWriteoff === true,
      });
      setDiscrepanciesItems(Array.isArray(data?.items) ? data.items : []);
    } catch (err) {
      setError(normalizeErrorMessage(err, "Не удалось загрузить список расхождений."));
    } finally {
      setDiscrepanciesLoading(false);
    }
  };

  const activeDiscrepanciesItems = useMemo(
    () => discrepanciesItems.filter((item) => isOpenDiscrepancyItem(item)),
    [discrepanciesItems]
  );
  const archiveDiscrepanciesItems = useMemo(
    () => discrepanciesItems.filter((item) => isArchivedDiscrepancyItem(item)),
    [discrepanciesItems]
  );
  const visibleDiscrepanciesItems =
    discrepancyView === "archive" ? archiveDiscrepanciesItems : activeDiscrepanciesItems;

  const submitLocationControl = async (foundPalletCodes, { showSuccessModal = true } = {}) => {
    const locationCode = normalizeLocationCode(searchLocationCode);
    if (!locationCode) {
      handleFlowError("Сначала отсканируйте ячейку.");
      return false;
    }
    setLocationControlSubmitting(true);
    try {
      if (showSuccessModal) {
        clearAlerts();
      } else {
        setError("");
      }
      const payload = {
        foundPalletCodes: Array.isArray(foundPalletCodes) ? foundPalletCodes : [],
      };
      const response = await fetch(
        `${API_BASE}/pallets/location-control/${encodeURIComponent(locationCode)}/reconcile`,
        {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify(payload),
        }
      );
      const data = await readJsonSafe(response);
      if (!response.ok) {
        throw new Error(mapPalletError(data?.message, "Не удалось зафиксировать контроль ячейки."));
      }
      const result = {
        location: data?.location || null,
        expectedCount: Number(data?.expectedCount || 0),
        actualCount: Number(data?.actualCount || 0),
        missingPalletCodes: Array.isArray(data?.missingPalletCodes) ? data.missingPalletCodes : [],
        openedCount: Number(data?.openedCount || 0),
        alreadyOpenCount: Number(data?.alreadyOpenCount || 0),
        closedCount: Number(data?.closedCount || 0),
        discrepancyEnabled: data?.discrepancyEnabled !== false,
      };
      setLocationControlResult(result);
      setDiscrepancyTrackingEnabled(result.discrepancyEnabled);
      locationControlLastSyncedKeyRef.current = buildLocationControlSyncKey(locationCode, payload.foundPalletCodes);

      if (showSuccessModal) {
        setSuccess(locationControlSuccessMessage(result));
      } else {
        setSuccess("");
      }

      if (activeTab === "discrepancies" || result.openedCount > 0 || result.closedCount > 0) {
        loadDiscrepancies();
      }
      return true;
    } catch (err) {
      if (showSuccessModal) {
        setSuccess("");
      }
      setError(normalizeErrorMessage(err, "Не удалось зафиксировать контроль ячейки."));
      return false;
    } finally {
      setLocationControlSubmitting(false);
    }
  };

  const markLocationControlMissing = async (palletCode) => {
    if (locationControlSubmitting) return;
    const normalized = normalizePalletCode(palletCode);
    if (!normalized) return;
    const currentCodes = Array.isArray(locationControlFoundCodes) ? locationControlFoundCodes : [];
    const alreadyFound = currentCodes.includes(normalized);
    if (!alreadyFound) return;
    const nextCodes = currentCodes.filter((code) => code !== normalized);

    setLocationControlFoundCodes(nextCodes);
    const applied = await submitLocationControl(nextCodes, { showSuccessModal: false });
    if (!applied) {
      setLocationControlFoundCodes(currentCodes);
    }
  };

  const runDiscrepancyAction = async (item, action, body = null, fallbackMessage = "") => {
    const palletId = Number(item?.palletId || 0);
    if (!palletId) {
      setError("Не удалось определить паллету для действия.");
      return;
    }
    const actionKey = `${palletId}:${action}`;
    setDiscrepancyActionKey(actionKey);
    try {
      clearAlerts();
      const response = await fetch(
        `${API_BASE}/pallets/discrepancies/${encodeURIComponent(palletId)}/${action}`,
        {
          method: "POST",
          headers: authHeaders,
          ...(body ? { body: JSON.stringify(body) } : {}),
        }
      );
      const data = await readJsonSafe(response);
      if (!response.ok) {
        throw new Error(mapPalletError(data?.message, fallbackMessage || "Не удалось выполнить действие."));
      }
      await loadDiscrepancies();
      return data || null;
    } catch (err) {
      setSuccess("");
      setError(normalizeErrorMessage(err, fallbackMessage || "Не удалось выполнить действие."));
      return null;
    } finally {
      setDiscrepancyActionKey("");
    }
  };

  const handleDiscrepancyMarkFound = async (item) => {
    const palletId = Number(item?.palletId || 0);
    if (!palletId) return;
    setFoundDiscrepancyDraft({
      palletId,
      palletCode: String(item?.palletCode || "").trim(),
      locationCode: "",
    });
    setSuccess("");
    setError("");
  };

  const handleDiscrepancyFoundConfirm = async () => {
    const palletId = Number(foundDiscrepancyDraft?.palletId || 0);
    if (!palletId) return;
    const locationCode = normalizeLocationCode(foundDiscrepancyDraft?.locationCode);
    if (!locationCode) {
      setError("Сканируйте или введите ячейку, куда возвращается паллета.");
      return;
    }
    const item = {
      palletId,
      palletCode: foundDiscrepancyDraft?.palletCode || "",
    };
    const result = await runDiscrepancyAction(
      item,
      "mark-found",
      { locationCode },
      "Не удалось закрыть расхождение как найденное."
    );
    if (result) {
      setFoundDiscrepancyDraft({
        palletId: null,
        palletCode: "",
        locationCode: "",
      });
      setSuccess("Паллета отмечена как найденная и возвращена в выбранную ячейку.");
    }
  };

  const handleDiscrepancyRequestWriteoff = async (item) => {
    const palletCode = String(item?.palletCode || "").trim() || "паллеты";
    const reason = window.prompt(
      `Причина запроса списания для ${palletCode} (необязательно):`,
      ""
    );
    if (reason === null) return;
    const result = await runDiscrepancyAction(
      item,
      "request-writeoff",
      { reason: String(reason || "").trim() },
      "Не удалось отправить запрос на списание."
    );
    if (result) {
      setSuccess("Запрос на списание отправлен админу/владельцу.");
    }
  };

  const handleDiscrepancyOwnerDecision = async (item, decision) => {
    const normalizedDecision = String(decision || "").trim().toUpperCase();
    const isApprove = normalizedDecision === "APPROVE";
    const palletCode = String(item?.palletCode || "").trim() || "паллеты";
    const promptText = isApprove
      ? `Подтвердить списание ${palletCode} с баланса склада?`
      : `Отклонить списание ${palletCode}?`;
    const confirmed = window.confirm(promptText);
    if (!confirmed) return;

    let reason = "";
    if (!isApprove) {
      const input = window.prompt("Причина отклонения (необязательно):", "");
      if (input === null) return;
      reason = String(input || "").trim();
    }

    const result = await runDiscrepancyAction(
      item,
      "owner-decision",
      { decision: normalizedDecision, reason },
      isApprove ? "Не удалось подтвердить списание." : "Не удалось отклонить списание."
    );
    if (result) {
      setSuccess(isApprove ? "Списание паллеты подтверждено владельцем." : "Списание паллеты отклонено.");
    }
  };

  const handleLocationControlConfirm = async () => {
    const currentSyncKey = buildLocationControlSyncKey(searchLocationCode, locationControlFoundCodes);
    if (locationControlResult && locationControlLastSyncedKeyRef.current === currentSyncKey) {
      setError("");
      setSuccess(locationControlSuccessMessage(locationControlResult));
      return;
    }
    await submitLocationControl(locationControlFoundCodes, { showSuccessModal: true });
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
    if (!["store", "dispatch", "locationControl"].includes(activeTab)) return;
    if (warehouseLocations.length > 0) return;
    loadWarehouseLocations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, warehouseLocations.length]);

  useEffect(() => {
    if (activeTab !== "planning") return;
    loadPlanningSheets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  useEffect(() => {
    if (activeTab !== "planning") return;
    if (planningSheet?.id) return;
    if (!planningForm.plannedDate) {
      const today = new Date().toISOString().slice(0, 10);
      setPlanningForm((prev) => (prev.plannedDate ? prev : { ...prev, plannedDate: today }));
      return;
    }
    loadPlanningNextNumber(planningForm.plannedDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, planningSheet?.id, planningForm.plannedDate]);

  useEffect(() => {
    if (activeTab !== "planning") return;
    if (!planningSheet?.id) return;
    if (planningSheet.status !== "DRAFT") return;
    loadPlanningCandidates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, planningSheet?.id, planningSheet?.status]);

  useEffect(() => {
    if (activeTab !== "discrepancies") return;
    loadDiscrepancies();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  useEffect(() => {
    if (activeTab === "discrepancies") return;
    setFoundDiscrepancyDraft({
      palletId: null,
      palletCode: "",
      locationCode: "",
    });
    setDiscrepancyView("active");
  }, [activeTab]);

  useEffect(() => {
    const normalized = String(initialTab || "").trim();
    if (!CROSSDOCK_TAB_IDS.has(normalized)) return;
    if (strictStepLock) return;
    if (lastAppliedInitialTabRef.current === normalized) return;
    lastAppliedInitialTabRef.current = normalized;
    setActiveTab(normalized);
  }, [initialTab, strictStepLock]);

  useEffect(() => {
    if (typeof onTabChange === "function") {
      onTabChange(activeTab);
    }
  }, [activeTab, onTabChange]);

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
      { id: "locationControl", label: "Контроль ячеек" },
      { id: "discrepancies", label: "Расхождения" },
      { id: "search", label: "Поиск паллет" },
    ],
    []
  );
  const historyReceiveGate = useMemo(() => {
    for (let index = historyEvents.length - 1; index >= 0; index -= 1) {
      const event = historyEvents[index];
      if (!["CREATE", "RECEIVE"].includes(String(event?.type || "").trim().toUpperCase())) continue;
      const gate = extractGateFromMeta(event?.metaJson);
      if (gate) return gate;
    }
    return "";
  }, [historyEvents]);
  const historyDispatchGate = useMemo(() => {
    for (let index = historyEvents.length - 1; index >= 0; index -= 1) {
      const event = historyEvents[index];
      if (String(event?.type || "").trim().toUpperCase() !== "DISPATCH") continue;
      const gate = extractGateFromMeta(event?.metaJson);
      if (gate) return gate;
    }
    return "";
  }, [historyEvents]);

  const handleHeaderBack = useCallback(() => {
    setError("");
    setSuccess("");

    if (activeTab === "receive") {
      if (receiveStep === "inbound") {
        setReceiveStep("supplier");
        return;
      }
      if (receiveStep === "gate") {
        setReceiveStep("inbound");
        return;
      }
      if (receiveStep === "qty") {
        setReceiveStep("gate");
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
        setDispatchStep("gate");
        setDispatchForm((prev) => ({ ...prev, locationCode: "", palletCode: "" }));
        return;
      }
      if (dispatchStep === "gate") {
        setDispatchStep("setup");
        setDispatchForm((prev) => ({ ...prev, dispatchGate: "", locationCode: "", palletCode: "" }));
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

    if (activeTab === "locationControl") {
      if (locationControlStep === "confirm") {
        setLocationControlStep("scan");
        setLocationControlFoundCodes([]);
        setLocationControlResult(null);
        return;
      }
      setActiveTab("receive");
      return;
    }

    if (activeTab === "discrepancies") {
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
    locationControlStep,
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
        <div className="tabs tabs--sm tsd-pallet-tabs">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`tabs__btn tsd-pallet-tab ${
                activeTab === tab.id ? "tabs__btn--active tsd-pallet-tab--active" : ""
              }`}
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
                  setPlanningNextNumber("");
                }
                if (tab.id === "search") {
                  setSearchView("list");
                }
                if (tab.id === "locationControl") {
                  setLocationControlStep("scan");
                  setLocationControlFoundCodes([]);
                  setLocationControlResult(null);
                  setSearchLocationCode("");
                  setSearchLocationName("");
                  setSearchLocationItems([]);
                }
                if (tab.id === "discrepancies") {
                  setLocationControlResult(null);
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
                  ? "Шаг 1 из 4: укажите поставщика."
                  : receiveStep === "inbound"
                    ? "Шаг 2 из 4: укажите машину / ТТН."
                    : receiveStep === "gate"
                      ? "Шаг 3 из 4: укажите номер ворот приемки."
                    : receiveStep === "qty"
                      ? "Шаг 4 из 4: укажите количество паллет."
                      : "Паспорта сформированы. Откройте и распечатайте."}
              </div>
              <div className="tsd-card__meta">
                Поставщик: {String(receiveForm.supplierName || "").trim() || "-"} • Машина/ТТН:{" "}
                {String(receiveForm.inboundRef || "").trim() || "-"} • Ворота:{" "}
                {String(receiveForm.receiveGate || "").trim() || "-"} • Кол-во:{" "}
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
                      setReceiveStep("gate");
                    }}
                    disabled={loading || !String(receiveForm.inboundRef || "").trim()}
                  >
                    Далее
                  </button>
                </div>
              </>
            ) : null}

            {receiveStep === "gate" ? (
              <>
                <div className="tsd-qty-input">
                  <label className="tsd-scanner__label">Номер ворот *</label>
                  <input
                    className="tsd-input"
                    value={receiveForm.receiveGate}
                    onChange={(event) =>
                      setReceiveForm((prev) => ({
                        ...prev,
                        receiveGate: String(event.target.value || "").toUpperCase(),
                      }))
                    }
                    placeholder="Введите номер ворот"
                    disabled={loading}
                  />
                </div>
                <div className="tsd-action-bar">
                  <button
                    type="button"
                    className="tsd-btn tsd-btn--primary"
                    onClick={() => {
                      if (!String(receiveForm.receiveGate || "").trim()) {
                        handleFlowError("Введите номер ворот.");
                        return;
                      }
                      clearAlerts();
                      setReceiveStep("qty");
                    }}
                    disabled={loading || !String(receiveForm.receiveGate || "").trim()}
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
                      !String(receiveForm.receiveGate || "").trim() ||
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
                    className="tsd-btn tsd-btn--ghost tsd-btn--same-size"
                    onClick={resetReceiveScanFlow}
                    disabled={loading}
                  >
                    Новая приемка
                  </button>
                  <button
                    type="button"
                    className="tsd-btn tsd-btn--primary tsd-btn--same-size"
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
                manualPlaceholder="Код паллеты (например, PLT-...)"
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
                  scanKind="mixed"
                />
                <div className="tsd-inline tsd-inline--two">
                  <select
                    className="tsd-input"
                    value={storeForm.locationCode}
                    onChange={(event) => {
                      const selectedLocationCode = normalizeLocationCode(event.target.value);
                      setStoreForm((prev) => ({ ...prev, locationCode: selectedLocationCode }));
                    }}
                    disabled={loading || warehouseLocationsLoading}
                  >
                    <option value="">
                      {warehouseLocationsLoading ? "Загружаем ячейки..." : "Выберите ячейку"}
                    </option>
                    {warehouseLocations.map((location) => (
                      <option key={`store-location-${location.id}`} value={location.value}>
                        {location.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="tsd-btn tsd-btn--secondary"
                    onClick={async () => {
                      const normalizedPalletCode = normalizePalletCode(storeForm.palletCode);
                      if (!normalizedPalletCode) {
                        handleFlowError("Сначала отсканируйте или введите паллету.");
                        return;
                      }
                      const selectedLocationCode = normalizeLocationCode(storeForm.locationCode);
                      if (!selectedLocationCode) {
                        handleFlowError("Выберите ячейку.");
                        return;
                      }
                      await handleStoreSubmit({
                        palletCodeOverride: normalizedPalletCode,
                        locationCodeOverride: selectedLocationCode,
                      });
                    }}
                    disabled={loading || !normalizeLocationCode(storeForm.locationCode)}
                  >
                    Разместить
                  </button>
                </div>
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
                    value={
                      planningNextNumberLoading
                        ? "Подбираем номер МЛ..."
                        : planningNextNumber || "Номер МЛ появится автоматически"
                    }
                    placeholder="Номер МЛ (авто)"
                    disabled
                    readOnly
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
                <div className="tsd-qty-input">
                  <input
                    className="tsd-input"
                    value={planningForm.destinationRc}
                    onChange={(event) =>
                      setPlanningForm((prev) => ({ ...prev, destinationRc: event.target.value }))
                    }
                    placeholder="РЦ назначения *"
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
                    <button
                      type="button"
                      className="tsd-btn tsd-btn--chip"
                      onClick={handlePlanningSheetPrint}
                      disabled={planningBusy || routeSheetLoading}
                    >
                      Печать МЛ
                    </button>
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
                              <div className="tsd-card__meta">
                                Ячейка: {locationDisplayName(item.currentLocation)}
                              </div>
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
                          Ячейка: {locationDisplayName(item.pallet?.currentLocation)} • Поставщик:{" "}
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
                  ? "Шаг 1 из 4: выберите маршрутный лист."
                  : dispatchStep === "gate"
                    ? "Шаг 2 из 4: укажите номер ворот отгрузки."
                  : dispatchStep === "location"
                    ? "Шаг 3 из 4: отсканируйте ячейку отбора."
                    : "Шаг 4 из 4: отсканируйте паллету для подтверждения отгрузки."}
              </div>
              <div className="tsd-card__meta">
                МЛ: {dispatchRouteSheetId || "-"} • РЦ: {dispatchForm.destinationRc || "-"} • Ворота:{" "}
                {dispatchForm.dispatchGate || "-"} • Ячейка: {dispatchForm.locationCode || "-"} • Паллета:{" "}
                {dispatchForm.palletCode || "-"}
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
                        onClick={() => setDispatchStep("gate")}
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

            {dispatchStep === "gate" ? (
              <>
                <div className="tsd-action-inline">
                  <button
                    type="button"
                    className="tsd-btn tsd-btn--ghost tsd-btn--center"
                    onClick={() => {
                      setDispatchStep("setup");
                      setDispatchForm((prev) => ({
                        ...prev,
                        dispatchGate: "",
                        locationCode: "",
                        palletCode: "",
                      }));
                    }}
                    disabled={loading}
                  >
                    Сменить МЛ
                  </button>
                </div>
                <div className="tsd-qty-input">
                  <label className="tsd-scanner__label">Номер ворот *</label>
                  <input
                    className="tsd-input"
                    value={dispatchForm.dispatchGate}
                    onChange={(event) =>
                      setDispatchForm((prev) => ({
                        ...prev,
                        dispatchGate: String(event.target.value || "").toUpperCase(),
                      }))
                    }
                    placeholder="Введите номер ворот"
                    disabled={loading}
                  />
                </div>
                <div className="tsd-action-bar">
                  <button
                    type="button"
                    className="tsd-btn tsd-btn--primary"
                    onClick={() => {
                      if (!String(dispatchForm.dispatchGate || "").trim()) {
                        handleFlowError("Введите номер ворот.");
                        return;
                      }
                      clearAlerts();
                      setDispatchStep("location");
                    }}
                    disabled={loading || !String(dispatchForm.dispatchGate || "").trim()}
                  >
                    Далее
                  </button>
                </div>
              </>
            ) : null}

            {dispatchStep === "location" ? (
              <>
                <div className="tsd-action-inline">
                  <button
                    type="button"
                    className="tsd-btn tsd-btn--ghost tsd-btn--center"
                    onClick={() => {
                      setDispatchStep("gate");
                      setDispatchForm((prev) => ({ ...prev, locationCode: "", palletCode: "" }));
                    }}
                    disabled={loading}
                  >
                    Изменить ворота
                  </button>
                </div>
                <Scanner
                  label="Шаг 3. Скан ячейки отбора"
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
                  scanKind="mixed"
                />
                <div className="tsd-inline tsd-inline--two">
                  <select
                    className="tsd-input"
                    value={dispatchForm.locationCode}
                    onChange={(event) => {
                      const selectedLocationCode = normalizeLocationCode(event.target.value);
                      setDispatchForm((prev) => ({
                        ...prev,
                        locationCode: selectedLocationCode,
                        palletCode: "",
                      }));
                    }}
                    disabled={loading || warehouseLocationsLoading}
                  >
                    <option value="">
                      {warehouseLocationsLoading ? "Загружаем ячейки..." : "Выберите ячейку"}
                    </option>
                    {warehouseLocations.map((location) => (
                      <option key={`dispatch-location-${location.id}`} value={location.value}>
                        {location.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="tsd-btn tsd-btn--secondary"
                    onClick={() => {
                      const selectedLocationCode = normalizeLocationCode(dispatchForm.locationCode);
                      if (!selectedLocationCode) {
                        handleFlowError("Выберите ячейку.");
                        return;
                      }
                      clearAlerts();
                      setDispatchStep("pallet");
                    }}
                    disabled={loading || !normalizeLocationCode(dispatchForm.locationCode)}
                  >
                    Выбрать
                  </button>
                </div>
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
                  label="Шаг 4. Скан паллеты"
                  hint={`Ячейка ${dispatchForm.locationCode || "-"} принята. Сканируйте паллету.`}
                  manualPlaceholder="Код паллеты (например, PLT-...)"
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
                />
              </>
            ) : null}
          </div>
        ) : null}

        {activeTab === "locationControl" ? (
          <div className="tsd-list">
            <div className="tsd-card">
              <div className="tsd-card__title">Контроль ячеек</div>
              <div className="tsd-card__meta">
                {locationControlStep === "scan"
                  ? "Шаг 1 из 2: отсканируйте ячейку и получите ожидаемые паллеты."
                  : "Шаг 2 из 2: подтвердите найденные паллеты в ячейке."}
              </div>
            </div>
            {locationControlStep === "scan" ? (
              <>
                <Scanner
                  label="Скан ячейки"
                  hint="Сканируйте код ячейки"
                  manualPlaceholder="Введите код ячейки"
                  onScan={async (value) => {
                    await loadLocationPallets(value);
                  }}
                  disabled={searchLocationLoading || historyLoading}
                  scanKind="mixed"
                />
                <div className="tsd-inline tsd-inline--two">
                  <input
                    className="tsd-input"
                    value={searchLocationCode}
                    onChange={(event) => setSearchLocationCode(event.target.value)}
                    placeholder="Код ячейки"
                    disabled={searchLocationLoading || historyLoading}
                  />
                  <button
                    type="button"
                    className="tsd-btn tsd-btn--secondary"
                    onClick={async () => {
                      await loadLocationPallets(searchLocationCode);
                    }}
                    disabled={searchLocationLoading || historyLoading}
                  >
                    {searchLocationLoading ? "Проверяем..." : "Показать ожидаемые"}
                  </button>
                </div>
              </>
            ) : null}

            {locationControlStep === "confirm" ? (
              <>
                <div className="tsd-card">
                  <div className="tsd-card__title">
                    Ячейка: {searchLocationName || normalizeLocationCode(searchLocationCode)}
                  </div>
                  <div className="tsd-card__meta">Ожидалось паллет: {searchLocationItems.length}</div>
                  <div className="tsd-card__meta">
                    Подтверждено паллет: {locationControlFoundCodes.length}
                  </div>
                </div>

                {searchLocationItems.length ? (
                  <div className="tsd-list">
                    {searchLocationItems.map((item) => {
                      const code = normalizePalletCode(item?.palletCode);
                      const isFound = locationControlFoundCodes.includes(code);
                      return (
                        <div
                          key={`location-control-item-${item.id}`}
                          className={`tsd-card tsd-pallet-list-btn ${
                            isFound
                              ? "tsd-pallet-list-btn--stored tsd-pallet-list-btn--selected"
                              : "tsd-pallet-list-btn--received"
                          }`}
                        >
                          <div className="tsd-card__title">{item.palletCode || "-"}</div>
                          <div className="tsd-card__meta">
                            Ячейка: {locationDisplayName(item.currentLocation)}
                          </div>
                          <div className="tsd-card__meta">
                            Статус контроля: {isFound ? "Найдена" : "Не найдена"}
                          </div>
                          <div className="tsd-location-control-row__actions">
                            <button
                              type="button"
                              className="tsd-btn tsd-btn--chip tsd-btn--chip-warn"
                              onClick={() => markLocationControlMissing(code)}
                              disabled={locationControlSubmitting || !isFound}
                            >
                              Не найдена
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="tsd-card">
                    <div className="tsd-card__meta">
                      Ожидаемых паллет в ячейке нет. Подтвердите пустую ячейку.
                    </div>
                  </div>
                )}

                <div className="tsd-action-bar">
                  <button
                    type="button"
                    className="tsd-btn tsd-btn--primary"
                    onClick={handleLocationControlConfirm}
                    disabled={locationControlSubmitting || searchLocationLoading}
                  >
                    {locationControlSubmitting ? "Сохраняем..." : "Подтвердить контроль"}
                  </button>
                  <button
                    type="button"
                    className="tsd-btn tsd-btn--secondary"
                    onClick={() => {
                      setLocationControlStep("scan");
                      setLocationControlFoundCodes([]);
                      setLocationControlResult(null);
                    }}
                    disabled={locationControlSubmitting}
                  >
                    Сканировать другую ячейку
                  </button>
                </div>

                {locationControlResult ? (
                  <div className="tsd-card">
                    <div className="tsd-card__title">Результат контроля</div>
                    <div className="tsd-card__meta">
                      Ожидалось: {locationControlResult.expectedCount} • Факт:{" "}
                      {locationControlResult.actualCount}
                    </div>
                    <div className="tsd-card__meta">
                      Новых расхождений: {locationControlResult.openedCount} • Уже открытых:{" "}
                      {locationControlResult.alreadyOpenCount} • Закрытых: {locationControlResult.closedCount}
                    </div>
                    {!locationControlResult.discrepancyEnabled ? (
                      <div className="tsd-card__meta">
                        Внимание: журнал расхождений временно недоступен, записи в раздел «Расхождения» не
                        создаются.
                      </div>
                    ) : null}
                    {locationControlResult.missingPalletCodes?.length ? (
                      <div className="tsd-card__meta">
                        Недостающие паллеты: {locationControlResult.missingPalletCodes.join(", ")}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </>
            ) : null}
          </div>
        ) : null}

        {activeTab === "discrepancies" ? (
          <div className="tsd-list">
            <div className="tsd-card">
              <div className="tsd-card__title">Расхождения</div>
              <div className="tsd-card__meta">
                Красные строки: паллета не найдена (активно). Зеленые: паллета найдена. Серые: списана с
                баланса (архив).
              </div>
              <div className="tsd-discrepancy-actions">
                <button
                  type="button"
                  className={`tsd-btn tsd-btn--chip ${
                    discrepancyView === "active" ? "tsd-btn--chip-active" : ""
                  }`}
                  onClick={() => setDiscrepancyView("active")}
                >
                  Активные ({activeDiscrepanciesItems.length})
                </button>
                <button
                  type="button"
                  className={`tsd-btn tsd-btn--chip ${
                    discrepancyView === "archive" ? "tsd-btn--chip-active" : ""
                  }`}
                  onClick={() => setDiscrepancyView("archive")}
                >
                  Архив ({archiveDiscrepanciesItems.length})
                </button>
              </div>
            </div>

            {discrepancyView === "active" && Number(foundDiscrepancyDraft?.palletId || 0) > 0 ? (
              <div className="tsd-card">
                <div className="tsd-card__title">
                  Найденная паллета: {foundDiscrepancyDraft.palletCode || "-"}
                </div>
                <div className="tsd-card__meta">
                  Сканируйте ячейку, куда сотрудник поставил паллету.
                </div>
                <Scanner
                  label="Скан ячейки"
                  hint="Наведите камеру на QR ячейки или введите код вручную"
                  manualPlaceholder="Введите код ячейки, например: А01"
                  onScan={async (value) => {
                    setFoundDiscrepancyDraft((prev) => ({
                      ...prev,
                      locationCode: normalizeLocationCode(value),
                    }));
                  }}
                  disabled={Boolean(discrepancyActionKey)}
                  scanKind="mixed"
                />
                <div className="tsd-inline tsd-inline--two">
                  <input
                    className="tsd-input"
                    value={foundDiscrepancyDraft.locationCode}
                    onChange={(event) =>
                      setFoundDiscrepancyDraft((prev) => ({
                        ...prev,
                        locationCode: event.target.value,
                      }))
                    }
                    placeholder="Код ячейки"
                    disabled={Boolean(discrepancyActionKey)}
                  />
                  <button
                    type="button"
                    className="tsd-btn tsd-btn--chip tsd-btn--chip-success"
                    onClick={handleDiscrepancyFoundConfirm}
                    disabled={Boolean(discrepancyActionKey)}
                  >
                    Подтвердить найдено
                  </button>
                </div>
                <div className="tsd-discrepancy-actions">
                  <button
                    type="button"
                    className="tsd-btn tsd-btn--chip"
                    onClick={() =>
                      setFoundDiscrepancyDraft({
                        palletId: null,
                        palletCode: "",
                        locationCode: "",
                      })
                    }
                    disabled={Boolean(discrepancyActionKey)}
                  >
                    Отмена
                  </button>
                </div>
              </div>
            ) : null}

            {discrepanciesLoading ? (
              <div className="tsd-card">
                <div className="tsd-card__meta">Загрузка расхождений...</div>
              </div>
            ) : null}

            {!discrepanciesLoading && !discrepancyTrackingEnabled ? (
              <div className="tsd-card">
                <div className="tsd-card__meta">
                  Журнал расхождений временно недоступен: нет доступа БД к таблице расхождений.
                </div>
              </div>
            ) : null}

            {!discrepanciesLoading && discrepancyTrackingEnabled && !visibleDiscrepanciesItems.length ? (
              <div className="tsd-card">
                <div className="tsd-card__meta">
                  {discrepancyView === "archive"
                    ? "Архив списанных паллет пуст."
                    : "Активных расхождений по паллетам нет."}
                </div>
              </div>
            ) : null}

            {!discrepanciesLoading && visibleDiscrepanciesItems.length ? (
              <div className="tsd-list">
                {visibleDiscrepanciesItems.map((item) => {
                  const status = String(item?.status || "").trim().toUpperCase();
                  const isOpen = status === "OPEN";
                  const writeoffStatus = String(item?.writeoffRequest?.status || "").trim().toUpperCase();
                  const isWriteoffApproved = writeoffStatus === "APPROVED";
                  const isWriteoffPending = writeoffStatus === "PENDING";
                  const canApproveWriteoff = discrepancyPermissions.canApproveWriteoff === true;
                  const palletId = Number(item?.palletId || 0);
                  const foundActionKey = `${palletId}:mark-found`;
                  const requestActionKey = `${palletId}:request-writeoff`;
                  const approveActionKey = `${palletId}:owner-decision`;
                  const anyActionRunning =
                    discrepancyActionKey === foundActionKey ||
                    discrepancyActionKey === requestActionKey ||
                    discrepancyActionKey === approveActionKey;
                  return (
                    <div
                      key={`discrepancy-${item.id}`}
                      className={`tsd-card tsd-discrepancy-row ${
                        isOpen
                          ? "tsd-discrepancy-row--open"
                          : isWriteoffApproved
                            ? "tsd-discrepancy-row--archived"
                            : "tsd-discrepancy-row--closed"
                      }`}
                    >
                      <div className="tsd-card__title">{item?.palletCode || "-"}</div>
                      <div className="tsd-card__meta">
                        Ячейка: {locationDisplayName(item?.location)}
                      </div>
                      <div className="tsd-card__meta">
                        Выявлено: {formatDateTime(item?.detectedAt)} • Выявил:{" "}
                        {String(item?.detectedBy?.name || "").trim() || "-"}
                      </div>
                      <div className="tsd-card__meta">
                        Статус: {discrepancyStatusLabel(status, writeoffStatus)}
                      </div>
                      {writeoffStatus ? (
                        <div className="tsd-card__meta">
                          Запрос на списание: {discrepancyWriteoffStatusLabel(writeoffStatus)}
                        </div>
                      ) : null}
                      {isOpen ? (
                        <div className="tsd-discrepancy-actions">
                          <button
                            type="button"
                            className="tsd-btn tsd-btn--chip tsd-btn--chip-success"
                            onClick={() => handleDiscrepancyMarkFound(item)}
                            disabled={anyActionRunning}
                          >
                            Найден
                          </button>
                          {!isWriteoffPending ? (
                            <button
                              type="button"
                              className="tsd-btn tsd-btn--chip tsd-btn--chip-warn"
                              onClick={() => handleDiscrepancyRequestWriteoff(item)}
                              disabled={anyActionRunning}
                            >
                              Не найден
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                      {isOpen && isWriteoffPending && canApproveWriteoff ? (
                        <div className="tsd-discrepancy-actions">
                          <button
                            type="button"
                            className="tsd-btn tsd-btn--chip tsd-btn--chip-danger"
                            onClick={() => handleDiscrepancyOwnerDecision(item, "APPROVE")}
                            disabled={anyActionRunning}
                          >
                            Списать с баланса
                          </button>
                          <button
                            type="button"
                            className="tsd-btn tsd-btn--chip"
                            onClick={() => handleDiscrepancyOwnerDecision(item, "REJECT")}
                            disabled={anyActionRunning}
                          >
                            Отклонить
                          </button>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
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
                    <option value="">Все статусы</option>
                    <option value="ACTIVE">Принято</option>
                    <option value="DISPATCHED">Отгружено</option>
                    <option value="ARCHIVE">Архив (списанные)</option>
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
                      setSearchLocationCode("");
                      setSearchLocationItems([]);
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
                    {normalizePalletStatusValue(historyPallet.status) !== "CANCELLED" ? (
                      <button
                        type="button"
                        className="tsd-btn tsd-btn--chip tsd-btn--chip-warn tsd-btn--compact"
                        onClick={async () => {
                          await archivePalletFromSearch(historyPallet);
                        }}
                        disabled={loading}
                      >
                        В архив
                      </button>
                    ) : null}
                  </div>
                </div>
                {!historyCollapsed ? (
                  <>
                    <div className="tsd-card__meta">Статус: {statusLabel(historyPallet.status)}</div>
                    <div className="tsd-card__meta">
                      Поставщик: {historyPallet.supplierName || "-"} • Машина/ТТН:{" "}
                      {historyPallet.inboundRef || "-"}
                    </div>
                    {historyReceiveGate ? (
                      <div className="tsd-card__meta">Ворота приемки: {historyReceiveGate}</div>
                    ) : null}
                    {historyDispatchGate ? (
                      <div className="tsd-card__meta">Ворота отгрузки: {historyDispatchGate}</div>
                    ) : null}
                    <div className="tsd-card__meta">
                      Текущая ячейка: {locationDisplayName(historyPallet.currentLocation)}
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
                    {(() => {
                      const metaText = renderMeta(event.metaJson);
                      return (
                        <>
                          <div className="tsd-pallet-event__head">
                            <span className="tsd-pallet-event__type">{eventTypeLabel(event.type)}</span>
                            <span className="tsd-pallet-event__date">{formatDateTime(event.createdAt)}</span>
                          </div>
                          <div className="tsd-pallet-event__meta">
                            {event.user?.name || event.user?.email || "Система"} •{" "}
                            {statusLabel(event.fromStatus)} → {statusLabel(event.toStatus)}
                          </div>
                          {metaText ? (
                            <div className="tsd-pallet-event__meta">{metaText}</div>
                          ) : null}
                        </>
                      );
                    })()}
                  </div>
                ))}
              </div>
            ) : null}

            {recentItems.length && searchView === "list" ? (
              <div className="tsd-list">
                {recentItems.slice(0, 40).map((item) => {
                  const normalizedStatus = normalizePalletStatusValue(item.status);
                  return (
                    <div
                      key={item.id}
                      className={`tsd-card tsd-pallet-list-btn ${
                        normalizedStatus === "DISPATCHED" || normalizedStatus === "CANCELLED"
                          ? "tsd-pallet-list-btn--stored"
                          : "tsd-pallet-list-btn--received"
                      } ${selectedPalletId === item.id ? "tsd-pallet-list-btn--selected" : ""}`}
                    >
                      <div className="tsd-card__title">{item.palletCode}</div>
                      <div className="tsd-card__meta">Статус: {statusLabel(item.status)}</div>
                      <div className="tsd-card__meta">
                        Локация: {locationDisplayName(item.currentLocation)}
                      </div>
                      <div className="tsd-card__meta">
                        Поставщик: {item.supplierName || "-"} • Машина/ТТН: {item.inboundRef || "-"}
                      </div>
                      <div className="tsd-discrepancy-actions">
                        <button
                          type="button"
                          className="tsd-btn tsd-btn--chip"
                          onClick={async () => {
                            await handleSearchOpenDetails(item);
                          }}
                          disabled={loading}
                        >
                          Открыть
                        </button>
                        {normalizedStatus !== "CANCELLED" ? (
                          <button
                            type="button"
                            className="tsd-btn tsd-btn--chip tsd-btn--chip-warn"
                            onClick={async () => {
                              await archivePalletFromSearch(item);
                            }}
                            disabled={loading}
                          >
                            В архив
                          </button>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
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


