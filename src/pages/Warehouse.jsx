

import { useCallback, useEffect, useMemo, useRef, useState, Fragment } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router-dom";

import { API_BASE, normalizeErrorMessage } from "../apiConfig";
import { useAuth } from "../context/AuthContext";
import {
  hasPermission,
  PERMISSION_KEYS,
  WAREHOUSE_SECTION_PERMISSION_MAP,
} from "../utils/permissions";

import PurchaseOrderModal from "../components/PurchaseOrderModal";

import PurchaseOrderReceiveModal from "../components/PurchaseOrderReceiveModal";
import StockAuditTab from "../components/StockAuditTab";
import StockHoldsPanel from "../components/StockHoldsPanel";
import StockMovementsHistoryTab from "../components/StockMovementsHistoryTab";
import StockTransactionsTab from "../components/StockTransactionsTab";
import StockRevisionTab from "../components/StockRevisionTab";
import SupplierTrucksQueueTab from "../components/SupplierTrucksQueueTab";
import MobileTsdTab from "../components/MobileTsdTab";
import WarehouseLocationsPanel from "../components/WarehouseLocationsPanel";
import PalletFlow from "../components/tsd/PalletFlow";
import { WAREHOUSE_EMBEDDED_ICONS } from "../assets/warehouse/embeddedIcons";
import holdsImage from "../assets/warehouse/holds.png";
import crossdockImage from "../assets/warehouse/crossdock.png";


const API = API_BASE;
const PURCHASE_ORDERS_CACHE_KEY = "warehouse_purchase_orders_cache_v1";

const WAREHOUSE_EMOJI = {
  requests: "📦",
  tasks: "✅",
  inventory: "🧾",
  holds: "🔒",
  movement: "\uD83D\uDCE6",
  transactions: "\uD83D\uDD01",
  revision: "\uD83E\uDDFE",
  locations: "📍",
  items: "📦",
  queue: "🚚",
  tsd: "📱",
  crossdock: "🧱",
  qr: "🏷️",
  receive: "📦",
  ship: "🚚",
  audit: "🧾",
  moves: "🔁",
  suppliers: "🏭",
  docs: "🗂️",
};

const WAREHOUSE_ICON_FALLBACK = {
  requests: "REQ",
  tasks: "TASK",
  inventory: "INV",
  holds: "HOLD",
  movement: "\uD83D\uDCE6",
  transactions: "\uD83D\uDD01",
  locations: "LOC",
  items: "\u0422\u041e\u0412",
  queue: "QUEUE",
  tsd: "TSD",
  crossdock: "XD",
  qr: "QR",
  receive: "IN",
  ship: "OUT",
  audit: "AUD",
  moves: "MOV",
  suppliers: "SUP",
  docs: "DOC",
  revision: "REV",
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

function normalizeWarehouseSectionKey(sectionKey) {
  return sectionKey === "transactions" ? "movement" : sectionKey;
}

const WAREHOUSE_IMAGE = {
  tasks: WAREHOUSE_EMBEDDED_ICONS.tasks,
  inventory: WAREHOUSE_EMBEDDED_ICONS.inventory,
  holds: holdsImage,
  movement: WAREHOUSE_EMBEDDED_ICONS.movement,
  transactions: WAREHOUSE_EMBEDDED_ICONS.transactions,
  revision: WAREHOUSE_EMBEDDED_ICONS.revision,
  suppliers: WAREHOUSE_EMBEDDED_ICONS.suppliers,
  locations: WAREHOUSE_EMBEDDED_ICONS.locations,
  items: WAREHOUSE_EMBEDDED_ICONS.inventory,
  queue: WAREHOUSE_EMBEDDED_ICONS.queue,
  tsd: WAREHOUSE_EMBEDDED_ICONS.tsd,
  crossdock: crossdockImage,
};

function WarehouseTileIcon({ name }) {
  const image = WAREHOUSE_IMAGE[name] || null;
  if (image) {
    return (
      <img
        className="warehouse-card__icon-image"
        src={image}
        alt=""
        aria-hidden="true"
        loading="eager"
        decoding="sync"
        fetchPriority="high"
      />
    );
  }

  const emoji = WAREHOUSE_EMOJI[name];
  const fallback = WAREHOUSE_ICON_FALLBACK[name] || "•";

  if (!emoji) {
    return (
      <span className="warehouse-card__icon-symbol" aria-hidden="true">
        {fallback}
      </span>
    );
  }

  return (
    <span
      className="warehouse-card__icon-symbol"
      role="img"
      aria-label={name}
      title={name}
    >
      {emoji}
    </span>
  );
}


const TYPE_LABELS = {

  ISSUE: "Выдача со склада",

  RETURN: "Возврат на склад",

  INCOME: "Приход (приёмка)",

};



const STATUS_LABELS = {

  NEW: "Новая",

  IN_PROGRESS: "В работе",

  DONE: "Выполнена",

  REJECTED: "Отклонена",

  PENDING: "Ожидает",

  APPROVED: "Одобрено",

  COMPLETED: "Выдано",

};



const STATUS_OPTIONS = [

  { value: "NEW", label: "Новая" },

  { value: "IN_PROGRESS", label: "В работе" },

  { value: "DONE", label: "Выполнена" },

  { value: "REJECTED", label: "Отклонена" },

];



const TASK_STATUS_LABELS = {

  NEW: "Не выполнено",
  IN_PROGRESS: "Не выполнено",
  DONE: "Выполнено",
  CANCELLED: "Не выполнено",

};



const TASK_STATUS_OPTIONS = [

  { value: "NEW", label: "Не выполнено" },
  { value: "DONE", label: "Выполнено" },

];

const TASK_ATTACHMENT_MAX_COUNT = 5;
const TASK_ATTACHMENT_MAX_BYTES = 2 * 1024 * 1024;
const TASK_ATTACHMENT_MAX_SIDE = 1400;
const TASK_ATTACHMENT_ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const TASK_TIME_ZONE = "Europe/Moscow";

function formatTaskDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: TASK_TIME_ZONE,
  });
}

async function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Не удалось прочитать фото."));
    reader.readAsDataURL(file);
  });
}

async function prepareTaskAttachmentDataUrl(file) {
  const initialDataUrl = await fileToDataUrl(file);
  const image = await new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Не удалось обработать фото."));
    img.src = initialDataUrl;
  });
  const srcW = Number(image.width) || 0;
  const srcH = Number(image.height) || 0;
  if (!srcW || !srcH) return initialDataUrl;

  const scale = Math.min(1, TASK_ATTACHMENT_MAX_SIDE / Math.max(srcW, srcH));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(srcW * scale));
  canvas.height = Math.max(1, Math.round(srcH * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) return initialDataUrl;
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

  const preferredType =
    TASK_ATTACHMENT_ALLOWED_TYPES.has(String(file?.type || "").toLowerCase()) &&
    String(file?.type || "").toLowerCase() !== "image/png"
      ? String(file.type).toLowerCase()
      : "image/jpeg";

  const qualitySteps = [0.9, 0.82, 0.74, 0.66, 0.58];
  for (const quality of qualitySteps) {
    const dataUrl = canvas.toDataURL(preferredType, quality);
    const estimatedBytes = Math.floor((dataUrl.length * 3) / 4);
    if (estimatedBytes <= TASK_ATTACHMENT_MAX_BYTES) return dataUrl;
  }
  return canvas.toDataURL("image/jpeg", 0.55);
}

async function buildTaskAttachmentPayload(file) {
  const mimeType = String(file?.type || "").toLowerCase();
  if (!TASK_ATTACHMENT_ALLOWED_TYPES.has(mimeType)) {
    throw new Error("Допустимы только фото JPG, PNG или WEBP.");
  }
  const dataUrl = await prepareTaskAttachmentDataUrl(file);
  const sizeBytes = Math.floor((dataUrl.length * 3) / 4);
  if (sizeBytes > TASK_ATTACHMENT_MAX_BYTES) {
    throw new Error("Одно фото слишком большое. Максимум 2 МБ.");
  }
  return {
    fileName: String(file?.name || "photo.jpg"),
    mimeType: mimeType || "image/jpeg",
    sizeBytes,
    dataUrl,
  };
}



const PO_STATUS_LABELS = {
  DRAFT: "\u0427\u0435\u0440\u043d\u043e\u0432\u0438\u043a",
  SENT: "\u041e\u0442\u043f\u0440\u0430\u0432\u043b\u0435\u043d \u043f\u043e\u0441\u0442\u0430\u0432\u0449\u0438\u043a\u0443",
  PARTIAL: "\u0427\u0430\u0441\u0442\u0438\u0447\u043d\u043e",
  RECEIVED: "\u041f\u043e\u043b\u0443\u0447\u0435\u043d",
  CLOSED: "\u0417\u0430\u043a\u0440\u044b\u0442",
};


export default function Warehouse({
  allowedSections,
  pageTitle = "\u0421\u043a\u043b\u0430\u0434",
  pageSubtitle = "\u0417\u0430\u0434\u0430\u0447\u0438 \u0438 \u0443\u0447\u0451\u0442 \u043e\u0441\u0442\u0430\u0442\u043a\u043e\u0432 \u043d\u0430 \u0441\u043a\u043b\u0430\u0434\u0435.",
}) {

  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const isWarehouseManager =
    user?.role === "ADMIN" ||
    hasPermission(user, PERMISSION_KEYS.WAREHOUSE_MANAGE);



  const defaultSections = [
    "tasks",
    "inventory",
    "holds",
    "movement",
    "transactions",
    "revision",
    "suppliers",
    "locations",
    "items",
    "queue",
    "tsd",
    "crossdock",
  ];

  const permissionAllowedSections = useMemo(
    () => {
      const allowedRaw = defaultSections.filter((sectionKey) =>
        hasPermission(user, WAREHOUSE_SECTION_PERMISSION_MAP[sectionKey])
      );
      if (
        hasPermission(user, PERMISSION_KEYS.APP_WAREHOUSE) &&
        !allowedRaw.includes("tasks")
      ) {
        allowedRaw.unshift("tasks");
      }
      return Array.from(
        new Set(
          allowedRaw.map((sectionKey) => normalizeWarehouseSectionKey(sectionKey))
        )
      );
    },
    [user]
  );

  const sections = useMemo(() => {
    const baseSections =
      Array.isArray(allowedSections) && allowedSections.length > 0
        ? allowedSections
        : defaultSections;
    const normalizedBaseSections = Array.from(
      new Set(
        baseSections.map((sectionKey) => normalizeWarehouseSectionKey(sectionKey))
      )
    );
    return normalizedBaseSections.filter((sectionKey) =>
      permissionAllowedSections.includes(sectionKey)
    );
  }, [allowedSections, permissionAllowedSections]);

  const sectionSet = useMemo(() => new Set(sections), [sections]);
  const canRequests = sectionSet.has("requests");
  const canTasks = sectionSet.has("tasks");
  const canInventory = sectionSet.has("inventory");
  const canMovement = sectionSet.has("movement");
  const canSuppliers = sectionSet.has("suppliers");

  const [section, setSection] = useState("");
  const [crossdockTab, setCrossdockTab] = useState("");

  useEffect(() => {
    if (!sections || sections.length === 0) {
      if (section) setSection("");
      return;
    }
    if (section && !sections.includes(section)) {
      setSection("");
    }
  }, [section, sections]);

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, []);


  const requestsRef = useRef(null);
  const tasksRef = useRef(null);
  const inventoryRef = useRef(null);
  const holdsRef = useRef(null);
  const locationsRef = useRef(null);
  const queueRef = useRef(null);
  const tsdRef = useRef(null);
  const revisionRef = useRef(null);
  const purchaseOrdersLoadSeqRef = useRef(0);
  const purchaseOrdersRef = useRef([]);

  const [requestsTab, setRequestsTab] = useState("new"); // 'new' | 'journal'



  // ===== ЗАЯВКИ НА СКЛАД =====

  const [requestForm, setRequestForm] = useState({
    itemId: "",
    quantity: "",
    description: "",
  });
  const [requestItemQuery, setRequestItemQuery] = useState("");



  const [myList, setMyList] = useState([]);

  const [allList, setAllList] = useState([]);

  const [filterStatus, setFilterStatus] = useState("ALL");

  const [filterText, setFilterText] = useState("");

  const [loading, setLoading] = useState(true);

  const [saving, setSaving] = useState(false);

  const [statusSavingId, setStatusSavingId] = useState(null);

  const [error, setError] = useState("");

  const [postingId, setPostingId] = useState(null);

  const [postMessage, setPostMessage] = useState("");



  // ===== ЗАДАЧИ СКЛАДА =====

  const [taskForm, setTaskForm] = useState({

    title: "",

    description: "",

    dueDate: "",

    executorUserId: "",

  });

  const [taskExecutors, setTaskExecutors] = useState([]);



  const [taskMyList, setTaskMyList] = useState([]);

  const [taskAllList, setTaskAllList] = useState([]);

    const [taskView, setTaskView] = useState("new"); // 'new' | 'journal'

  useEffect(() => {
    const params = new URLSearchParams(location.search || "");
    const sectionParam = normalizeWarehouseSectionKey(
      String(params.get("section") || "").trim()
    );
    const taskViewParam = params.get("taskView");
    const crossdockTabParam = String(params.get("crossdockTab") || "").trim();

    if (sectionParam && sectionSet.has(sectionParam)) {
      setSection(sectionParam);
    }

    if (sectionParam === "crossdock" && CROSSDOCK_TAB_IDS.has(crossdockTabParam)) {
      setCrossdockTab(crossdockTabParam);
    } else {
      setCrossdockTab("");
    }

    if (
      sectionParam === "tasks" &&
      (taskViewParam === "new" || taskViewParam === "journal")
    ) {
      setTaskView(taskViewParam);
    }
  }, [location.search, sectionSet]);

  const [taskTab, setTaskTab] = useState("my");

  const [taskFilterStatus, setTaskFilterStatus] = useState("ALL");

  const [taskFilterText, setTaskFilterText] = useState("");

  const [tasksLoading, setTasksLoading] = useState(true);

  const [taskSaving, setTaskSaving] = useState(false);

  const [taskStatusSavingId, setTaskStatusSavingId] = useState(null);
  const [taskResponseSavingId, setTaskResponseSavingId] = useState(null);

  const [taskError, setTaskError] = useState("");
  const [taskInfo, setTaskInfo] = useState("");
  const [taskPhotoFiles, setTaskPhotoFiles] = useState([]);
  const [taskResponseDrafts, setTaskResponseDrafts] = useState({});
  const [taskResponsePhotoFiles, setTaskResponsePhotoFiles] = useState({});
  const [taskPhotoPreview, setTaskPhotoPreview] = useState(null);
  const [taskDetailsId, setTaskDetailsId] = useState(null);



  // ===== ИНВЕНТАРИЗАЦИЯ / ОСТАТКИ / ПОСТАВЩИКИ / ЗАКУПКИ =====

  const [inventoryItems, setInventoryItems] = useState([]);

  const [inventoryStock, setInventoryStock] = useState([]);

  const [inventoryLoading, setInventoryLoading] = useState(true);

  const [inventoryError, setInventoryError] = useState("");

  const [requestStock, setRequestStock] = useState([]);


  const [inventoryTab, setInventoryTab] = useState("stock"); // stock | movement | suppliers
  const [movementTab, setMovementTab] = useState("movementsHistory"); // movementsHistory
  const [suppliersTab, setSuppliersTab] = useState("suppliers"); // suppliers | orders

  useEffect(() => {
    if (!section) {
      return;
    }
    if (section === "inventory") {
      setInventoryTab("stock");
      return;
    }
    if (section === "movement") {
      setInventoryTab("movement");
      setMovementTab((prev) => prev || "movementsHistory");
      return;
    }
    if (section === "suppliers") {
      setInventoryTab("suppliers");
      setSuppliersTab((prev) => prev || "suppliers");
    }
  }, [section]);

  const [itemForm, setItemForm] = useState({

    name: "",

    sku: "",

    barcode: "",

    unit: "",

    minStock: "",

    maxStock: "",

    defaultPrice: "",

  });



  const [movementForm, setMovementForm] = useState({

    itemId: "",

    type: "INCOME",

    quantity: "",

    pricePerUnit: "",

    comment: "",

  });



  // Поставщики

  const [suppliers, setSuppliers] = useState([]);

  const [suppliersLoading, setSuppliersLoading] = useState(false);

  const [suppliersError, setSuppliersError] = useState("");

  const [supplierForm, setSupplierForm] = useState({

    name: "",

    inn: "",

    phone: "",

    email: "",

    comment: "",

  });



  // Заказы поставщику

  const [purchaseOrders, setPurchaseOrders] = useState(() => {
    try {
      const raw = localStorage.getItem(PURCHASE_ORDERS_CACHE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });

  const [purchaseOrdersLoading, setPurchaseOrdersLoading] = useState(false);

  const [purchaseOrdersError, setPurchaseOrdersError] = useState("");

  const [showOrderModal, setShowOrderModal] = useState(false);

  const [orderItemsForModal, setOrderItemsForModal] = useState([]);

  const [viewPurchaseOrder, setViewPurchaseOrder] = useState(null);
  const [viewPurchaseOrderLoading, setViewPurchaseOrderLoading] = useState(false);
  const [viewPurchaseOrderError, setViewPurchaseOrderError] = useState("");
  const [viewPurchaseOrderActionLoading, setViewPurchaseOrderActionLoading] = useState(false);
  const [viewPurchaseOrderActionNotice, setViewPurchaseOrderActionNotice] = useState("");

  const [showReceiveModal, setShowReceiveModal] = useState(false);

  useEffect(() => {
    const safeList = Array.isArray(purchaseOrders) ? purchaseOrders : [];
    purchaseOrdersRef.current = safeList;
    try {
      localStorage.setItem(PURCHASE_ORDERS_CACHE_KEY, JSON.stringify(safeList));
    } catch {
      // ignore localStorage errors on private mode/quota
    }
  }, [purchaseOrders]);



  const token = localStorage.getItem("token");

  const authHeaders = {

    Authorization: `Bearer ${token}`,

    "Content-Type": "application/json",

  };

  const readResponsePayload = async (res) => {
    try {
      return await res.json();
    } catch {
      return null;
    }
  };

  const resolveErrorMessage = (err, fallback) =>
    normalizeErrorMessage(err, fallback);

  const isTransientPurchaseOrderError = (message) => {
    const text = String(message || "").toLowerCase();
    return (
      text.includes("failed to fetch") ||
      text.includes("networkerror") ||
      text.includes("aborterror") ||
      text.includes("timeout") ||
      text.includes("подключ") ||
      text.includes("время ожидания")
    );
  };



  // ===== API: ЗАЯВКИ =====

  const loadRequests = async () => {

    try {

      setLoading(true);

      setError("");

      setPostMessage("");



      const myRes = await fetch(`${API}/warehouse/requests/my`, {

        headers: authHeaders,

      });

      const myData = await myRes.json();

      if (!myRes.ok) {

        throw new Error(myData.message || "Ошибка загрузки ваших заявок");

      }

      setMyList(myData);



      if (isWarehouseManager) {

        const allRes = await fetch(`${API}/warehouse/requests`, {

          headers: { Authorization: authHeaders.Authorization },

        });

        const allData = await allRes.json();

        if (!allRes.ok) {

          throw new Error(

            allData.message || "Ошибка загрузки складских заявок"

          );

        }

        setAllList(allData);

      } else {

        setAllList([]);

      }

    } catch (e) {

      console.error(e);

      setError(e.message);

    } finally {

      setLoading(false);

    }

  };



  // ===== API: ЗАДАЧИ =====

  const loadTasks = async () => {

    try {

      setTasksLoading(true);

      setTaskError("");



      const myRes = await fetch(`${API}/warehouse/tasks/my`, {

        headers: authHeaders,

      });

      const myData = await myRes.json();

      if (!myRes.ok) {

        throw new Error(myData.message || "Ошибка загрузки ваших задач склада");

      }

      setTaskMyList(myData);



      if (isWarehouseManager) {

        const allRes = await fetch(`${API}/warehouse/tasks`, {

          headers: { Authorization: authHeaders.Authorization },

        });

        const allData = await allRes.json();

        if (!allRes.ok) {

          throw new Error(allData.message || "Ошибка загрузки задач склада");

        }

        setTaskAllList(allData);

      } else {

        setTaskAllList([]);

      }

    } catch (e) {

      console.error(e);

      setTaskError(e.message);

    } finally {

      setTasksLoading(false);

    }

  };

  const loadTaskExecutors = async () => {
    if (!isWarehouseManager) {
      setTaskExecutors([]);
      return;
    }
    try {
      const res = await fetch(`${API}/warehouse/tasks/executors`, {
        headers: authHeaders,
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || "Ошибка загрузки исполнителей");
      }
      setTaskExecutors(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error(e);
      setTaskError(e.message || "Ошибка загрузки исполнителей");
    }
  };



  // ===== API: ИНВЕНТАРИЗАЦИЯ / ОСТАТКИ =====

  const loadInventory = async () => {

    try {

      setInventoryLoading(true);

      setInventoryError("");



      const [itemsRes, stockRes] = await Promise.all([

        fetch(`${API}/inventory/items`, {

          headers: { Authorization: authHeaders.Authorization },

        }),

        fetch(`${API}/inventory/stock`, {

          headers: { Authorization: authHeaders.Authorization },

        }),

      ]);



      const itemsData = await itemsRes.json();

      const stockData = await stockRes.json();



      if (!itemsRes.ok) {

        throw new Error(itemsData.message || "Ошибка загрузки товаров");

      }

      if (!stockRes.ok) {

        throw new Error(stockData.message || "Ошибка загрузки остатков");

      }



      setInventoryItems(itemsData);

      setInventoryStock(stockData);

    } catch (e) {

      console.error(e);

      setInventoryError(e.message);

    } finally {

      setInventoryLoading(false);

    }

  };

  const loadRequestStock = async () => {
    try {
      const res = await fetch(`${API}/inventory/stock`, {
        headers: { Authorization: authHeaders.Authorization },
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || "Ошибка загрузки остатков для заявок");
      }
      const normalized = Array.isArray(data)
        ? data.map((item) => ({
            ...item,
            currentStock: Number(item?.availableStock ?? item?.currentStock ?? 0),
          }))
        : [];
      setRequestStock(normalized);
    } catch (e) {
      console.error(e);
      setError(e.message || "Ошибка загрузки остатков для заявок");
    }
  };



  const loadSuppliers = async () => {

    try {

      setSuppliersLoading(true);

      setSuppliersError("");



      const res = await fetch(`${API}/suppliers`, {

        headers: { Authorization: authHeaders.Authorization },

      });

      const data = await readResponsePayload(res);



      if (!res.ok) {

        const message =
          data && typeof data.message === "string"
            ? data.message
            : "Ошибка загрузки поставщиков.";
        throw new Error(message);

      }



      if (!Array.isArray(data)) {
        throw new Error("Сервер вернул некорректный список поставщиков.");
      }

      setSuppliers(data);

    } catch (e) {

      console.error(e);

      setSuppliersError(resolveErrorMessage(e, "Ошибка загрузки поставщиков."));

    } finally {

      setSuppliersLoading(false);

    }

  };



  const loadPurchaseOrders = async () => {
    const requestSeq = purchaseOrdersLoadSeqRef.current + 1;
    purchaseOrdersLoadSeqRef.current = requestSeq;
    const loadOnce = async () => {
      const res = await fetch(`${API}/purchase-orders`, {
        headers: { Authorization: authHeaders.Authorization },
      });
      const data = await readResponsePayload(res);
      if (!res.ok) {
        const message =
          data && typeof data.message === "string"
            ? data.message
            : "Ошибка загрузки заказов поставщику.";
        throw new Error(message);
      }
      if (!Array.isArray(data)) {
        throw new Error("Сервер вернул некорректный список заказов поставщику.");
      }
      return data;
    };

    try {

      setPurchaseOrdersLoading(true);

      setPurchaseOrdersError("");



      let data;
      try {
        data = await loadOnce();
      } catch (firstError) {
        const firstMessage = resolveErrorMessage(
          firstError,
          "Ошибка загрузки заказов поставщику."
        );
        if (!isTransientPurchaseOrderError(firstMessage)) {
          throw firstError;
        }
        await new Promise((resolve) => setTimeout(resolve, 350));
        data = await loadOnce();
      }

      if (purchaseOrdersLoadSeqRef.current !== requestSeq) {
        return;
      }
      setPurchaseOrders(data);

    } catch (e) {
      if (purchaseOrdersLoadSeqRef.current !== requestSeq) {
        return;
      }

      console.error(e);

      const message = resolveErrorMessage(
        e,
        "Ошибка загрузки заказов поставщику."
      );
      const hasVisibleOrders = (purchaseOrdersRef.current || []).length > 0;
      if (!hasVisibleOrders || !isTransientPurchaseOrderError(message)) {
        setPurchaseOrdersError(message);
      }

    } finally {
      if (purchaseOrdersLoadSeqRef.current !== requestSeq) {
        return;
      }

      setPurchaseOrdersLoading(false);

    }

  };



  // ===== useEffects =====

  useEffect(() => {
    if (canRequests) {
      loadRequests();
    }
    if (canTasks) {
      loadTasks();
    }
    if (canInventory || canMovement || canSuppliers) {
      loadInventory();
    }
    if (canRequests) {
      loadRequestStock();
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canRequests, canTasks, canInventory, canMovement, canSuppliers]);



  useEffect(() => {

    const loadItemsForSuggestions = async () => {
      if (!canInventory && !canMovement && !canSuppliers) {
        return;
      }

      try {

        const res = await fetch(`${API}/inventory/items`, {

          headers: { Authorization: authHeaders.Authorization },

        });

        const data = await res.json();

        if (res.ok) {

          setInventoryItems(data);

        } else {

          console.error("Ошибка загрузки номенклатуры:", data);

        }

      } catch (e) {

        console.error("Ошибка загрузки номенклатуры:", e);

      }

    };



    loadItemsForSuggestions();

    // eslint-disable-next-line react-hooks/exhaustive-deps

  }, [canInventory, canMovement, canSuppliers]);



  useEffect(() => {

    if (section !== "tasks") return;
    if (!canTasks) return;

    loadTasks();
    loadTaskExecutors();

    // eslint-disable-next-line react-hooks/exhaustive-deps

  }, [section, canTasks]);

  useEffect(() => {
    if (section === "tasks" && !isWarehouseManager) {
      setTaskView("journal");
    }
  }, [section, isWarehouseManager]);



  useEffect(() => {
    if (section !== "requests") return;
    if (!canRequests) return;
    loadRequestStock();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section, canRequests]);



  useEffect(() => {

    const isInventoryScope =
      section === "inventory" || section === "movement" || section === "suppliers";
    if (!isInventoryScope) return;
    if (
      (section === "inventory" && !canInventory) ||
      (section === "movement" && !canMovement) ||
      (section === "suppliers" && !canSuppliers)
    ) {
      return;
    }

    const loadData = async () => {
      try {
        await loadInventory();
        if (section === "suppliers") {
          await loadSuppliers();
          await loadPurchaseOrders();
        }
      } catch (e) {
        console.error(e);
        setInventoryError(e.message);
      }
    };

    loadData();

    // eslint-disable-next-line react-hooks/exhaustive-deps

  }, [section, canInventory, canMovement, canSuppliers]);



  // ===== ХЕЛПЕРЫ ДЛЯ ЗАЯВОК =====

  const handleCreateRequest = async (e) => {

    e.preventDefault();

    setSaving(true);

    setError("");

    setPostMessage("");



    try {

      const selectedItem = selectedRequestItem;
      if (!selectedItem) {
        setSaving(false);
        return setError("Выберите товар.");
      }

      const title = selectedItem.name;
      const qty = Number(requestForm.quantity);
      const available = Number(selectedItem.currentStock ?? 0);

      if (!Number.isFinite(qty) || !Number.isInteger(qty) || qty <= 0) {
        setSaving(false);
        return setError("Количество должно быть положительным целым числом.");
      }

      if (available <= 0) {
        setSaving(false);
        return setError("По выбранной позиции нет остатка.");
      }

      if (qty > available) {
        setSaving(false);
        return setError(
          `Недостаточно остатка. Доступно ${available} ${selectedItem.unit || "шт."}.`
        );
      }

      const body = {
        title,
        type: "ISSUE",
        comment: requestForm.description?.trim() || null,
        items: [
          {
            itemId: selectedItem.id,
            name: title,
            quantity: qty,
            unit: selectedItem.unit || "??",
          },
        ],
      };



      const res = await fetch(`${API}/warehouse/requests`, {

        method: "POST",

        headers: authHeaders,

        body: JSON.stringify(body),

      });



      const data = await res.json();

      if (!res.ok) {

        throw new Error(data.message || "Ошибка создания заявки на склад");

      }



      setRequestForm({
        itemId: "",
        quantity: "",
        description: "",
      });



      await loadRequests();

    } catch (e) {

      console.error(e);

      setError(e.message);

    } finally {

      setSaving(false);

    }

  };

  const handleCreateReplenishRequest = async () => {
    try {
      setSaving(true);
      setError("");
      setPostMessage("");

      const selectedItem = selectedRequestItem;
      if (!selectedItem) {
        return setError("Выберите товар.");
      }

      const qty = Number(requestForm.quantity);
      const replenishQty =
        Number.isFinite(qty) && qty > 0 ? Math.floor(qty) : 1;

      const body = {
        title: `Пополнение: ${selectedItem.name}`,
        type: "INCOME",
        comment: requestForm.description?.trim()
          ? `Автозаявка на пополнение. ${requestForm.description.trim()}`
          : "Автозаявка на пополнение.",
        items: [
          {
            itemId: selectedItem.id,
            name: selectedItem.name,
            quantity: replenishQty,
            unit: selectedItem.unit || "шт",
          },
        ],
      };

      const res = await fetch(`${API}/warehouse/requests`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          data.message || "Не удалось создать заявку на пополнение."
        );
      }

      setRequestForm({
        itemId: "",
        quantity: "",
        description: "",
      });
      await loadRequests();
      setPostMessage("Заявка на пополнение создана.");
    } catch (e) {
      console.error(e);
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };



  const handleStatusChangeLocal = (id, newStatus) => {

    setAllList((prev) =>

      prev.map((r) => (r.id === id ? { ...r, status: newStatus } : r))

    );

  };



  const handleStatusSave = async (id) => {

    const row = allList.find((r) => r.id === id);

    if (!row) return;



    const statusComment =

      prompt("Комментарий склада (необязательно):") || undefined;



    setStatusSavingId(id);

    setError("");

    setPostMessage("");



    try {

      const res = await fetch(`${API}/warehouse/requests/${id}/status`, {

        method: "PUT",

        headers: authHeaders,

        body: JSON.stringify({

          status: row.status,

          statusComment,

        }),

      });



      const data = await res.json();

      if (!res.ok) {

        throw new Error(data.message || "Ошибка изменения статуса");

      }



      await loadRequests();

    } catch (e) {

      console.error(e);

      setError(e.message);

    } finally {

      setStatusSavingId(null);

    }

  };



  const statusBadgeClass = (status) => {

    if (status === "REJECTED") return "badge badge--rejected";

    if (status === "DONE" || status === "COMPLETED" || status === "APPROVED")

      return "badge badge--approved";

    if (status === "IN_PROGRESS" || status === "PENDING")

      return "badge badge--pending";

    return "badge badge--pending";

  };



  const statusLabel = (status) => {

    return STATUS_LABELS[status] || status;

  };



  // какой список показывать

  const listForTab = isWarehouseManager ? allList : myList;



  const filteredRequests = useMemo(() => {

    let res = listForTab;



    if (filterStatus !== "ALL") {

      res = res.filter((r) => r.status === filterStatus);

    }



    if (filterText.trim()) {

      const q = filterText.trim().toLowerCase();

      res = res.filter((r) => {

        const text = [

          r.title,

          r.description,

          r.author?.name,

          r.author?.email,

        ]

          .filter(Boolean)

          .join(" ")

          .toLowerCase();



        return text.includes(q);

      });

    }



    return res;

  }, [listForTab, filterStatus, filterText]);



  // Товары для выпадающего списка в заявке
  const requestStockItems = useMemo(() => requestStock || [], [requestStock]);
  const filteredRequestItems = useMemo(() => {
    const q = requestItemQuery.trim().toLowerCase();
    if (!q) return requestStockItems;
    return requestStockItems.filter((item) =>
      String(item.name || "").toLowerCase().includes(q)
    );
  }, [requestStockItems, requestItemQuery]);
  const selectedRequestItem = useMemo(
    () =>
      requestStockItems.find((it) => String(it.id) === String(requestForm.itemId)),
    [requestStockItems, requestForm.itemId]
  );



  // ===== ХЕЛПЕРЫ ДЛЯ ЗАДАЧ =====

  const handleTaskPhotoPick = (event) => {
    const picked = Array.from(event.target.files || []);
    event.target.value = "";
    if (!picked.length) return;
    setTaskError("");
    setTaskPhotoFiles((prev) => {
      const existingKeys = new Set(
        prev.map((file) => `${file.name}-${file.size}-${file.lastModified}`)
      );
      const next = [...prev];
      for (const file of picked) {
        const key = `${file.name}-${file.size}-${file.lastModified}`;
        if (!existingKeys.has(key)) {
          next.push(file);
          existingKeys.add(key);
        }
      }
      if (next.length > TASK_ATTACHMENT_MAX_COUNT) {
        setTaskError(`Можно прикрепить не более ${TASK_ATTACHMENT_MAX_COUNT} фото.`);
        return next.slice(0, TASK_ATTACHMENT_MAX_COUNT);
      }
      return next;
    });
  };

  const removeTaskPhoto = (indexToRemove) => {
    setTaskPhotoFiles((prev) => prev.filter((_, index) => index !== indexToRemove));
  };

  const handleTaskResponsePhotoPick = (taskId, event) => {
    const picked = Array.from(event.target.files || []);
    event.target.value = "";
    if (!picked.length) return;
    setTaskError("");
    setTaskResponsePhotoFiles((prev) => {
      const current = Array.isArray(prev[taskId]) ? prev[taskId] : [];
      const existingKeys = new Set(
        current.map((file) => `${file.name}-${file.size}-${file.lastModified}`)
      );
      const next = [...current];
      for (const file of picked) {
        const key = `${file.name}-${file.size}-${file.lastModified}`;
        if (!existingKeys.has(key)) {
          next.push(file);
          existingKeys.add(key);
        }
      }
      if (next.length > TASK_ATTACHMENT_MAX_COUNT) {
        setTaskError(`Можно прикрепить не более ${TASK_ATTACHMENT_MAX_COUNT} фото.`);
      }
      return {
        ...prev,
        [taskId]: next.slice(0, TASK_ATTACHMENT_MAX_COUNT),
      };
    });
  };

  const removeTaskResponsePhoto = (taskId, indexToRemove) => {
    setTaskResponsePhotoFiles((prev) => {
      const current = Array.isArray(prev[taskId]) ? prev[taskId] : [];
      return {
        ...prev,
        [taskId]: current.filter((_, index) => index !== indexToRemove),
      };
    });
  };

  const openTaskPhotoPreview = (event, photo, fallbackTitle) => {
    event.preventDefault();
    const url = String(photo?.dataUrl || "").trim();
    if (!url) return;
    setTaskPhotoPreview({
      url,
      title: String(photo?.fileName || fallbackTitle || "Фото").trim() || "Фото",
    });
  };

  const closeTaskPhotoPreview = () => {
    setTaskPhotoPreview(null);
  };

  const handleCreateTask = async (e) => {

    e.preventDefault();

    setTaskSaving(true);

    setTaskError("");
    setTaskInfo("");



    try {

      const taskPhotos = [];
      for (const file of taskPhotoFiles) {
        taskPhotos.push(await buildTaskAttachmentPayload(file));
      }

      const body = {

        title: taskForm.title.trim(),

        description: taskForm.description?.trim() || null,

        taskPhotos,

        dueDate: taskForm.dueDate
          ? new Date(taskForm.dueDate).toISOString()
          : null,

        executorUserId: taskForm.executorUserId
          ? Number(taskForm.executorUserId)
          : null,

      };



      const res = await fetch(`${API}/warehouse/tasks`, {

        method: "POST",

        headers: authHeaders,

        body: JSON.stringify(body),

      });



      const data = await res.json();

      if (!res.ok) {

        throw new Error(data.message || "Ошибка создания задачи");

      }

      const pushDelivery = data?.pushDelivery || null;
      if (pushDelivery && Number(pushDelivery.delivered || 0) < 1) {
        if (pushDelivery.enabled === false) {
          setTaskInfo(
            "Задача создана, но push на сервере отключены. Проверьте WEB_PUSH_PUBLIC_KEY и WEB_PUSH_PRIVATE_KEY."
          );
        } else if (pushDelivery.reason === "NO_SUBSCRIPTIONS") {
          setTaskInfo(
            "Задача создана, но push не отправлен: у исполнителя нет активной push-подписки (нужно открыть приложение на телефоне и разрешить уведомления)."
          );
        } else if (pushDelivery.reason === "SUBSCRIPTIONS_EXPIRED") {
          setTaskInfo(
            "Задача создана, но push-подписка исполнителя устарела. Исполнителю нужно заново открыть приложение и разрешить уведомления."
          );
        } else {
          setTaskInfo(
            "Задача создана, но push не доставлен. Проверьте у сотрудника разрешение уведомлений и откройте приложение заново."
          );
        }
      }


      setTaskForm({

        title: "",

        description: "",

        dueDate: "",

        executorUserId: "",

      });
      setTaskPhotoFiles([]);



      await loadTasks();

    } catch (e) {

      console.error(e);

      setTaskError(e.message);

    } finally {

      setTaskSaving(false);

    }

  };

  const handleTaskApplyStatus = async (task, nextStatusRaw) => {
    const taskId = Number(task?.id);
    const nextStatus = normalizeTaskStatus(nextStatusRaw);
    if (!taskId) return;

    setTaskStatusSavingId(taskId);
    setTaskResponseSavingId(taskId);
    setTaskError("");

    try {
      const hasDraft = Object.prototype.hasOwnProperty.call(taskResponseDrafts, taskId);
      const responseText = String(
        hasDraft ? taskResponseDrafts[taskId] || "" : task?.responseText || ""
      )
        .trim()
        .slice(0, 5000);
      const responseFiles = Array.isArray(taskResponsePhotoFiles[taskId])
        ? taskResponsePhotoFiles[taskId]
        : [];
      const shouldSaveResponse =
        responseFiles.length > 0 || (hasDraft && responseText.length > 0);

      if (shouldSaveResponse) {
        const responsePhotos = [];
        for (const file of responseFiles) {
          responsePhotos.push(await buildTaskAttachmentPayload(file));
        }
        const responseRes = await fetch(`${API}/warehouse/tasks/${taskId}/response`, {
          method: "PUT",
          headers: authHeaders,
          body: JSON.stringify({
            responseText: responseText || null,
            responsePhotos,
          }),
        });
        const responseData = await readResponsePayload(responseRes);
        if (!responseRes.ok) {
          throw new Error(
            responseData?.message || "Ошибка сохранения ответа по задаче."
          );
        }
      }

      const statusRes = await fetch(`${API}/warehouse/tasks/${taskId}/status`, {
        method: "PUT",
        headers: authHeaders,
        body: JSON.stringify({ status: nextStatus }),
      });
      const statusData = await readResponsePayload(statusRes);
      if (!statusRes.ok) {
        throw new Error(
          statusData?.message || "Ошибка обновления статуса задачи."
        );
      }

      setTaskResponseDrafts((prev) => ({ ...prev, [taskId]: "" }));
      setTaskResponsePhotoFiles((prev) => ({ ...prev, [taskId]: [] }));
      await loadTasks();
    } catch (e) {
      console.error(e);
      setTaskError(e.message || "Ошибка обновления задачи.");
    } finally {
      setTaskResponseSavingId(null);
      setTaskStatusSavingId(null);
    }
  };



  const taskStatusBadgeClass = (status) =>
    normalizeTaskStatus(status) === "DONE"
      ? "badge badge--approved"
      : "badge badge--pending";



  const isTaskOverdue = (t) => {

    if (normalizeTaskStatus(t.status) === "DONE") return false;

    if (!t.dueDate) return false;

    return new Date(t.dueDate) < new Date();

  };



  const taskListForTab = taskTab === "my" ? taskMyList : taskAllList;



  const filteredTasks = useMemo(() => {

    let res = taskListForTab;



    if (taskFilterStatus !== "ALL") {

      res = res.filter(
        (t) => normalizeTaskStatus(t.status) === taskFilterStatus
      );

    }



    if (taskFilterText.trim()) {

      const q = taskFilterText.trim().toLowerCase();

      res = res.filter((t) => {

        const text = [

          t.title,

          t.description,

          t.responseText,

          t.responseAuthorName,

          t.executorUser?.name,

          t.executorName,

          t.assigner?.name,

          t.assigner?.email,

        ]

          .filter(Boolean)

          .join(" ")

          .toLowerCase();

        return text.includes(q);

      });

    }



    return res;

  }, [taskListForTab, taskFilterStatus, taskFilterText]);

  const canEditTaskStatus = (task) =>
    Boolean(
      isWarehouseManager ||
        (task && Number(task.executorUserId) === Number(user?.id))
    );

  const openTaskDetails = (taskId) => {
    setTaskDetailsId(Number(taskId));
  };

  const closeTaskDetails = () => {
    setTaskDetailsId(null);
  };

  const taskDetails = useMemo(() => {
    if (!taskDetailsId) return null;
    const merged = [...(taskMyList || []), ...(taskAllList || [])];
    return (
      merged.find((task) => Number(task.id) === Number(taskDetailsId)) || null
    );
  }, [taskDetailsId, taskMyList, taskAllList]);

  const taskDetailsCanEdit = canEditTaskStatus(taskDetails);
  const taskDetailsTaskPhotos = Array.isArray(taskDetails?.taskPhotos)
    ? taskDetails.taskPhotos
    : [];
  const taskDetailsResponsePhotos = Array.isArray(taskDetails?.responsePhotos)
    ? taskDetails.responsePhotos
    : [];
  const taskDetailsResponseFiles =
    taskDetails && Array.isArray(taskResponsePhotoFiles[taskDetails.id])
      ? taskResponsePhotoFiles[taskDetails.id]
      : [];
  const taskDetailsHasResponseDraft = taskDetails
    ? Object.prototype.hasOwnProperty.call(taskResponseDrafts, taskDetails.id)
    : false;
  const taskDetailsResponseDraft = taskDetails
    ? taskDetailsHasResponseDraft
      ? taskResponseDrafts[taskDetails.id]
      : taskDetails.responseText || ""
    : "";
  const taskDetailsExecutor = taskDetails
    ? taskDetails.executorUser?.name || taskDetails.executorName || "-"
    : "-";
  const taskDetailsAuthor = taskDetails
    ? taskDetails.assigner?.name || taskDetails.assigner?.email || "-"
    : "-";
  const normalizeTaskStatus = (status) =>
    String(status || "").toUpperCase() === "DONE" ? "DONE" : "NEW";
  const taskDetailsUiStatus = normalizeTaskStatus(taskDetails?.status);

  useEffect(() => {
    if (!taskDetails) return undefined;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [taskDetails]);



  // ===== ХЕЛПЕРЫ ДЛЯ ИНВЕНТАРИЗАЦИИ / ЗАКУПОК =====

  const handleCreateItem = async (e) => {

    e.preventDefault();

    setInventoryError("");



    try {

      if (!itemForm.name.trim()) {

        return setInventoryError("Наименование товара обязательно.");

      }

      if (!itemForm.sku.trim()) {

        return setInventoryError("Артикул обязателен.");

      }

      if (!itemForm.barcode.trim()) {

        return setInventoryError("Штрихкод обязателен.");

      }

      if (!itemForm.unit.trim()) {

        return setInventoryError("Единица измерения обязательна.");

      }



      const minVal = Number(itemForm.minStock);

      const maxVal = Number(itemForm.maxStock);

      const hasDefaultPrice =
        itemForm.defaultPrice !== undefined &&
        itemForm.defaultPrice !== null &&
        String(itemForm.defaultPrice).trim() !== "";
      const priceVal = hasDefaultPrice
        ? Number(String(itemForm.defaultPrice).replace(",", "."))
        : null;



      if (!Number.isFinite(minVal) || minVal <= 0) {

        return setInventoryError(

          "Минимальный остаток должен быть положительным числом."

        );

      }



      if (!Number.isFinite(maxVal) || maxVal <= 0) {

        return setInventoryError(

          "Максимальный остаток должен быть положительным числом."

        );

      }



      if (hasDefaultPrice && (!Number.isFinite(priceVal) || priceVal < 0)) {

        return setInventoryError(

          "Цена за единицу должна быть числом (0 и больше)."

        );

      }



      const body = {

        name: itemForm.name.trim(),

        sku: itemForm.sku.trim(),

        barcode: itemForm.barcode.trim(),

        unit: itemForm.unit.trim(),

        minStock: minVal,

        maxStock: maxVal,

        defaultPrice: priceVal,

      };



      const res = await fetch(`${API}/inventory/items`, {

        method: "POST",

        headers: authHeaders,

        body: JSON.stringify(body),

      });



      const data = await res.json();

      if (!res.ok) {

        throw new Error(data.message || "Ошибка создания товара");

      }



      setItemForm({

        name: "",

        sku: "",

        barcode: "",

        unit: "",

        minStock: "",

        maxStock: "",

        defaultPrice: "",

      });



      await loadInventory();

    } catch (e) {

      console.error(e);

      setInventoryError(e.message);

    }

  };



  const handleCreateMovement = async (e) => {

    e.preventDefault();

    setInventoryError("");



    try {

      if (!movementForm.itemId || !movementForm.quantity) {

        return setInventoryError("Выберите товар и укажите количество.");

      }



      const selectedItem = inventoryItems.find(

        (it) => it.id === Number(movementForm.itemId)

      );



      const body = {

        itemId: Number(movementForm.itemId),

        type: movementForm.type,

        quantity: Number(movementForm.quantity),

        comment: movementForm.comment?.trim() || null,

      };



      if (movementForm.type === "INCOME") {

        body.pricePerUnit = selectedItem?.defaultPrice

          ? Number(selectedItem.defaultPrice)

          : 0;

      }



      const res = await fetch(`${API}/inventory/movements`, {

        method: "POST",

        headers: authHeaders,

        body: JSON.stringify(body),

      });



      const data = await res.json();

      if (!res.ok) {

        throw new Error(

          data.message || "Ошибка создания движения по складу"

        );

      }



      setMovementForm((prev) => ({

        ...prev,

        quantity: "",

        pricePerUnit: "",

        comment: "",

      }));



      await loadInventory();

    } catch (e) {

      console.error(e);

      setInventoryError(e.message);

    }

  };



  const currentStockForItem = (itemId) => {

    const row = inventoryStock.find((s) => s.id === itemId);

    return row ? row.currentStock : 0;

  };



  const stockLevelColor = (row) => {

    if (!row) return {};

    const { currentStock, minStock, maxStock } = row;



    if (

      currentStock <= 0 &&

      ((minStock != null && minStock > 0) || (maxStock != null && maxStock > 0))

    ) {

      return { color: "#b91c1c", fontWeight: 600 };

    }



    if (minStock != null && currentStock < minStock) {

      return { color: "#b91c1c", fontWeight: 600 };

    }



    if (maxStock != null && currentStock > maxStock) {

      return { color: "#92400e", fontWeight: 600 };

    }



    return {};

  };



  const handleDeleteItem = async (itemId, itemName) => {

    const confirmed = window.confirm(

      `Удалить товар "${itemName}" и все движения по нему?`

    );

    if (!confirmed) return;



    try {

      setInventoryError("");

      const res = await fetch(`${API}/inventory/items/${itemId}`, {

        method: "DELETE",

        headers: {

          Authorization: authHeaders.Authorization,

        },

      });



      let data = null;

      try {

        data = await res.json();

      } catch (e) {}



      if (!res.ok) {

        throw new Error(

          (data && data.message) || "Ошибка при удалении товара"

        );

      }



      await loadInventory();

    } catch (e) {

      console.error(e);

      setInventoryError(e.message);

    }

  };



  const handleQuickIncome = (item) => {

    setMovementForm({

      itemId: item.id,

      type: "INCOME",

      quantity: "",

      pricePerUnit: item.defaultPrice || "",

      comment: "Поступление товара",

    });

    window.scrollTo({ top: 0, behavior: "smooth" });

  };



  const calculateOrderQtyForRow = (row) => {

    if (!row) return 0;

    const currentStock = Number(row.currentStock) || 0;

    const minStock = row.minStock != null ? Number(row.minStock) : 0;

    const maxStock = row.maxStock != null ? Number(row.maxStock) : 0;



    const hasMin = minStock && minStock > 0;

    const hasMax = maxStock && maxStock > 0;

    let orderQty = 0;



    if (hasMin) {

      if (currentStock < minStock) {

        orderQty = Math.max(0, Math.round(minStock - currentStock));

      }

    } else if (hasMax) {

      if (currentStock <= 0) {

        orderQty = Math.max(0, Math.round(maxStock - currentStock));

      }

    }



    return orderQty;

  };



  const handleCreateSupplier = async (e) => {

    e.preventDefault();

    setSuppliersError("");



    try {

      if (!supplierForm.name.trim()) {

        return setSuppliersError("Название поставщика обязательно.");

      }



      const body = {

        name: supplierForm.name.trim(),

        inn: supplierForm.inn?.trim() || null,

        phone: supplierForm.phone?.trim() || null,

        email: supplierForm.email?.trim() || null,

        comment: supplierForm.comment || null,

      };



      const res = await fetch(`${API}/suppliers`, {

        method: "POST",

        headers: authHeaders,

        body: JSON.stringify(body),

      });



      const data = await res.json();

      if (!res.ok) {

        throw new Error(data.message || "Ошибка создания поставщика");

      }



      setSupplierForm({

        name: "",

        inn: "",

        phone: "",

        email: "",

        comment: "",

      });



      await loadSuppliers();

    } catch (e) {

      console.error(e);

      setSuppliersError(e.message);

    }

  };



  const handleOpenPurchaseOrder = async () => {
    setInventoryError("");
    try {
      let items = inventoryItems;
      if (!items || items.length === 0) {
        const res = await fetch(`${API}/inventory/items`, {
          headers: { Authorization: authHeaders.Authorization },
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.message || "Ошибка загрузки товаров");
        }
        items = Array.isArray(data) ? data : [];
        setInventoryItems(items);
      }
      setOrderItemsForModal(items);
      setShowOrderModal(true);
    } catch (e) {
      console.error(e);
      setInventoryError(e.message || "Ошибка загрузки товаров");
    }
  };

  const handleViewPurchaseOrder = async (order) => {
    if (!order?.id) return;
    setViewPurchaseOrder(order);
    setViewPurchaseOrderError("");
    setViewPurchaseOrderActionNotice("");
    setViewPurchaseOrderLoading(true);
    try {
      const res = await fetch(`${API}/purchase-orders/${order.id}`, {
        headers: { Authorization: authHeaders.Authorization },
      });
      const data = await readResponsePayload(res);
      if (!res.ok) {
        throw new Error(
          (data && data.message) || "Ошибка загрузки заказа поставщику."
        );
      }
      setViewPurchaseOrder(data || order);
    } catch (e) {
      console.error(e);
      setViewPurchaseOrderError(
        resolveErrorMessage(e, "Ошибка загрузки заказа поставщику.")
      );
    } finally {
      setViewPurchaseOrderLoading(false);
    }
  };

  const handleCloseViewPurchaseOrder = () => {
    setViewPurchaseOrder(null);
    setViewPurchaseOrderError("");
    setViewPurchaseOrderActionNotice("");
    setViewPurchaseOrderLoading(false);
    setViewPurchaseOrderActionLoading(false);
  };



  const handlePurchaseOrderStatusReceived = async (orderId) => {

    const ok = window.confirm("Провести заказ и оприходовать товар на склад?");

    if (!ok) return;



    try {

      setPurchaseOrdersError("");



      const res = await fetch(`${API}/purchase-orders/${orderId}/status`, {

        method: "PUT",

        headers: authHeaders,

        body: JSON.stringify({ status: "RECEIVED" }),

      });



      const data = await res.json();

      if (!res.ok) {

        throw new Error(

          data.message || "Ошибка смены статуса заказа поставщику"

        );

      }



      await loadPurchaseOrders();

      await loadInventory();

    } catch (e) {

      console.error(e);

      setPurchaseOrdersError(e.message);

    }

  };

  const handlePurchaseOrderStatusSent = async (orderId) => {
    const ok = window.confirm("\u041e\u0442\u043f\u0440\u0430\u0432\u0438\u0442\u044c \u0437\u0430\u043a\u0430\u0437 \u043f\u043e\u0441\u0442\u0430\u0432\u0449\u0438\u043a\u0443 \u0438 \u0443\u0441\u0442\u0430\u043d\u043e\u0432\u0438\u0442\u044c \u0441\u0442\u0430\u0442\u0443\u0441 '\u041e\u0442\u043f\u0440\u0430\u0432\u043b\u0435\u043d \u043f\u043e\u0441\u0442\u0430\u0432\u0449\u0438\u043a\u0443'?");
    if (!ok) return;

    try {
      setViewPurchaseOrderActionLoading(true);
      setViewPurchaseOrderError("");
      setViewPurchaseOrderActionNotice("");

      const res = await fetch(`${API}/purchase-orders/${orderId}/status`, {
        method: "PUT",
        headers: authHeaders,
        body: JSON.stringify({ status: "SENT" }),
      });

      const data = await readResponsePayload(res);
      if (!res.ok) {
        throw new Error((data && data.message) || "\u041e\u0448\u0438\u0431\u043a\u0430 \u043e\u0442\u043f\u0440\u0430\u0432\u043a\u0438 \u0437\u0430\u043a\u0430\u0437\u0430 \u043f\u043e\u0441\u0442\u0430\u0432\u0449\u0438\u043a\u0443.");
      }

      if (data && typeof data === "object") {
        setViewPurchaseOrder(data);
      } else {
        setViewPurchaseOrder((prev) => (prev ? { ...prev, status: "SENT" } : prev));
      }

      if (data?.emailSent) {
        setViewPurchaseOrderActionNotice(
          `\u041f\u043e\u0441\u0442\u0430\u0432\u0449\u0438\u043a\u0443 \u043e\u0442\u043f\u0440\u0430\u0432\u043b\u0435\u043d\u043e \u043f\u0438\u0441\u044c\u043c\u043e${data.emailRecipient ? `: ${data.emailRecipient}` : ""}.`
        );
      } else if (data?.emailError) {
        setViewPurchaseOrderActionNotice(
          `\u0421\u0442\u0430\u0442\u0443\u0441 \u043e\u0431\u043d\u043e\u0432\u043b\u0451\u043d, \u043d\u043e \u043f\u0438\u0441\u044c\u043c\u043e \u043d\u0435 \u043e\u0442\u043f\u0440\u0430\u0432\u043b\u0435\u043d\u043e: ${data.emailError}`
        );
      } else if (data?.emailSkippedReason) {
        setViewPurchaseOrderActionNotice(`\u0421\u0442\u0430\u0442\u0443\u0441 \u043e\u0431\u043d\u043e\u0432\u043b\u0451\u043d: ${data.emailSkippedReason}.`);
      } else {
        setViewPurchaseOrderActionNotice("\u0421\u0442\u0430\u0442\u0443\u0441 \u0437\u0430\u043a\u0430\u0437\u0430 \u043e\u0431\u043d\u043e\u0432\u043b\u0451\u043d: \u043e\u0442\u043f\u0440\u0430\u0432\u043b\u0435\u043d \u043f\u043e\u0441\u0442\u0430\u0432\u0449\u0438\u043a\u0443.");
      }

      await loadPurchaseOrders();
    } catch (e) {
      console.error(e);
      setViewPurchaseOrderError(resolveErrorMessage(e, "\u041e\u0448\u0438\u0431\u043a\u0430 \u043e\u0442\u043f\u0440\u0430\u0432\u043a\u0438 \u0437\u0430\u043a\u0430\u0437\u0430 \u043f\u043e\u0441\u0442\u0430\u0432\u0449\u0438\u043a\u0443."));
    } finally {
      setViewPurchaseOrderActionLoading(false);
    }
  };
  const sortedPurchaseOrders = useMemo(() => {
    return [...purchaseOrders].sort((a, b) => {
      const da = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const db = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return db - da;
    });
  }, [purchaseOrders]);

  const groupedPurchaseOrders = useMemo(() => {
    const groups = [];
    for (const po of sortedPurchaseOrders) {
      const dateObj = po.createdAt ? new Date(po.createdAt) : null;
      const dateStr = dateObj
        ? dateObj.toLocaleDateString("ru-RU", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
          })
        : "Без даты";
      const timeStr = dateObj
        ? dateObj.toLocaleTimeString("ru-RU", {
            hour: "2-digit",
            minute: "2-digit",
          })
        : "-";

      const lastGroup = groups[groups.length - 1];
      if (!lastGroup || lastGroup.date !== dateStr) {
        groups.push({ date: dateStr, items: [{ po, timeStr }] });
      } else {
        lastGroup.items.push({ po, timeStr });
      }
    }
    return groups;
  }, [sortedPurchaseOrders]);

  const sectionCards = useMemo(
    () => [
      { key: "tasks", title: "Задачи склада", subtitle: "Постановка задач сотрудникам, сроки и журнал выполнения." },
      { key: "inventory", title: "\u041e\u0441\u0442\u0430\u0442\u043a\u0438", subtitle: "\u0422\u0435\u043a\u0443\u0449\u0438\u0435 \u043e\u0441\u0442\u0430\u0442\u043a\u0438 \u043f\u043e \u0441\u043a\u043b\u0430\u0434\u0443." },
      { key: "holds", title: "Блокировка остатков", subtitle: "Фиксация и снятие блокировок по товарам и ячейкам." },
      { key: "movement", title: "Операции склада", subtitle: "История движений и транзакции в одном разделе." },
      { key: "revision", title: "\u0420\u0435\u0432\u0438\u0437\u0438\u044f", subtitle: "\u0421\u043d\u0438\u043c\u043e\u043a \u0440\u0430\u0441\u0445\u043e\u0436\u0434\u0435\u043d\u0438\u0439 \u043f\u043e \u043a\u043e\u043d\u0442\u0440\u043e\u043b\u044e \u044f\u0447\u0435\u0435\u043a." },
      { key: "suppliers", title: "\u041f\u043e\u0441\u0442\u0430\u0432\u0449\u0438\u043a\u0438", subtitle: "\u041f\u043e\u0441\u0442\u0430\u0432\u0449\u0438\u043a\u0438 \u0438 \u0437\u0430\u043a\u0430\u0437\u044b \u043f\u043e\u0441\u0442\u0430\u0432\u0449\u0438\u043a\u0443." },
      { key: "locations", title: "\u0421\u043f\u0440\u0430\u0432\u043e\u0447\u043d\u0438\u043a \u044f\u0447\u0435\u0435\u043a", subtitle: "\u0421\u043e\u0437\u0434\u0430\u043d\u0438\u0435 \u044f\u0447\u0435\u0435\u043a \u0438 \u043f\u0435\u0447\u0430\u0442\u044c QR-\u044d\u0442\u0438\u043a\u0435\u0442\u043e\u043a." },
      { key: "items", title: "\u0421\u043f\u0440\u0430\u0432\u043e\u0447\u043d\u0438\u043a \u0442\u043e\u0432\u0430\u0440\u043e\u0432", subtitle: "\u0412\u044b\u0431\u043e\u0440 \u0442\u043e\u0432\u0430\u0440\u043e\u0432 \u0438 \u043f\u0435\u0447\u0430\u0442\u044c QR-\u044d\u0442\u0438\u043a\u0435\u0442\u043e\u043a." },
      { key: "queue", title: "\u041c\u0430\u0448\u0438\u043d\u044b \u043f\u043e\u0441\u0442\u0430\u0432\u0449\u0438\u043a\u043e\u0432 \u0432 \u043e\u0447\u0435\u0440\u0435\u0434\u0438", subtitle: "\u041e\u0447\u0435\u0440\u0435\u0434\u044c \u043d\u0430 \u0440\u0430\u0437\u0433\u0440\u0443\u0437\u043a\u0443, \u0432\u043e\u0440\u043e\u0442\u0430 \u0438 \u0432\u0440\u0435\u043c\u044f." },
      { key: "tsd", title: "\u041c\u043e\u0431\u0438\u043b\u044c\u043d\u044b\u0439 \u0422\u0421\u0414", subtitle: "\u0421\u043a\u0430\u043d\u0438\u0440\u043e\u0432\u0430\u043d\u0438\u0435 \u0448\u0442\u0440\u0438\u0445\u043a\u043e\u0434\u043e\u0432 \u0438 \u0431\u044b\u0441\u0442\u0440\u044b\u0435 \u043e\u043f\u0435\u0440\u0430\u0446\u0438\u0438." },
      { key: "crossdock", title: "Кросс-докинг", subtitle: "Паллетный контур: приемка, размещение, отгрузка и поиск." },
    ],
    []
  );

  const visibleSectionCards = useMemo(
    () => sectionCards.filter((card) => sectionSet.has(card.key)),
    [sectionCards, sectionSet]
  );

  const activeWarehouseTasksCount = useMemo(() => {
    const taskMap = new Map();
    [...taskMyList, ...taskAllList].forEach((task) => {
      if (task?.id != null) {
        taskMap.set(task.id, task);
      }
    });
    return Array.from(taskMap.values()).filter((task) => {
      const status = String(task?.status || "").toUpperCase();
      return status !== "DONE" && status !== "COMPLETED" && status !== "CANCELLED";
    }).length;
  }, [taskAllList, taskMyList]);

  const warehouseOverviewStats = useMemo(
    () => [
      {
        label: "Активные задачи",
        value: tasksLoading ? "..." : activeWarehouseTasksCount,
        hint: "в работе и новых",
      },
      {
        label: "Товары",
        value: inventoryLoading ? "..." : inventoryItems.length,
        hint: "в номенклатуре",
      },
      {
        label: "Остатки",
        value: inventoryLoading ? "..." : inventoryStock.length,
        hint: "позиций на складе",
      },
      {
        label: "Разделы",
        value: visibleSectionCards.length,
        hint: "доступно в меню",
      },
    ],
    [
      activeWarehouseTasksCount,
      inventoryItems.length,
      inventoryLoading,
      inventoryStock.length,
      tasksLoading,
      visibleSectionCards.length,
    ]
  );

  const warehouseQuickActions = useMemo(
    () =>
      [
        { key: "tasks", label: "Создать задачу", hint: "исполнитель, срок, контроль" },
        { key: "inventory", label: "Проверить остатки", hint: "товары и доступное количество" },
        { key: "items", label: "Печать QR товара", hint: "этикетки для склада" },
        { key: "tsd", label: "Открыть ТСД", hint: "сканирование и операции" },
        { key: "crossdock", label: "Кросс-докинг", hint: "паллеты, маршрут, отгрузка" },
      ].filter((action) => sectionSet.has(action.key)),
    [sectionSet]
  );

  const openSection = useCallback((sectionKey) => {
    setSection(sectionKey);
    const params = new URLSearchParams(location.search || "");
    params.set("section", sectionKey);
    if (sectionKey !== "crossdock") {
      params.delete("crossdockTab");
    }
    navigate(
      {
        pathname: location.pathname,
        search: `?${params.toString()}`,
      },
      { replace: true }
    );
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [location.pathname, location.search, navigate]);

  const closeSection = useCallback(() => {
    setSection("");
    setCrossdockTab("");
    const params = new URLSearchParams(location.search || "");
    params.delete("section");
    params.delete("taskView");
    params.delete("crossdockTab");
    const search = params.toString();
    navigate(
      {
        pathname: location.pathname,
        search: search ? `?${search}` : "",
      },
      { replace: true }
    );
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [location.pathname, location.search, navigate]);

  const handleCrossdockTabChange = useCallback(
    (tabId) => {
      if (!CROSSDOCK_TAB_IDS.has(tabId)) return;
      const params = new URLSearchParams(location.search || "");
      const currentSection = String(params.get("section") || "").trim();
      const currentTab = String(params.get("crossdockTab") || "").trim();
      if (currentSection === "crossdock" && currentTab === tabId) {
        setCrossdockTab(tabId);
        return;
      }
      params.set("section", "crossdock");
      params.set("crossdockTab", tabId);
      navigate(
        {
          pathname: location.pathname,
          search: `?${params.toString()}`,
        },
        { replace: true }
      );
      setCrossdockTab(tabId);
    },
    [location.pathname, location.search, navigate]
  );

  useEffect(() => {
    const handleTopBack = (event) => {
      if (!section) return;
      if (section === "tsd") {
        const tsdEvent = new CustomEvent("tsd:back-request", { cancelable: true });
        window.dispatchEvent(tsdEvent);
        if (tsdEvent.defaultPrevented) {
          if (typeof event?.preventDefault === "function") {
            event.preventDefault();
          }
          return;
        }
      }
      if (section === "crossdock") {
        const crossdockEvent = new CustomEvent("crossdock:back-request", { cancelable: true });
        window.dispatchEvent(crossdockEvent);
        if (crossdockEvent.defaultPrevented) {
          if (typeof event?.preventDefault === "function") {
            event.preventDefault();
          }
          return;
        }
      }
      closeSection();
      if (typeof event?.preventDefault === "function") {
        event.preventDefault();
      }
    };

    window.addEventListener("portal:warehouse-back", handleTopBack);
    return () => window.removeEventListener("portal:warehouse-back", handleTopBack);
  }, [section, closeSection]);



  return (

    <div className={"page" + (!section ? " page--warehouse-home" : "")}>

      {sections.length === 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card1c__body">
            <div className="alert alert--danger" style={{ margin: 0 }}>
              Нет доступных разделов склада. Обратитесь к администратору.
            </div>
          </div>
        </div>
      )}



      {/* Верхние карточки-подразделы склада */}

      {!section && (
        <div className="warehouse-section">
          <div className="warehouse-home-layout">
            <aside className="warehouse-home-panel warehouse-home-panel--summary" aria-label="Сводка склада">
              <div className="warehouse-home-panel__eyebrow">Сегодня</div>
              <div className="warehouse-home-panel__title">Пульс склада</div>
              <div className="warehouse-home-panel__text">
                Быстрая сводка по доступным разделам и текущим данным.
              </div>
              <div className="warehouse-home-stats">
                {warehouseOverviewStats.map((item) => (
                  <div key={item.label} className="warehouse-home-stat">
                    <div className="warehouse-home-stat__value">{item.value}</div>
                    <div>
                      <div className="warehouse-home-stat__label">{item.label}</div>
                      <div className="warehouse-home-stat__hint">{item.hint}</div>
                    </div>
                  </div>
                ))}
              </div>
            </aside>

            <div className="warehouse-grid">
              {visibleSectionCards.map((card) => (
                <button
                  key={card.key}
                  type="button"
                  className="warehouse-card"
                  onClick={() => openSection(card.key)}
                >
                  <div className="warehouse-card__icon">
                    <WarehouseTileIcon name={card.key} />
                  </div>
                  <div className="warehouse-card__body">
                    <div className="warehouse-card__title">{card.title}</div>
                    <div className="warehouse-card__subtitle">{card.subtitle}</div>
                  </div>
                </button>
              ))}
            </div>

            <aside className="warehouse-home-panel warehouse-home-panel--actions" aria-label="Быстрые действия">
              <div className="warehouse-home-panel__eyebrow">Действия</div>
              <div className="warehouse-home-panel__title">Быстрый старт</div>
              <div className="warehouse-home-actions">
                {warehouseQuickActions.map((action) => (
                  <button
                    key={action.key}
                    type="button"
                    className="warehouse-home-action"
                    onClick={() => openSection(action.key)}
                  >
                    <span className="warehouse-home-action__icon">
                      <WarehouseTileIcon name={action.key} />
                    </span>
                    <span className="warehouse-home-action__body">
                      <span className="warehouse-home-action__label">{action.label}</span>
                      <span className="warehouse-home-action__hint">{action.hint}</span>
                    </span>
                  </button>
                ))}
              </div>
              <div className="warehouse-home-note">
                Разделы открываются в один клик, без поиска по меню.
              </div>
            </aside>
          </div>
        </div>
      )}

        {/* ======    ЗАЯВКИ ====== */}

      {sectionSet.has("requests") && section === "requests" && (

        <div className="requests-section" ref={requestsRef}>

          {/* Вкладки внутри раздела заявок */}

          <div className="tabs tabs--sm" style={{ marginBottom: 16 }}>
            <button
              type="button"
              className={
                "tabs__btn " +
                (requestsTab === "new" ? "tabs__btn--active" : "")
              }
              onClick={() => setRequestsTab("new")}
            >
              Новая заявка
            </button>
            <button
              type="button"
              className={
                "tabs__btn " +
                (requestsTab === "journal" ? "tabs__btn--active" : "")
              }
              onClick={() => setRequestsTab("journal")}
            >
              Журнал заявок
            </button>
          </div>
          {/* Вкладка: Новая заявка */}

          {requestsTab === "new" && (

            <div className="card card--1c">

              <div className="card1c__header">Новая заявка</div>

              <div className="card1c__body">

                {error && (

                  <div

                    className="alert alert--danger"

                    style={{ marginBottom: 12 }}

                  >

                    {error}

                  </div>

                )}



                <form

                  onSubmit={handleCreateRequest}

                  className="form request-form-1c"

                >

                  <div className="form__group">
                    <label className="form__label">Товар</label>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <input
                      className="form__input"
                      placeholder="Поиск по товару..."
                      value={requestItemQuery}
                      onChange={(e) => setRequestItemQuery(e.target.value)}
                    />
                      <button
                        type="button"
                        className="btn btn--secondary btn--sm"
                        onClick={loadRequestStock}
                      >
                        Обновить
                      </button>
                    </div>
                    <select
                      className="form__select"
                      value={requestForm.itemId}
                      onChange={(e) =>
                        setRequestForm({
                          ...requestForm,
                          itemId: e.target.value,
                        })
                      }
                    >
                      <option value="">Выберите товар</option>
                      {filteredRequestItems.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name} (остаток: {item.currentStock} {item.unit || "шт"})
                          {Number(item.currentStock) <= 0 ? " — нет остатка" : ""}
                        </option>
                      ))}
                    </select>
                    {selectedRequestItem && (
                      <div className="form__hint">
                        Остаток: {selectedRequestItem.currentStock}{" "}
                        {selectedRequestItem.unit || "шт"}
                      </div>
                    )}
                  </div>



                  <div className="form__group">

                    <label className="form__label">Количество</label>

                    <input

                      type="number"

                      className="form__input"

                      value={requestForm.quantity}

                      onChange={(e) =>

                        setRequestForm({

                          ...requestForm,

                          quantity: e.target.value,

                        })

                      }

                      placeholder="Сколько?"

                    />

                    {selectedRequestItem &&
                      Number(requestForm.quantity) > Number(selectedRequestItem.currentStock ?? 0) && (
                        <div className="form__hint" style={{ color: "#dc2626" }}>
                          Недостаточно остатка. Доступно {selectedRequestItem.currentStock} {selectedRequestItem.unit || "шт."}.
                        </div>
                      )}

                    {selectedRequestItem && Number(selectedRequestItem.currentStock ?? 0) <= 0 && (
                      <div className="form__hint" style={{ color: "#dc2626" }}>
                        На складе нет остатка для выдачи. Можно создать заявку на пополнение.
                      </div>
                    )}


</div>



                  <div className="form__group">

                    <label className="form__label">Комментарий</label>

                    <textarea

                      className="form__textarea"

                      rows={3}

                      value={requestForm.description}

                      onChange={(e) =>

                        setRequestForm({

                          ...requestForm,

                          description: e.target.value,

                        })

                      }

                      placeholder="Детали, сроки, для чего..."

                    />

                  </div>



                  <div className="request-form-1c__actions">

                    <button

                      type="submit"

                      className="btn btn--primary"

                      disabled={saving}

                    >

                      {saving ? "Отправка..." : "Отправить заявку"}

                    </button>

                  
                    {(selectedRequestItem && Number(selectedRequestItem.currentStock ?? 0) <= 0) ||
                    (selectedRequestItem &&
                      Number(requestForm.quantity) > Number(selectedRequestItem.currentStock ?? 0)) ? (
                      <button
                        type="button"
                        className="btn btn--secondary"
                        disabled={saving}
                        onClick={handleCreateReplenishRequest}
                        style={{ marginLeft: 8 }}
                      >
                        Создать заявку на пополнение
                      </button>
                    ) : null}
                  </div>

                </form>

              </div>

            </div>

          )}



                              {/* Вкладка: Журнал заявок */}

          {requestsTab === "journal" && (

            <div className="card card--1c">

              <div className="card1c__header">Журнал заявок</div>

              <div className="card1c__body">

                {/* Фильтры */}

                <div

                  style={{

                    display: "flex",

                    gap: 16,

                    alignItems: "flex-end",

                    marginBottom: 12,

                  }}

                >

                  <div>

                    <label className="form__label">Статус</label>

                    <select

                      className="form__select"

                      value={filterStatus}

                      onChange={(e) => setFilterStatus(e.target.value)}

                    >

                      <option value="ALL">Все статусы</option>

                      {STATUS_OPTIONS.map((opt) => (

                        <option key={opt.value} value={opt.value}>

                          {opt.label}

                        </option>

                      ))}

                    </select>

                  </div>



                  <div style={{ flex: 1 }}>

                    <label className="form__label">Поиск</label>

                    <input

                      type="text"

                      className="form__input"

                      placeholder="Товар, комментарий, автор..."

                      value={filterText}

                      onChange={(e) => setFilterText(e.target.value)}

                    />

                  </div>

                </div>



                {loading ? (

                  <p>Загрузка...</p>

                ) : filteredRequests.length === 0 ? (

                  <p className="text-muted">Заявок не найдено.</p>

                ) : (

                  <div className="table-wrapper requests-journal-table">

                    <table className="table">

                      <thead>

                        <tr>

                          <th style={{ width: 40 }}>№</th>

                          <th style={{ width: 170 }}>Дата</th>

                          <th style={{ width: 110 }}>Статус</th>

                          <th style={{ width: 200 }}>Автор</th>

                          <th>Товар / заявка</th>

                          <th style={{ width: 70 }}>Кол-во</th>

                          <th style={{ width: 220 }}>Комментарий</th>

                        </tr>

                      </thead>

                      <tbody>

                        {filteredRequests.map((req, index) => {

                          // автор (новые заявки: createdBy, старые: author)

                          const createdBy = req.createdBy || req.author;



                          // общее количество по позициям заявки

                          const totalQty =

                            Array.isArray(req.items) && req.items.length

                              ? req.items.reduce(

                                  (sum, it) =>

                                    sum + (Number(it.quantity) || 0),

                                  0

                                )

                              : req.quantity != null

                              ? req.quantity

                              : null;



                          // комментарий пользователя

                          const requestComment =

                            req.comment ?? req.description;



                          // заголовок/товар

                          const title =

                            req.title ||

                            (Array.isArray(req.items) &&

                              req.items[0] &&

                              req.items[0].name) ||

                            "-";



                          return (

                            <tr key={req.id} className="requests-journal-row">

                              <td data-label="index">{index + 1}</td>

                              <td data-label="date">

                                {req.createdAt

                                  ? new Date(

                                      req.createdAt

                                    ).toLocaleString("ru-RU", {

                                      day: "2-digit",

                                      month: "2-digit",

                                      year: "numeric",

                                      hour: "2-digit",

                                      minute: "2-digit",

                                    })

                                  : "-"}

                              </td>

                              <td data-label="status">{statusLabel(req.status)}</td>

                              <td data-label="author">

                                {createdBy?.name ||

                                  createdBy?.email ||

                                  "-"}

                              </td>

                              <td data-label="title">{title}</td>

                              <td data-label="qty" style={{ textAlign: "right" }}>

                                {totalQty != null && totalQty !== 0

                                  ? totalQty

                                  : "-"}

                              </td>

                              <td data-label="comment">{requestComment || "-"}</td>

                            </tr>

                          );

                        })}

                      </tbody>

                    </table>

                  </div>

                )}

              </div>

            </div>

          )}

        </div>

      )}



                  {/* ====== ЗАДАЧИ ====== */}

      {sectionSet.has("tasks") && section === "tasks" && (

        <div className="tasks-section" ref={tasksRef}>

          {/* Вкладки: Новая задача / Журнал задач */}

          <div className="tabs tabs--sm" style={{ marginBottom: 16 }}>

            {isWarehouseManager && (
              <button
                type="button"
                className={
                  "tabs__btn " + (taskView === "new" ? "tabs__btn--active" : "")
                }
                onClick={() => setTaskView("new")}
              >
                Новая задача
              </button>
            )}

            <button

              type="button"

              className={

                "tabs__btn " +

                (taskView === "journal" ? "tabs__btn--active" : "")

              }

              onClick={() => setTaskView("journal")}

            >

              Журнал задач

            </button>

          </div>



          {/* Вкладка: Новая задача */}

          {taskView === "new" && (

            <div className="card card--1c">

              <div className="card1c__header">Новая задача</div>

              <div className="card1c__body">

                {taskError && (

                  <div

                    className="alert alert--danger"

                    style={{ marginBottom: 8 }}

                  >

                    {taskError}

                  </div>

                )}

                {taskInfo && (
                  <div
                    className="alert alert--warning"
                    style={{ marginBottom: 8 }}
                  >
                    {taskInfo}
                  </div>
                )}



                {!isWarehouseManager ? (
                  <div className="alert alert--warning">
                    Создавать задачи может только администратор.
                  </div>
                ) : (
                <form onSubmit={handleCreateTask} className="form request-form-1c">

                  <div className="form__group">

                    <label className="form__label">Заголовок</label>

                    <input

                      type="text"

                      className="form__input"

                      value={taskForm.title}

                      onChange={(e) =>

                        setTaskForm({ ...taskForm, title: e.target.value })

                      }

                      placeholder="Что сделать?"

                      required

                    />

                  </div>



                  <div className="form__group">

                    <label className="form__label">Описание</label>

                    <textarea

                      className="form__textarea"

                      rows={3}

                      value={taskForm.description}

                      onChange={(e) =>

                        setTaskForm({

                          ...taskForm,

                          description: e.target.value,

                        })

                      }

                      placeholder="Подробности..."

                    />

                  </div>



                  <div className="form__group">

                    <label className="form__label">Срок (дата и время)</label>

                    <input

                      type="datetime-local"

                      className="form__input"

                      value={taskForm.dueDate}

                      onChange={(e) =>

                        setTaskForm({ ...taskForm, dueDate: e.target.value })

                      }

                    />

                  </div>



                  <div className="form__group">
                    <label className="form__label">Исполнитель</label>
                    <select
                      className="form__select"
                      value={taskForm.executorUserId}
                      onChange={(e) =>
                        setTaskForm({
                          ...taskForm,
                          executorUserId: e.target.value,
                        })
                      }
                    >
                      <option value="">Не назначен</option>
                      {taskExecutors.map((exec) => (
                        <option key={exec.id} value={exec.id}>
                          {exec.name} ({exec.role})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="form__group">
                    <label className="form__label">
                      Фото к задаче (до {TASK_ATTACHMENT_MAX_COUNT} шт.)
                    </label>
                    <input
                      type="file"
                      className="form__input"
                      accept="image/jpeg,image/png,image/webp"
                      multiple
                      onChange={handleTaskPhotoPick}
                    />
                    <div className="form__hint">
                      Поддерживаются JPG, PNG, WEBP. Максимум 2 МБ на фото.
                    </div>
                    {taskPhotoFiles.length > 0 && (
                      <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
                        {taskPhotoFiles.map((file, index) => (
                          <div
                            key={`${file.name}-${file.lastModified}-${index}`}
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "center",
                              gap: 12,
                              border: "1px solid #dbe4ee",
                              borderRadius: 10,
                              padding: "8px 10px",
                              background: "#f8fafc",
                            }}
                          >
                            <span style={{ fontSize: 13, color: "#0f172a" }}>
                              {file.name}
                            </span>
                            <button
                              type="button"
                              className="btn btn--ghost btn--sm"
                              onClick={() => removeTaskPhoto(index)}
                            >
                              Убрать
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>



                  <div className="request-form-1c__actions">

                    <button

                      type="submit"

                      className="btn btn--primary"

                      disabled={taskSaving}

                    >

                      {taskSaving ? "Создание..." : "Создать задачу"}

                    </button>

                  </div>

                </form>
                )}

              </div>

            </div>

          )}



          {/* Вкладка: Журнал задач (таблица как История движений) */}

          {taskView === "journal" && (

            <div className="card card--1c">

              <div
                className="card1c__header"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  flexWrap: "wrap",
                }}
              >
                <span>Журнал задач</span>
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  onClick={() => loadTasks()}
                  disabled={tasksLoading}
                >
                  {tasksLoading ? "Обновление..." : "Обновить"}
                </button>
              </div>

              <div className="card1c__body">

                {/* Фильтры сверху, в стиле Истории движений */}

                <div

                  style={{

                    display: "flex",

                    gap: 16,

                    alignItems: "flex-end",

                    marginBottom: 12,

                    flexWrap: "wrap",

                  }}

                >

                  <div>

                    <label className="form__label">Статус</label>

                    <select

                      className="form__select"

                      value={taskFilterStatus}

                      onChange={(e) => setTaskFilterStatus(e.target.value)}

                    >

                      <option value="ALL">Все статусы</option>

                      {TASK_STATUS_OPTIONS.map((opt) => (

                        <option key={opt.value} value={opt.value}>

                          {opt.label}

                        </option>

                      ))}

                    </select>

                  </div>



                  {isWarehouseManager && (

                    <div>

                      <label className="form__label">Список задач</label>

                      <select

                        className="form__select"

                        value={taskTab}

                        onChange={(e) => setTaskTab(e.target.value)}

                      >

                        <option value="my">Мои задачи</option>

                        <option value="all">Все задачи</option>

                      </select>

                    </div>

                  )}



                  <div style={{ flex: 1, minWidth: 200 }}>

                    <label className="form__label">Поиск</label>

                    <input

                      type="text"

                      className="form__input"

                      placeholder="Заголовок, исполнитель, автор..."

                      value={taskFilterText}

                      onChange={(e) => setTaskFilterText(e.target.value)}

                    />

                  </div>

                </div>



                {tasksLoading ? (

                  <p>Загрузка...</p>

                ) : filteredTasks.length === 0 ? (

                  <p className="text-muted">Задач не найдено.</p>

                ) : (

                  <div className="table-wrapper tasks-journal-table">

                    <table className="table">

                      <thead>

                        <tr>

                          <th style={{ width: 40 }}>№</th>

                          <th style={{ width: 170 }}>Дата</th>

                          <th style={{ width: 170 }}>Срок</th>

                          <th style={{ width: 130 }}>Статус</th>

                          <th>Задача</th>

                          <th style={{ width: 180 }}>Исполнитель</th>

                          <th style={{ width: 150 }}>Действия</th>

                        </tr>

                      </thead>

                      <tbody>

                        {filteredTasks.map((t, index) => {
                          const overdue = isTaskOverdue(t);
                          const taskPhotoCount = Array.isArray(t.taskPhotos)
                            ? t.taskPhotos.length
                            : 0;
                          const responsePhotoCount = Array.isArray(t.responsePhotos)
                            ? t.responsePhotos.length
                            : 0;
                          const hasResponseText = Boolean(
                            String(t.responseText || "").trim()
                          );
                          const authorLabel =
                            t.assigner?.name || t.assigner?.email || "-";
                          const attachmentsSummary =
                            taskPhotoCount || responsePhotoCount
                              ? `Фото: к задаче ${taskPhotoCount}, в ответе ${responsePhotoCount}`
                              : "Фото нет";

                          return (

                            <tr key={t.id} className="tasks-journal-row">

                              <td data-label="Номер">{index + 1}</td>

                              <td data-label="Дата">

                                {t.createdAt

                                  ? formatTaskDateTime(t.createdAt)

                                  : "-"}

                              </td>

                              <td data-label="Срок">

                                {t.dueDate

                                  ? formatTaskDateTime(t.dueDate)

                                  : "-"}

                                {overdue && (

                                  <span

                                    style={{

                                      color: "red",

                                      marginLeft: 4,

                                      fontSize: "0.85em",

                                    }}

                                  >

                                    (просрочено)

                                  </span>

                                  )}

                              </td>

                              <td data-label="Статус">
                                <span className={taskStatusBadgeClass(t.status)}>
                                  {TASK_STATUS_LABELS[normalizeTaskStatus(t.status)] ||
                                    normalizeTaskStatus(t.status)}
                                </span>
                              </td>

                              <td data-label="Задача">
                                <div
                                  style={{
                                    fontWeight: 700,
                                    lineHeight: 1.35,
                                    color: "#0f172a",
                                  }}
                                >
                                  {t.title || "-"}
                                </div>
                                <div
                                  style={{
                                    marginTop: 4,
                                    fontSize: 12,
                                    lineHeight: 1.35,
                                    color: "#64748b",
                                  }}
                                >
                                  {authorLabel} • {attachmentsSummary} •{" "}
                                  {hasResponseText ? "Ответ добавлен" : "Ответ не добавлен"}
                                </div>
                              </td>

                              <td data-label="Исполнитель">

                                {t.executorUser?.name || t.executorName || "-"}

                              </td>

                              <td data-label="Действия">
                                <div
                                  style={{
                                    display: "flex",
                                    justifyContent: "flex-end",
                                  }}
                                >
                                  <button
                                    type="button"
                                    className="btn btn--ghost btn--sm"
                                    onClick={() => openTaskDetails(t.id)}
                                  >
                                    Подробнее
                                  </button>
                                </div>
                              </td>

                            </tr>

                          );

                        })}

                      </tbody>

                    </table>

                  </div>

                )}

                {taskDetails &&
                  typeof document !== "undefined" &&
                  createPortal(
                    <div className="modal-backdrop" onClick={closeTaskDetails}>
                      <div
                        className="modal modal--wide task-details-modal"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <div className="modal__header">
                          <h2 className="modal__title">
                            Задача №{taskDetails.id}: {taskDetails.title || "Без названия"}
                          </h2>
                          <button
                            type="button"
                            className="modal__close"
                            aria-label="Закрыть детали задачи"
                            onClick={closeTaskDetails}
                          >
                            ×
                          </button>
                        </div>

                        <div className="modal__body task-details-modal__body">
                          <div className="task-details-grid">
                            <div>
                              <div className="task-details-label">Статус</div>
                              <div>
                                <span className={taskStatusBadgeClass(taskDetails.status)}>
                                  {TASK_STATUS_LABELS[taskDetailsUiStatus] || taskDetailsUiStatus}
                                </span>
                              </div>
                            </div>
                            <div>
                              <div className="task-details-label">Срок</div>
                              <div>
                                {formatTaskDateTime(taskDetails.dueDate)}
                              </div>
                            </div>
                            <div>
                              <div className="task-details-label">Исполнитель</div>
                              <div>{taskDetailsExecutor}</div>
                            </div>
                            <div>
                              <div className="task-details-label">Автор</div>
                              <div>{taskDetailsAuthor}</div>
                            </div>
                          </div>

                          <div className="task-details-section">
                            <div className="task-details-label">Описание</div>
                            <div className="task-details-text">
                              {taskDetails.description || "Описание не добавлено"}
                            </div>
                          </div>

                          <div className="task-details-section">
                            <div className="task-details-label">Фото к задаче</div>
                            {taskDetailsTaskPhotos.length === 0 ? (
                              <div className="text-muted">Фото не добавлены</div>
                            ) : (
                              <div className="task-details-photos">
                                {taskDetailsTaskPhotos.map((photo, photoIndex) => (
                                  <a
                                    key={`${taskDetails.id}-task-photo-${photoIndex}`}
                                    href={photo.dataUrl}
                                    title={photo.fileName || "Фото"}
                                    onClick={(event) =>
                                      openTaskPhotoPreview(
                                        event,
                                        photo,
                                        `Фото ${photoIndex + 1}`
                                      )
                                    }
                                  >
                                    <img
                                      src={photo.dataUrl}
                                      alt={photo.fileName || `Фото ${photoIndex + 1}`}
                                    />
                                  </a>
                                ))}
                              </div>
                            )}
                          </div>

                          <div className="task-details-section">
                            <div className="task-details-label">Ответ исполнителя</div>
                            {taskDetails.responseText ? (
                              <div className="task-details-text">{taskDetails.responseText}</div>
                            ) : (
                              <div className="text-muted">Ответ не добавлен</div>
                            )}

                            {taskDetailsResponsePhotos.length > 0 && (
                              <div className="task-details-photos">
                                {taskDetailsResponsePhotos.map((photo, photoIndex) => (
                                  <a
                                    key={`${taskDetails.id}-response-photo-${photoIndex}`}
                                    href={photo.dataUrl}
                                    title={photo.fileName || "Фото"}
                                    onClick={(event) =>
                                      openTaskPhotoPreview(
                                        event,
                                        photo,
                                        `Фото ${photoIndex + 1}`
                                      )
                                    }
                                  >
                                    <img
                                      src={photo.dataUrl}
                                      alt={photo.fileName || `Фото ${photoIndex + 1}`}
                                    />
                                  </a>
                                ))}
                              </div>
                            )}

                            {taskDetails.responseUpdatedAt && (
                              <div className="text-muted" style={{ fontSize: 12 }}>
                                Ответ обновлён:{" "}
                                {formatTaskDateTime(taskDetails.responseUpdatedAt)}
                                {taskDetails.responseAuthorName
                                  ? `, ${taskDetails.responseAuthorName}`
                                  : ""}
                              </div>
                            )}
                          </div>

                          {taskDetailsCanEdit && (
                            <div className="task-details-section">
                              <div className="task-details-label">Комментарий по выполнению</div>
                              <textarea
                                className="form__textarea"
                                rows={3}
                                placeholder="Комментарий по выполнению задачи..."
                                value={taskDetailsResponseDraft}
                                onChange={(e) =>
                                  setTaskResponseDrafts((prev) => ({
                                    ...prev,
                                    [taskDetails.id]: e.target.value,
                                  }))
                                }
                              />

                              <input
                                type="file"
                                className="form__input"
                                accept="image/jpeg,image/png,image/webp"
                                multiple
                                onChange={(event) =>
                                  handleTaskResponsePhotoPick(taskDetails.id, event)
                                }
                              />

                              {taskDetailsResponseFiles.length > 0 && (
                                <div className="task-details-files">
                                  {taskDetailsResponseFiles.map((file, fileIndex) => (
                                    <div
                                      key={`${taskDetails.id}-response-file-${file.name}-${file.lastModified}-${fileIndex}`}
                                      className="task-details-file-row"
                                    >
                                      <span>{file.name}</span>
                                      <button
                                        type="button"
                                        className="btn btn--ghost btn--sm"
                                        onClick={() =>
                                          removeTaskResponsePhoto(taskDetails.id, fileIndex)
                                        }
                                      >
                                        Убрать
                                      </button>
                                    </div>
                                  ))}
                                </div>
                              )}

                              <div className="task-details-actions">
                                <select
                                  className="form__select form__select--sm"
                                  style={{ minWidth: 190 }}
                                  value={taskDetailsUiStatus}
                                  onChange={(e) =>
                                    handleTaskApplyStatus(taskDetails, e.target.value)
                                  }
                                  disabled={
                                    taskStatusSavingId === taskDetails.id ||
                                    taskResponseSavingId === taskDetails.id
                                  }
                                >
                                  {TASK_STATUS_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>
                                      {option.label}
                                    </option>
                                  ))}
                                </select>
                                <span className="text-muted" style={{ fontSize: 12 }}>
                                  При смене статуса сохраняются комментарий и фото.
                                </span>
                              </div>
                            </div>
                          )}
                        </div>

                        <div className="task-details-footer">
                          <button
                            type="button"
                            className="btn btn--ghost"
                            onClick={closeTaskDetails}
                          >
                            Закрыть
                          </button>
                        </div>
                      </div>
                    </div>,
                    document.body
                  )}

              </div>

            </div>

          )}

        </div>

      )}



            {/* ====== ОЧЕРЕДЬ МАШИН ПОСТАВЩИКОВ ====== */}

      {sectionSet.has("locations") && section === "locations" && (

        <div className="locations-section" ref={locationsRef}>

          <WarehouseLocationsPanel mode="locations" />

        </div>

      )}

      {sectionSet.has("items") && section === "items" && (
        <div className="locations-section">
          <WarehouseLocationsPanel mode="items" />
        </div>
      )}



      {sectionSet.has("queue") && section === "queue" && (

        <div className="queue-section" ref={queueRef}>

          <SupplierTrucksQueueTab />

        </div>

      )}



      {sectionSet.has("tsd") && section === "tsd" && (

  <div className="tsd-section" ref={tsdRef}>

    {/* сюда вынесем отдельный компонент, чтобы не раздувать файл */}

    <MobileTsdTab />

  </div>

)}

      {sectionSet.has("crossdock") && section === "crossdock" && (
        <div className="tsd-section">
          <PalletFlow
            authHeaders={authHeaders}
            onBack={closeSection}
            showInternalBack={false}
            initialTab={crossdockTab}
            onTabChange={handleCrossdockTabChange}
          />
        </div>
      )}

      {sectionSet.has("revision") && section === "revision" && (
        <div className="inventory-section" ref={revisionRef}>
          <StockRevisionTab />
        </div>
      )}

      {sectionSet.has("holds") && section === "holds" && (
        <div className="inventory-section" ref={holdsRef}>
          <StockHoldsPanel showTitle={false} withTopMargin={false} />
        </div>
      )}

      {/* ====== ОСТАТКИ / ИНВЕНТАРИЗАЦИЯ / ЗАКУПКИ ====== */}

      {sectionSet.has(section) && ["inventory","movement","suppliers"].includes(section) && (

        <div className="inventory-section" ref={inventoryRef}>

          {/* Внутренние вкладки */}

          
          {inventoryTab === "movement" && (
            <div className="tabs tabs--sm inventory-subtabs" style={{ marginBottom: 12 }}>
              <button
                type="button"
                className={
                  "tabs__btn " + (movementTab === "movementsHistory" ? "tabs__btn--active" : "")
                }
                onClick={() => setMovementTab("movementsHistory")}
              >
                История движений
              </button>
              <button
                type="button"
                className={
                  "tabs__btn " + (movementTab === "transactions" ? "tabs__btn--active" : "")
                }
                onClick={() => setMovementTab("transactions")}
              >
                Транзакции
              </button>
            </div>
          )}

          {inventoryTab === "suppliers" && (
            <div className="tabs tabs--sm inventory-subtabs" style={{ marginBottom: 12 }}>
              <button
                type="button"
                className={
                  "tabs__btn " + (suppliersTab === "suppliers" ? "tabs__btn--active" : "")
                }
                onClick={() => setSuppliersTab("suppliers")}
              >
                Поставщики
              </button>
              <button
                type="button"
                className={
                  "tabs__btn " + (suppliersTab === "orders" ? "tabs__btn--active" : "")
                }
                onClick={() => setSuppliersTab("orders")}
              >
                Заказы поставщику
              </button>
            </div>
          )}



          {inventoryTab === "stock" && (
            <>
              <StockAuditTab />
            </>
          )}



          {/* ===== Вкладка 3: Движение товара (только форма) ===== */}

          {false && inventoryTab === "movement" && movementTab === "movements" && (

            <div className="grid-2">

              <div className="card card--1c" style={{ gridColumn: "span 2" }}>

                <div

                  className="card1c__header"

                  style={{

                    display: "flex",

                    justifyContent: "space-between",

                    alignItems: "center",

                  }}

                >

                  <span>Движение товара</span>

                  <button

                    type="button"

                    className="btn btn--secondary btn--sm"

                    onClick={() => {

                      console.log(

                        "CLICK ПО ЗАКУПУ, showReceiveModal было:",

                        showReceiveModal

                      );

                      setShowReceiveModal(true);

                    }}

                  >

                    Закуп по заказу

                  </button>

                </div>

                <div className="card1c__body">

                  {inventoryError && (

                    <div

                      className="alert alert--danger"

                      style={{ marginBottom: 8 }}

                    >

                      {inventoryError}

                    </div>

                  )}

                  <form

                    onSubmit={handleCreateMovement}

                    className="form request-form-1c"

                  >

                    <div className="form__group">

                      <label className="form__label">Тип операции</label>

                      <select

                        className="form__select"

                        value={movementForm.type}

                        onChange={(e) =>

                          setMovementForm({

                            ...movementForm,

                            type: e.target.value,

                          })

                        }

                      >

                        <option value="INCOME">Приход</option>

                        <option value="ISSUE">Расход</option>

                        <option value="ADJUSTMENT">Корректировка</option>

                      </select>

                    </div>



                    <div className="form__group">

                      <label className="form__label">Товар</label>

                      <select

                        className="form__select"

                        value={movementForm.itemId}

                        onChange={(e) =>

                          setMovementForm({

                            ...movementForm,

                            itemId: e.target.value,

                          })

                        }

                      >

                        <option value="">-- Выберите товар --</option>

                        {inventoryItems.map((it) => (

                          <option key={it.id} value={it.id}>

                            {it.name} (Остаток:{" "}

                            {currentStockForItem(it.id)} {it.unit})

                          </option>

                        ))}

                      </select>

                    </div>



                    <div className="form__group">

                      <label className="form__label">Количество</label>

                      <div style={{ flex: 1 }}>

                        <input

                          className="form__input"

                          type="number"

                          value={movementForm.quantity}

                          onChange={(e) =>

                            setMovementForm({

                              ...movementForm,

                              quantity: e.target.value,

                            })

                          }

                          placeholder="Например: 5 или -5"

                        />

                      </div>

                    </div>



                    <div className="form__group">

                      <label className="form__label">Комментарий</label>

                      <input

                        className="form__input"

                        value={movementForm.comment}

                        onChange={(e) =>

                          setMovementForm({

                            ...movementForm,

                            comment: e.target.value,

                          })

                        }

                      />

                    </div>



                    <div className="request-form-1c__actions">

                      <button type="submit" className="btn btn--primary">

                        Провести движение

                      </button>

                    </div>

                  </form>

                </div>

              </div>

            </div>

          )}



          {/* ===== Вкладка 4: История движений (1С) ===== */}

          {inventoryTab === "movement" && movementTab === "movementsHistory" && <StockMovementsHistoryTab />}
          {inventoryTab === "movement" && movementTab === "transactions" && <StockTransactionsTab />}

          {/* ===== Вкладка 5: Поставщики ===== */}
          {inventoryTab === "suppliers" && suppliersTab === "suppliers" && (
            <div className="grid-2">

              <div className="card card--1c" style={{ gridColumn: "span 2" }}>
                <div className="card1c__body">

                  {suppliersError && (

                    <div

                      className="alert alert--danger"

                      style={{ marginBottom: 12 }}

                    >

                      {suppliersError}

                    </div>

                  )}



                  <form

                    onSubmit={handleCreateSupplier}

                    className="form request-form-1c"

                    style={{ marginBottom: 16 }}

                  >

                    <div className="form__group">

                      <label className="form__label">Название</label>

                      <input

                        className="form__input"

                        value={supplierForm.name}

                        onChange={(e) =>

                          setSupplierForm({

                            ...supplierForm,

                            name: e.target.value,

                          })

                        }

                        placeholder="ООО Поставщик"

                      />

                    </div>



                    <div className="form__group">

                      <label className="form__label">ИНН</label>

                      <input

                        className="form__input"

                        value={supplierForm.inn}

                        onChange={(e) =>

                          setSupplierForm({

                            ...supplierForm,

                            inn: e.target.value,

                          })

                        }

                      />

                    </div>



                    <div className="form__group">

                      <label className="form__label">Телефон</label>

                      <input

                        className="form__input"

                        value={supplierForm.phone}

                        onChange={(e) =>

                          setSupplierForm({

                            ...supplierForm,

                            phone: e.target.value,

                          })

                        }

                      />

                    </div>



                    <div className="form__group">

                      <label className="form__label">Email</label>

                      <input

                        className="form__input"

                        value={supplierForm.email}

                        onChange={(e) =>

                          setSupplierForm({

                            ...supplierForm,

                            email: e.target.value,

                          })

                        }

                      />

                    </div>



                    <div className="form__group">

                      <label className="form__label">Комментарий</label>

                      <input

                        className="form__input"

                        value={supplierForm.comment}

                        onChange={(e) =>

                          setSupplierForm({

                            ...supplierForm,

                            comment: e.target.value,

                          })

                        }

                        placeholder="Условия оплаты, контакты менеджера..."

                      />

                    </div>



                    <div className="request-form-1c__actions">

                      <button type="submit" className="btn btn--primary">

                        Сохранить поставщика

                      </button>

                    </div>

                  </form>



                  {suppliersLoading ? (

                    <p>Загрузка...</p>

                  ) : suppliers.length === 0 ? (

                    <p className="text-muted">Поставщиков пока нет.</p>

                  ) : (

                    <div className="table-wrapper">

                      <table className="table">

                        <thead>

                          <tr>

                            <th>ID</th>

                            <th>Название</th>

                            <th>ИНН</th>

                            <th>Телефон</th>

                            <th>Email</th>

                          </tr>

                        </thead>

                        <tbody>

                          {suppliers.map((s) => (

                            <tr key={s.id}>

                              <td>{s.id}</td>

                              <td>{s.name}</td>

                              <td>{s.inn || "-"}</td>

                              <td>{s.phone || "-"}</td>

                              <td>{s.email || "-"}</td>

                            </tr>

                          ))}

                        </tbody>

                      </table>

                    </div>

                  )}

                </div>

              </div>

            </div>

          )}



                    {/* ===== Вкладка 6: Заказы поставщику ===== */}

          {inventoryTab === "suppliers" && suppliersTab === "orders" && (

            <div className="grid-2">

              <div className="card card--1c" style={{ gridColumn: "span 2" }}>

                <div className="card1c__header">Заказы поставщику</div>

                <div className="card1c__body">

                  <div

                    style={{

                      display: "flex",

                      gap: 8,

                      marginBottom: 12,

                      flexWrap: "wrap",

                    }}

                  >

                    <button

                      className="btn btn--secondary"

                      onClick={handleOpenPurchaseOrder}

                    >

                      Создать заказ поставщику

                    </button>
                  </div>



                  {purchaseOrdersError && (

                    <div

                      className="alert alert--danger"

                      style={{ marginBottom: 12 }}

                    >

                      {purchaseOrdersError}

                    </div>

                  )}



                  {purchaseOrdersLoading ? (

                    <p>Загрузка заказов...</p>

                  ) : sortedPurchaseOrders.length === 0 ? (

                    <p className="text-muted">Заказов пока нет.</p>

                  ) : (
                    <>
                    <div className="table-wrapper purchase-orders-desktop">
                      <table className="table">
                        <thead>
                          <tr>
                            <th>ID</th>
                            <th>Время</th>
                            <th>Поставщик</th>
                            <th>Статус</th>
                            <th></th>
                          </tr>
                        </thead>
                        <tbody>
                          {groupedPurchaseOrders.map((group) => (
                            <Fragment key={`desktop-${group.date}`}>
                              <tr className="table-section-row">
                                <td
                                  colSpan={5}
                                  style={{
                                    backgroundColor: "#f3f4f6",
                                    fontWeight: 600,
                                    paddingTop: 6,
                                    paddingBottom: 6,
                                  }}
                                >
                                  {group.date}
                                </td>
                              </tr>
                              {group.items.map(({ po, timeStr }) => (
                                <tr key={po.id}>
                                  <td>{po.id}</td>
                                  <td>{timeStr}</td>
                                  <td>{po.supplier?.name || "-"}</td>
                                  <td>{PO_STATUS_LABELS[po.status] || po.status}</td>
                                  <td>
                                    <button
                                      type="button"
                                      className="btn btn--secondary btn--sm"
                                      onClick={() => handleViewPurchaseOrder(po)}
                                    >
                                      Просмотреть
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </Fragment>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div className="purchase-orders-mobile">
                      {groupedPurchaseOrders.map((group) => (
                        <div key={`mobile-${group.date}`} className="purchase-orders-mobile__group">
                          <div className="purchase-orders-mobile__date">{group.date}</div>
                          {group.items.map(({ po, timeStr }) => (
                            <div key={po.id} className="purchase-orders-mobile__card">
                              <div className="purchase-orders-mobile__row">
                                <span className="purchase-orders-mobile__label">ID</span>
                                <span className="purchase-orders-mobile__value">{po.id}</span>
                              </div>
                              <div className="purchase-orders-mobile__row">
                                <span className="purchase-orders-mobile__label">Время</span>
                                <span className="purchase-orders-mobile__value">{timeStr}</span>
                              </div>
                              <div className="purchase-orders-mobile__row">
                                <span className="purchase-orders-mobile__label">Поставщик</span>
                                <span className="purchase-orders-mobile__value purchase-orders-mobile__value--supplier">
                                  {po.supplier?.name || "-"}
                                </span>
                              </div>
                              <div className="purchase-orders-mobile__row">
                                <span className="purchase-orders-mobile__label">Статус</span>
                                <span className="purchase-orders-mobile__value">
                                  {PO_STATUS_LABELS[po.status] || po.status}
                                </span>
                              </div>
                              <button
                                type="button"
                                className="btn btn--secondary btn--sm purchase-orders-mobile__action"
                                onClick={() => handleViewPurchaseOrder(po)}
                              >
                                Просмотреть
                              </button>
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                    </>
                  )}

                </div>

              </div>

            </div>

          )}

        </div>

      )}






      {taskPhotoPreview?.url &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="modal-backdrop task-photo-preview task-photo-preview--backdrop"
            onClick={closeTaskPhotoPreview}
          >
            <div
              className="modal modal--wide task-photo-preview__modal"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="modal__header">
                <h2 className="modal__title">{taskPhotoPreview.title}</h2>
                <button
                  type="button"
                  className="modal__close"
                  aria-label="Закрыть просмотр фото"
                  onClick={closeTaskPhotoPreview}
                >
                  ×
                </button>
              </div>
              <div className="modal__body task-photo-preview__body">
                <div className="task-photo-preview__image-wrap">
                  <img
                    src={taskPhotoPreview.url}
                    alt={taskPhotoPreview.title || "Фото"}
                    className="task-photo-preview__image"
                  />
                </div>
              </div>
              <div className="task-photo-preview__actions">
                <button type="button" className="btn btn--ghost" onClick={closeTaskPhotoPreview}>
                  Закрыть
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

      {showReceiveModal && (

        <PurchaseOrderReceiveModal

          onClose={() => {

            setShowReceiveModal(false);

            loadInventory();

            loadPurchaseOrders();

          }}

        />

      )}

      {viewPurchaseOrder && (
        <div className="modal-backdrop">
          <div className="modal modal--wide">
            <div className="modal__header">
              <h2 className="modal__title">
                Заказ поставщику №{viewPurchaseOrder.number || viewPurchaseOrder.id}
              </h2>
              <button
                type="button"
                className="modal__close"
                onClick={handleCloseViewPurchaseOrder}
              >
                ×
              </button>
            </div>

            <div className="modal__body">
              {viewPurchaseOrderError && (
                <div className="alert alert--danger" style={{ marginBottom: 12 }}>
                  {viewPurchaseOrderError}
                </div>
              )}
              {viewPurchaseOrderActionNotice && (
                <div className="alert alert--success" style={{ marginBottom: 12 }}>
                  {viewPurchaseOrderActionNotice}
                </div>
              )}

              <div className="grid-2" style={{ marginBottom: 12 }}>
                <div className="card">
                  <div className="card1c__body">
                    <div><strong>Поставщик:</strong> {viewPurchaseOrder.supplier?.name || "-"}</div>
                    <div>
                      <strong>Статус:</strong>{" "}
                      {PO_STATUS_LABELS[viewPurchaseOrder.status] || viewPurchaseOrder.status || "-"}
                    </div>
                    <div>
                      <strong>Дата:</strong>{" "}
                      {viewPurchaseOrder.date
                        ? new Date(viewPurchaseOrder.date).toLocaleString("ru-RU")
                        : "-"}
                    </div>
                    <div>
                      <strong>План. приемка:</strong>{" "}
                      {viewPurchaseOrder.plannedDate
                        ? new Date(viewPurchaseOrder.plannedDate).toLocaleDateString("ru-RU")
                        : "-"}
                    </div>
                    <div><strong>Комментарий:</strong> {viewPurchaseOrder.comment || "-"}</div>
                  </div>
                </div>
              </div>

              {viewPurchaseOrderLoading ? (
                <p>Загрузка заказа...</p>
              ) : (
                <div className="table-wrapper">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>№</th>
                        <th>Товар</th>
                        <th>Артикул</th>
                        <th>Ед.</th>
                        <th>Заказано</th>
                        <th>Получено</th>
                        <th>Цена</th>
                        <th>Сумма</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(viewPurchaseOrder.items || []).map((row, index) => {
                        const qty = Number(row.quantity) || 0;
                        const price = Number(row.price) || 0;
                        return (
                          <tr key={row.id || `${row.itemId || "item"}-${index}`}>
                            <td>{index + 1}</td>
                            <td>{row.item?.name || "-"}</td>
                            <td>{row.item?.sku || "-"}</td>
                            <td>{row.item?.unit || "-"}</td>
                            <td>{qty}</td>
                            <td>{Number(row.receivedQty) || 0}</td>
                            <td>
                              {price.toLocaleString("ru-RU", {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}
                            </td>
                            <td>
                              {(qty * price).toLocaleString("ru-RU", {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}
                            </td>
                          </tr>
                        );
                      })}
                      {(viewPurchaseOrder.items || []).length === 0 && (
                        <tr>
                          <td colSpan={8} style={{ textAlign: "center", color: "#6b7280" }}>
                            Позиции заказа отсутствуют.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="modal__actions">
                {viewPurchaseOrder.status === "DRAFT" && (
                  <button
                    type="button"
                    className="btn"
                    onClick={() => handlePurchaseOrderStatusSent(viewPurchaseOrder.id)}
                    disabled={viewPurchaseOrderActionLoading}
                  >
                    {viewPurchaseOrderActionLoading ? "\u041e\u0442\u043f\u0440\u0430\u0432\u043a\u0430..." : "\u041e\u0442\u043f\u0440\u0430\u0432\u0438\u0442\u044c \u043f\u043e\u0441\u0442\u0430\u0432\u0449\u0438\u043a\u0443"}
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={handleCloseViewPurchaseOrder}
                  disabled={viewPurchaseOrderActionLoading}
                >
                  {"\u0417\u0430\u043a\u0440\u044b\u0442\u044c"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showOrderModal && (

        <PurchaseOrderModal

          items={orderItemsForModal}

          suppliers={suppliers}

          onClose={() => setShowOrderModal(false)}

          onSuccess={(createdOrder) => {

            setShowOrderModal(false);

            if (createdOrder && typeof createdOrder.id === "number") {
              setPurchaseOrders((prev) => {
                const withoutCreated = prev.filter((po) => po.id !== createdOrder.id);
                return [createdOrder, ...withoutCreated];
              });
              setPurchaseOrdersError("");
            }

            loadPurchaseOrders();

          }}

        />

      )}

    </div>

  );

}

