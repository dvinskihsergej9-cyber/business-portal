

import { useEffect, useMemo, useRef, useState, Fragment } from "react";

import { API_BASE } from "../apiConfig";
import { useAuth } from "../context/AuthContext";

import ImportItemsModal from "../components/ImportItemsModal";

import PurchaseOrderModal from "../components/PurchaseOrderModal";

import PurchaseOrderReceiveModal from "../components/PurchaseOrderReceiveModal";
import StockAuditTab from "../components/StockAuditTab";
import StockMovementsHistoryTab from "../components/StockMovementsHistoryTab";
import StockTransactionsTab from "../components/StockTransactionsTab";
import StockRevisionTab from "../components/StockRevisionTab";
import SupplierTrucksQueueTab from "../components/SupplierTrucksQueueTab";
import MobileTsdTab from "../components/MobileTsdTab";
import WarehouseLocationsPanel from "../components/WarehouseLocationsPanel";
import TmcTab from "../components/TmcTab";


const API = API_BASE;

const WAREHOUSE_EMOJI = {
  tasks: "вњ…",
  inventory: "рџ§ѕ",
  items: "рџ“љ",
  movement: "\uD83D\uDCE6",
  transactions: "\uD83D\uDD01",
  revision: "\uD83E\uDDFE",
  tmc: "\uD83D\uDCCE",
  locations: "рџ“Ќ",
  queue: "рџљљ",
  tsd: "рџ“±",
  qr: "рџЏ·пёЏ",
  receive: "рџ“¦",
  ship: "рџљљ",
  audit: "рџ§ѕ",
  moves: "рџ”Ѓ",
  suppliers: "рџЏ­",
  docs: "рџ—‚пёЏ",
};

const WAREHOUSE_ICON_FALLBACK = {
  tasks: "TASK",
  inventory: "INV",
  items: "ITEM",
  movement: "\uD83D\uDCE6",
  transactions: "\uD83D\uDD01",
  tmc: "\uD83D\uDCCE",
  locations: "LOC",
  queue: "QUEUE",
  tsd: "TSD",
  qr: "QR",
  receive: "IN",
  ship: "OUT",
  audit: "AUD",
  moves: "MOV",
  suppliers: "SUP",
  docs: "DOC",
  revision: "REV",
};

function WarehouseTileIcon({ name }) {
  const emoji = WAREHOUSE_EMOJI[name];
  const fallback = WAREHOUSE_ICON_FALLBACK[name] || "вЂў";

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

  ISSUE: "Р’С‹РґР°С‡Р° СЂР°СЃС…РѕРґРЅС‹С… РјР°С‚РµСЂРёР°Р»РѕРІ (Р Рњ)",

  RETURN: "Р’РѕР·РІСЂР°С‚ РЅР° СЃРєР»Р°Рґ",

  INCOME: "РџСЂРёС…РѕРґ (РїСЂРёС‘РјРєР°)",

};



const STATUS_LABELS = {

  NEW: "РќРѕРІР°СЏ",

  IN_PROGRESS: "Р’ СЂР°Р±РѕС‚Рµ",

  DONE: "Р’С‹РїРѕР»РЅРµРЅР°",

  REJECTED: "РћС‚РєР»РѕРЅРµРЅР°",

  PENDING: "РћР¶РёРґР°РµС‚",

  APPROVED: "РћРґРѕР±СЂРµРЅРѕ",

  COMPLETED: "Р’С‹РґР°РЅРѕ",

};



const STATUS_OPTIONS = [

  { value: "NEW", label: "РќРѕРІР°СЏ" },

  { value: "IN_PROGRESS", label: "Р’ СЂР°Р±РѕС‚Рµ" },

  { value: "DONE", label: "Р’С‹РїРѕР»РЅРµРЅР°" },

  { value: "REJECTED", label: "РћС‚РєР»РѕРЅРµРЅР°" },

];



const TASK_STATUS_LABELS = {

  NEW: "РќРµ РІС‹РїРѕР»РЅРµРЅР°",

  IN_PROGRESS: "Р’ СЂР°Р±РѕС‚Рµ",

  DONE: "Р’С‹РїРѕР»РЅРµРЅР°",

  CANCELLED: "РћС‚РјРµРЅРµРЅР°",

};



const TASK_STATUS_OPTIONS = [

  { value: "NEW", label: "РќРµ РІС‹РїРѕР»РЅРµРЅР°" },

  { value: "IN_PROGRESS", label: "Р’ СЂР°Р±РѕС‚Рµ" },

  { value: "DONE", label: "Р’С‹РїРѕР»РЅРµРЅР°" },

  { value: "CANCELLED", label: "РћС‚РјРµРЅРµРЅР°" },

];



const PO_STATUS_LABELS = {
  DRAFT: "РќРµ РїРѕР»СѓС‡РµРЅ",
  SENT: "РќРµ РїРѕР»СѓС‡РµРЅ",
  PARTIAL: "Р§Р°СЃС‚РёС‡РЅРѕ",
  RECEIVED: "РџРѕР»СѓС‡РµРЅ",
  CLOSED: "РџРѕР»СѓС‡РµРЅ",
};


export default function Warehouse() {

  const { user } = useAuth();

  const isWarehouseManager =

    user?.role === "ADMIN" || user?.role === "ACCOUNTING";



  const [section, setSection] = useState("");
  const tasksRef = useRef(null);
  const inventoryRef = useRef(null);
  const locationsRef = useRef(null);
  const queueRef = useRef(null);
  const tsdRef = useRef(null);
  const transactionsRef = useRef(null);
  const revisionRef = useRef(null);
  const tmcRef = useRef(null);



  // ===== Р—РђРЇР’РљР РќРђ РЎРљР›РђР” =====

  const [taskForm, setTaskForm] = useState({

    title: "",

    description: "",

    dueDate: "",

    executorName: "",

    executorChatId: "",

  });



  const [taskMyList, setTaskMyList] = useState([]);

  const [taskAllList, setTaskAllList] = useState([]);

    const [taskView, setTaskView] = useState("new"); // 'new' | 'journal'

  const [taskTab, setTaskTab] = useState("my");

  const [taskFilterStatus, setTaskFilterStatus] = useState("ALL");

  const [taskFilterText, setTaskFilterText] = useState("");

  const [tasksLoading, setTasksLoading] = useState(true);

  const [taskSaving, setTaskSaving] = useState(false);

  const [taskStatusSavingId, setTaskStatusSavingId] = useState(null);

  const [taskError, setTaskError] = useState("");



  // ===== РРќР’Р•РќРўРђР РР—РђР¦РРЇ / РћРЎРўРђРўРљР / РџРћРЎРўРђР’Р©РРљР / Р—РђРљРЈРџРљР =====

  const [inventoryItems, setInventoryItems] = useState([]);

  const [inventoryStock, setInventoryStock] = useState([]);

  const [inventoryLoading, setInventoryLoading] = useState(true);

  const [inventoryError, setInventoryError] = useState("");

  const [tmcStock, setTmcStock] = useState([]);

  const [error, setError] = useState("");

  const [showImportModal, setShowImportModal] = useState(false);

  const [inventoryTab, setInventoryTab] = useState("stock"); // stock | items | movement | suppliers
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
    if (section === "items") {
      setInventoryTab("items");
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

  useEffect(() => {
    const refMap = {
      tasks: tasksRef,
      inventory: inventoryRef,
      items: inventoryRef,
      movement: inventoryRef,
      suppliers: inventoryRef,
      locations: locationsRef,
      queue: queueRef,
      tsd: tsdRef,
      transactions: transactionsRef,
      revision: revisionRef,
      tmc: tmcRef,
    };
    const target = refMap[section];
    if (target?.current) {
      target.current.scrollIntoView({ behavior: "smooth", block: "start" });
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



  // РџРѕСЃС‚Р°РІС‰РёРєРё

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



  // Р—Р°РєР°Р·С‹ РїРѕСЃС‚Р°РІС‰РёРєСѓ

  const [purchaseOrders, setPurchaseOrders] = useState([]);

  const [purchaseOrdersLoading, setPurchaseOrdersLoading] = useState(false);

  const [purchaseOrdersError, setPurchaseOrdersError] = useState("");

  const [showOrderModal, setShowOrderModal] = useState(false);

  const [orderItemsForModal, setOrderItemsForModal] = useState([]);

  const [showReceiveModal, setShowReceiveModal] = useState(false);



  const token = localStorage.getItem("token");

  const authHeaders = {

    Authorization: `Bearer ${token}`,

    "Content-Type": "application/json",

  };



  // ===== API: Р—РђРЇР’РљР =====



  // ===== API: Р—РђР”РђР§Р =====

  const loadTasks = async () => {

    try {

      setTasksLoading(true);

      setTaskError("");



      const myRes = await fetch(`${API}/warehouse/tasks/my`, {

        headers: authHeaders,

      });

      const myData = await myRes.json();

      if (!myRes.ok) {

        throw new Error(myData.message || "РћС€РёР±РєР° Р·Р°РіСЂСѓР·РєРё РІР°С€РёС… Р·Р°РґР°С‡ СЃРєР»Р°РґР°");

      }

      setTaskMyList(myData);



      if (isWarehouseManager) {

        const allRes = await fetch(`${API}/warehouse/tasks`, {

          headers: { Authorization: authHeaders.Authorization },

        });

        const allData = await allRes.json();

        if (!allRes.ok) {

          throw new Error(allData.message || "РћС€РёР±РєР° Р·Р°РіСЂСѓР·РєРё Р·Р°РґР°С‡ СЃРєР»Р°РґР°");

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



  // ===== API: РРќР’Р•РќРўРђР РР—РђР¦РРЇ / РћРЎРўРђРўРљР =====

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

        throw new Error(itemsData.message || "РћС€РёР±РєР° Р·Р°РіСЂСѓР·РєРё С‚РѕРІР°СЂРѕРІ");

      }

      if (!stockRes.ok) {

        throw new Error(stockData.message || "РћС€РёР±РєР° Р·Р°РіСЂСѓР·РєРё РѕСЃС‚Р°С‚РєРѕРІ");

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

  const loadTmcStock = async () => {
    try {
      const res = await fetch(`${API}/tmc/stock`, {
        headers: { Authorization: authHeaders.Authorization },
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || "РћС€РёР±РєР° Р·Р°РіСЂСѓР·РєРё РўРњР¦");
      }
      setTmcStock(data || []);
    } catch (e) {
      console.error(e);
      setError(e.message || "РћС€РёР±РєР° Р·Р°РіСЂСѓР·РєРё РўРњР¦");
    }
  };



  const loadSuppliers = async () => {

    try {

      setSuppliersLoading(true);

      setSuppliersError("");



      const res = await fetch(`${API}/suppliers`, {

        headers: { Authorization: authHeaders.Authorization },

      });

      const data = await res.json();



      if (!res.ok) {

        throw new Error(data.message || "РћС€РёР±РєР° Р·Р°РіСЂСѓР·РєРё РїРѕСЃС‚Р°РІС‰РёРєРѕРІ");

      }



      setSuppliers(data);

    } catch (e) {

      console.error(e);

      setSuppliersError(e.message);

    } finally {

      setSuppliersLoading(false);

    }

  };



  const loadPurchaseOrders = async () => {

    try {

      setPurchaseOrdersLoading(true);

      setPurchaseOrdersError("");



      const res = await fetch(`${API}/purchase-orders`, {

        headers: { Authorization: authHeaders.Authorization },

      });

      const data = await res.json();



      if (!res.ok) {

        throw new Error(

          data.message || "РћС€РёР±РєР° Р·Р°РіСЂСѓР·РєРё Р·Р°РєР°Р·РѕРІ РїРѕСЃС‚Р°РІС‰РёРєСѓ"

        );

      }



      setPurchaseOrders(data);

    } catch (e) {

      console.error(e);

      setPurchaseOrdersError(e.message);

    } finally {

      setPurchaseOrdersLoading(false);

    }

  };



  // ===== useEffects =====

  useEffect(() => {
    loadTasks();

    loadInventory();
    loadTmcStock();

    // eslint-disable-next-line react-hooks/exhaustive-deps

  }, []);



  useEffect(() => {

    const loadItemsForSuggestions = async () => {

      try {

        const res = await fetch(`${API}/inventory/items`, {

          headers: { Authorization: authHeaders.Authorization },

        });

        const data = await res.json();

        if (res.ok) {

          setInventoryItems(data);

        } else {

          console.error("РћС€РёР±РєР° Р·Р°РіСЂСѓР·РєРё РЅРѕРјРµРЅРєР»Р°С‚СѓСЂС‹:", data);

        }

      } catch (e) {

        console.error("РћС€РёР±РєР° Р·Р°РіСЂСѓР·РєРё РЅРѕРјРµРЅРєР»Р°С‚СѓСЂС‹:", e);

      }

    };



    loadItemsForSuggestions();

    // eslint-disable-next-line react-hooks/exhaustive-deps

  }, []);



  useEffect(() => {

    if (section !== "tasks") return;

    loadTasks();

    const intervalId = setInterval(() => {

      loadTasks();

    }, 30000);

    return () => clearInterval(intervalId);

    // eslint-disable-next-line react-hooks/exhaustive-deps

  }, [section]);
  useEffect(() => {

    if (section !== "inventory") return;



    const loadData = async () => {

      try {

        await loadInventory();

        await loadSuppliers();

        await loadPurchaseOrders();

      } catch (e) {

        console.error(e);

        setInventoryError(e.message);

      }

    };



    loadData();

    // eslint-disable-next-line react-hooks/exhaustive-deps

  }, [section]);



  // ===== РҐР•Р›РџР•Р Р« Р”Р›РЇ Р—РђРЇР’РћРљ =====

  



  



  // РўРѕРІР°СЂС‹, Сѓ РєРѕС‚РѕСЂС‹С… С‚РµРєСѓС‰РёР№ РѕСЃС‚Р°С‚РѕРє > 0 (РґР»СЏ РІС‹РїР°РґР°СЋС‰РµРіРѕ СЃРїРёСЃРєР° РІ Р·Р°СЏРІРєРµ)

  // ===== РҐР•Р›РџР•Р Р« Р”Р›РЇ Р—РђР”РђР§ =====

  const handleCreateTask = async (e) => {

    e.preventDefault();

    setTaskSaving(true);

    setTaskError("");



    try {

      const body = {

        title: taskForm.title.trim(),

        description: taskForm.description?.trim() || null,

        dueDate: taskForm.dueDate || null,

        executorName: taskForm.executorName?.trim() || null,

        executorChatId: taskForm.executorChatId?.trim() || null,

      };



      const res = await fetch(`${API}/warehouse/tasks`, {

        method: "POST",

        headers: authHeaders,

        body: JSON.stringify(body),

      });



      const data = await res.json();

      if (!res.ok) {

        throw new Error(data.message || "РћС€РёР±РєР° СЃРѕР·РґР°РЅРёСЏ Р·Р°РґР°С‡Рё");

      }



      setTaskForm({

        title: "",

        description: "",

        dueDate: "",

        executorName: "",

        executorChatId: "",

      });



      await loadTasks();

    } catch (e) {

      console.error(e);

      setTaskError(e.message);

    } finally {

      setTaskSaving(false);

    }

  };



  const handleTaskStatusChangeLocal = (id, newStatus) => {

    setTaskAllList((prev) =>

      prev.map((t) => (t.id === id ? { ...t, status: newStatus } : t))

    );

  };



  const handleTaskStatusSave = async (id) => {

    const task = taskAllList.find((t) => t.id === id);

    if (!task) return;



    setTaskStatusSavingId(id);

    setTaskError("");



    try {

      const res = await fetch(`${API}/warehouse/tasks/${id}/status`, {

        method: "PUT",

        headers: authHeaders,

        body: JSON.stringify({ status: task.status }),

      });



      const data = await res.json();

      if (!res.ok) {

        throw new Error(data.message || "РћС€РёР±РєР° РѕР±РЅРѕРІР»РµРЅРёСЏ СЃС‚Р°С‚СѓСЃР° Р·Р°РґР°С‡Рё");

      }



      await loadTasks();

    } catch (e) {

      console.error(e);

      setTaskError(e.message);

    } finally {

      setTaskStatusSavingId(null);

    }

  };



  const taskStatusBadgeClass = (status) => {

    if (status === "CANCELLED") return "badge badge--rejected";

    if (status === "DONE") return "badge badge--approved";

    if (status === "IN_PROGRESS") return "badge badge--pending";

    return "badge badge--pending";

  };



  const isTaskOverdue = (t) => {

    if (t.status === "DONE" || t.status === "CANCELLED") return false;

    if (!t.dueDate) return false;

    return new Date(t.dueDate) < new Date();

  };



  const taskListForTab = taskTab === "my" ? taskMyList : taskAllList;



  const filteredTasks = useMemo(() => {

    let res = taskListForTab;



    if (taskFilterStatus !== "ALL") {

      res = res.filter((t) => t.status === taskFilterStatus);

    }



    if (taskFilterText.trim()) {

      const q = taskFilterText.trim().toLowerCase();

      res = res.filter((t) => {

        const text = [

          t.title,

          t.description,

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



  // ===== РҐР•Р›РџР•Р Р« Р”Р›РЇ РРќР’Р•РќРўРђР РР—РђР¦РР / Р—РђРљРЈРџРћРљ =====

  const handleCreateItem = async (e) => {

    e.preventDefault();

    setInventoryError("");



    try {

      if (!itemForm.name.trim()) {

        return setInventoryError("РќР°РёРјРµРЅРѕРІР°РЅРёРµ С‚РѕРІР°СЂР° РѕР±СЏР·Р°С‚РµР»СЊРЅРѕ.");

      }

      if (!itemForm.sku.trim()) {

        return setInventoryError("РђСЂС‚РёРєСѓР» (SKU) РѕР±СЏР·Р°С‚РµР»РµРЅ.");

      }

      if (!itemForm.barcode.trim()) {

        return setInventoryError("РЁС‚СЂРёС…РєРѕРґ РѕР±СЏР·Р°С‚РµР»РµРЅ.");

      }

      if (!itemForm.unit.trim()) {

        return setInventoryError("Р•РґРёРЅРёС†Р° РёР·РјРµСЂРµРЅРёСЏ РѕР±СЏР·Р°С‚РµР»СЊРЅР°.");

      }



      const minVal = Number(itemForm.minStock);

      const maxVal = Number(itemForm.maxStock);

      const priceVal = Number(String(itemForm.defaultPrice).replace(",", "."));



      if (!Number.isFinite(minVal) || minVal <= 0) {

        return setInventoryError(

          "РњРёРЅРёРјР°Р»СЊРЅС‹Р№ РѕСЃС‚Р°С‚РѕРє РґРѕР»Р¶РµРЅ Р±С‹С‚СЊ РїРѕР»РѕР¶РёС‚РµР»СЊРЅС‹Рј С‡РёСЃР»РѕРј."

        );

      }



      if (!Number.isFinite(maxVal) || maxVal <= 0) {

        return setInventoryError(

          "РњР°РєСЃРёРјР°Р»СЊРЅС‹Р№ РѕСЃС‚Р°С‚РѕРє РґРѕР»Р¶РµРЅ Р±С‹С‚СЊ РїРѕР»РѕР¶РёС‚РµР»СЊРЅС‹Рј С‡РёСЃР»РѕРј."

        );

      }



      if (!Number.isFinite(priceVal) || priceVal <= 0) {

        return setInventoryError(

          "Р¦РµРЅР° Р·Р° РµРґРёРЅРёС†Сѓ РґРѕР»Р¶РЅР° Р±С‹С‚СЊ РїРѕР»РѕР¶РёС‚РµР»СЊРЅС‹Рј С‡РёСЃР»РѕРј."

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

        throw new Error(data.message || "РћС€РёР±РєР° СЃРѕР·РґР°РЅРёСЏ С‚РѕРІР°СЂР°");

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

        return setInventoryError("Р’С‹Р±РµСЂРёС‚Рµ С‚РѕРІР°СЂ Рё СѓРєР°Р¶РёС‚Рµ РєРѕР»РёС‡РµСЃС‚РІРѕ.");

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

          data.message || "РћС€РёР±РєР° СЃРѕР·РґР°РЅРёСЏ РґРІРёР¶РµРЅРёСЏ РїРѕ СЃРєР»Р°РґСѓ"

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

      `РЈРґР°Р»РёС‚СЊ С‚РѕРІР°СЂ "${itemName}" Рё РІСЃРµ РґРІРёР¶РµРЅРёСЏ РїРѕ РЅРµРјСѓ?`

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

          (data && data.message) || "РћС€РёР±РєР° РїСЂРё СѓРґР°Р»РµРЅРёРё С‚РѕРІР°СЂР°"

        );

      }



      await loadInventory();

    } catch (e) {

      console.error(e);

      setInventoryError(e.message);

    }

  };



  const handleDownloadLowStockOrder = async () => {

    try {

      setInventoryError("");



      const res = await fetch(`${API}/inventory/low-stock-order-file`, {

        headers: { Authorization: authHeaders.Authorization },

      });



      if (!res.ok) {

        let errorMessage = "РќРµ СѓРґР°Р»РѕСЃСЊ СЃС„РѕСЂРјРёСЂРѕРІР°С‚СЊ С„Р°Р№Р» Р·Р°РєР°Р·Р°";

        try {

          const data = await res.json();

          if (data?.message) errorMessage = data.message;

        } catch (e) {}

        throw new Error(errorMessage);

      }



      const blob = await res.blob();

      const url = window.URL.createObjectURL(blob);

      const a = document.createElement("a");

      a.href = url;

      a.download = "order_low_stock.xlsx";

      document.body.appendChild(a);

      a.click();

      a.remove();

      window.URL.revokeObjectURL(url);

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

      comment: "РџРѕСЃС‚СѓРїР»РµРЅРёРµ С‚РѕРІР°СЂР°",

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

        return setSuppliersError("РќР°Р·РІР°РЅРёРµ РїРѕСЃС‚Р°РІС‰РёРєР° РѕР±СЏР·Р°С‚РµР»СЊРЅРѕ.");

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

        throw new Error(data.message || "РћС€РёР±РєР° СЃРѕР·РґР°РЅРёСЏ РїРѕСЃС‚Р°РІС‰РёРєР°");

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



  const handleOpenPurchaseOrder = () => {

    setInventoryError("");



    if (!suppliers.length) {

      setSuppliersError(

        "РЎРЅР°С‡Р°Р»Р° СЃРѕР·РґР°Р№С‚Рµ С…РѕС‚СЏ Р±С‹ РѕРґРЅРѕРіРѕ РїРѕСЃС‚Р°РІС‰РёРєР° РЅРёР¶Рµ РЅР° СЃС‚СЂР°РЅРёС†Рµ."

      );

      return;

    }



    const itemsForOrder = inventoryStock

      .map((row) => {

        const orderQty = calculateOrderQtyForRow(row);

        if (orderQty <= 0) return null;



        const item = inventoryItems.find((it) => it.id === row.id);

        const defaultPrice = item?.defaultPrice || 0;



        return {

          id: row.id,

          name: row.name,

          unit: row.unit || "С€С‚",

          orderQty,

          price: defaultPrice,

        };

      })

      .filter(Boolean);



    if (!itemsForOrder.length) {

      setInventoryError(

        "РќРµС‚ С‚РѕРІР°СЂРѕРІ РЅРёР¶Рµ РјРёРЅРёРјР°Р»СЊРЅРѕРіРѕ РѕСЃС‚Р°С‚РєР°, Р·Р°РєР°Р· РЅРµ С‚СЂРµР±СѓРµС‚СЃСЏ."

      );

      return;

    }



    setOrderItemsForModal(itemsForOrder);

    setShowOrderModal(true);

  };



  const handlePurchaseOrderStatusReceived = async (orderId) => {

    const ok = window.confirm("РџСЂРѕРІРµСЃС‚Рё Р·Р°РєР°Р· Рё РѕРїСЂРёС…РѕРґРѕРІР°С‚СЊ С‚РѕРІР°СЂ РЅР° СЃРєР»Р°Рґ?");

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

          data.message || "РћС€РёР±РєР° СЃРјРµРЅС‹ СЃС‚Р°С‚СѓСЃР° Р·Р°РєР°Р·Р° РїРѕСЃС‚Р°РІС‰РёРєСѓ"

        );

      }



      await loadPurchaseOrders();

      await loadInventory();

    } catch (e) {

      console.error(e);

      setPurchaseOrdersError(e.message);

    }

  };



    const sortedPurchaseOrders = useMemo(() => {

    return [...purchaseOrders].sort((a, b) => {

      const da = a.createdAt ? new Date(a.createdAt).getTime() : 0;

      const db = b.createdAt ? new Date(b.createdAt).getTime() : 0;

      return db - da; // РЅРѕРІС‹Рµ СЃРІРµСЂС…Сѓ

    });

  }, [purchaseOrders]);



  let lastPurchaseOrderDate = "";



  return (

    <div className="page">

      <div className="page-header">

        <h1 className="page-title">РЎРєР»Р°Рґ</h1>

        <p className="page-subtitle">

          Р—Р°СЏРІРєРё, Р·Р°РґР°С‡Рё Рё СѓС‡С‘С‚ РѕСЃС‚Р°С‚РєРѕРІ РЅР° СЃРєР»Р°РґРµ.

        </p>

      </div>



      {/* Р’РµСЂС…РЅРёРµ РєР°СЂС‚РѕС‡РєРё-РїРѕРґСЂР°Р·РґРµР»С‹ СЃРєР»Р°РґР° */}

      <div className="warehouse-section">

        <div className="warehouse-grid"><button

            type="button"

            className={

              "warehouse-card" +

              (section === "tasks" ? " warehouse-card--active" : "")

            }

            onClick={() => setSection("tasks")}

          >

            <div className="warehouse-card__icon">

              <WarehouseTileIcon name="tasks" />
            </div>

            <div className="warehouse-card__body">

              <div className="warehouse-card__title">Р—Р°РґР°С‡Рё СЃРєР»Р°РґР°</div>

              <div className="warehouse-card__subtitle">

                РќР°Р·РЅР°С‡РµРЅРёРµ Р·Р°РґР°С‡, СЃСЂРѕРєРё Рё РЅР°РїРѕРјРёРЅР°РЅРёСЏ РІ Telegram.

              </div>

            </div>

          </button>



          <button

            type="button"

            className={

              "warehouse-card" +

              (section === "inventory" ? " warehouse-card--active" : "")

            }

            onClick={() => setSection("inventory")}

          >

            <div className="warehouse-card__icon">

              <WarehouseTileIcon name="inventory" />
            </div>

            <div className="warehouse-card__body">

              <div className="warehouse-card__title">РћСЃС‚Р°С‚РєРё</div>

              <div className="warehouse-card__subtitle">

                РўРµРєСѓС‰РёРµ РѕСЃС‚Р°С‚РєРё РїРѕ СЃРєР»Р°РґСѓ.

              </div>

            </div>

          </button>

          <button
            type="button"
            className={
              "warehouse-card" +
              (section === "items" ? " warehouse-card--active" : "")
            }
            onClick={() => setSection("items")}
          >
            <div className="warehouse-card__icon">
              <WarehouseTileIcon name="items" />
            </div>
            <div className="warehouse-card__body">
              <div className="warehouse-card__title">РќРѕРјРµРЅРєР»Р°С‚СѓСЂР°</div>
              <div className="warehouse-card__subtitle">
                РЎРїСЂР°РІРѕС‡РЅРёРє С‚РѕРІР°СЂРѕРІ.
              </div>
            </div>
          </button>

          <button
            type="button"
            className={
              "warehouse-card" +
              (section === "movement" ? " warehouse-card--active" : "")
            }
            onClick={() => setSection("movement")}
          >
            <div className="warehouse-card__icon">
              <WarehouseTileIcon name="movement" />
            </div>
            <div className="warehouse-card__body">
              <div className="warehouse-card__title">
                {"\u0418\u0441\u0442\u043e\u0440\u0438\u044f \u0434\u0432\u0438\u0436\u0435\u043d\u0438\u0439"}
              </div>
              <div className="warehouse-card__subtitle">
                {"\u0416\u0443\u0440\u043d\u0430\u043b \u043e\u043f\u0435\u0440\u0430\u0446\u0438\u0439 \u043f\u043e \u0441\u043a\u043b\u0430\u0434\u0443."}
              </div>
            </div>
          </button>

          <button
            type="button"
            className={
              "warehouse-card" +
              (section === "transactions" ? " warehouse-card--active" : "")
            }
            onClick={() => setSection("transactions")}
          >
            <div className="warehouse-card__icon">
              <WarehouseTileIcon name="transactions" />
            </div>
            <div className="warehouse-card__body">
              <div className="warehouse-card__title">РўСЂР°РЅР·Р°РєС†РёРё</div>
              <div className="warehouse-card__subtitle">
                Р’СЃРµ РґРµР№СЃС‚РІРёСЏ РїРѕ СЏС‡РµР№РєР°Рј Рё С‚РѕРІР°СЂСѓ.
              </div>
            </div>
          </button>

          <button
            type="button"
            className={
              "warehouse-card" +
              (section === "revision" ? " warehouse-card--active" : "")
            }
            onClick={() => setSection("revision")}
          >
            <div className="warehouse-card__icon">
              <WarehouseTileIcon name="revision" />
            </div>
            <div className="warehouse-card__body">
              <div className="warehouse-card__title">{"\u0420\u0435\u0432\u0438\u0437\u0438\u044f"}</div>
              <div className="warehouse-card__subtitle">
                {"\u0421\u043d\u0438\u043c\u043e\u043a \u0440\u0430\u0441\u0445\u043e\u0436\u0434\u0435\u043d\u0438\u0439 \u043f\u043e \u043a\u043e\u043d\u0442\u0440\u043e\u043b\u044e \u044f\u0447\u0435\u0435\u043a."}
              </div>
            </div>
          </button>

          <button
            type="button"
            className={
              "warehouse-card" +
              (section === "tmc" ? " warehouse-card--active" : "")
            }
            onClick={() => setSection("tmc")}
          >
            <div className="warehouse-card__icon">
              <WarehouseTileIcon name="tmc" />
            </div>
            <div className="warehouse-card__body">
              <div className="warehouse-card__title">{"\u0422\u041c\u0426"}</div>
              <div className="warehouse-card__subtitle">
                {"\u0420\u0430\u0441\u0445\u043e\u0434\u043d\u044b\u0435 \u043c\u0430\u0442\u0435\u0440\u0438\u0430\u043b\u044b \u0434\u043b\u044f \u043e\u0442\u0434\u0435\u043b\u043e\u0432 \u0438 \u0441\u043e\u0442\u0440\u0443\u0434\u043d\u0438\u043a\u043e\u0432."}
              </div>
            </div>
          </button>



          <button
            type="button"
            className={
              "warehouse-card" +
              (section === "suppliers" ? " warehouse-card--active" : "")
            }
            onClick={() => setSection("suppliers")}
          >
            <div className="warehouse-card__icon">
              <WarehouseTileIcon name="suppliers" />
            </div>
            <div className="warehouse-card__body">
              <div className="warehouse-card__title">РџРѕСЃС‚Р°РІС‰РёРєРё</div>
              <div className="warehouse-card__subtitle">
                РџРѕСЃС‚Р°РІС‰РёРєРё Рё Р·Р°РєР°Р·С‹ РїРѕСЃС‚Р°РІС‰РёРєСѓ.
              </div>
            </div>
          </button>

          <button

            type="button"

            className={

              "warehouse-card" +

              (section === "locations" ? " warehouse-card--active" : "")

            }

            onClick={() => setSection("locations")}

          >

            <div className="warehouse-card__icon">
              <WarehouseTileIcon name="locations" />
            </div>
            <div className="warehouse-card__body">

              <div className="warehouse-card__title">{"\РЎ\Рї\СЂ\Р°\РІ\Рѕ\С‡\РЅ\Рё\Рє \СЏ\С‡\Рµ\Рµ\Рє"}</div>

              <div className="warehouse-card__subtitle">

                {"\РЎ\Рѕ\Р·\Рґ\Р°\РЅ\Рё\Рµ \СЏ\С‡\Рµ\Рµ\Рє \Рё \Рї\Рµ\С‡\Р°\С‚\СЊ QR-\СЌ\С‚\Рё\Рє\Рµ\С‚\Рѕ\Рє\."}

              </div>

            </div>

          </button>



          <button

  type="button"

  className={

    "warehouse-card" +

    (section === "queue" ? " warehouse-card--active" : "")

  }

  onClick={() => setSection("queue")}

>

  <div className="warehouse-card__icon">

    <WarehouseTileIcon name="queue" />
  </div>

  <div className="warehouse-card__body">

    <div className="warehouse-card__title">

      РњР°С€РёРЅС‹ РїРѕСЃС‚Р°РІС‰РёРєРѕРІ РІ РѕС‡РµСЂРµРґРё

    </div>

    <div className="warehouse-card__subtitle">

      РћС‡РµСЂРµРґСЊ РЅР° СЂР°Р·РіСЂСѓР·РєСѓ, РІРѕСЂРѕС‚Р° Рё РІСЂРµРјСЏ.

    </div>

  </div>

</button>

<button

  type="button"

  className={

    "warehouse-card" +

    (section === "tsd" ? " warehouse-card--active" : "")

  }

  onClick={() => setSection("tsd")}

>

  <div className="warehouse-card__icon">

    <WarehouseTileIcon name="tsd" />
  </div>

  <div className="warehouse-card__body">

    <div className="warehouse-card__title">РњРѕР±РёР»СЊРЅС‹Р№ РўРЎР”</div>

    <div className="warehouse-card__subtitle">

      РЎРєР°РЅРёСЂРѕРІР°РЅРёРµ С€С‚СЂРёС…РєРѕРґРѕРІ Рё Р±С‹СЃС‚СЂС‹Рµ РѕРїРµСЂР°С†РёРё.

    </div>

  </div>

</button>

        </div>

      </div>



            {/* ====== Р—РђРЇР’РљР ====== */}>

          {/* Р’РєР»Р°РґРєРё РІРЅСѓС‚СЂРё СЂР°Р·РґРµР»Р° Р·Р°СЏРІРѕРє */}

          <div className="tabs tabs--sm" style={{ marginBottom: 16 }}>
            <button
              type="button"
              className={
                "tabs__btn " +{section === "tasks" && (

        <div className="tasks-section" ref={tasksRef}>

          {/* Р’РєР»Р°РґРєРё: РќРѕРІР°СЏ Р·Р°РґР°С‡Р° / Р–СѓСЂРЅР°Р» Р·Р°РґР°С‡ */}

          <div className="tabs tabs--sm" style={{ marginBottom: 16 }}>

            <button

              type="button"

              className={

                "tabs__btn " + (taskView === "new" ? "tabs__btn--active" : "")

              }

              onClick={() => setTaskView("new")}

            >

              РќРѕРІР°СЏ Р·Р°РґР°С‡Р°

            </button>

            <button

              type="button"

              className={

                "tabs__btn " +

                (taskView === "journal" ? "tabs__btn--active" : "")

              }

              onClick={() => setTaskView("journal")}

            >

              Р–СѓСЂРЅР°Р» Р·Р°РґР°С‡

            </button>

          </div>



          {/* Р’РєР»Р°РґРєР°: РќРѕРІР°СЏ Р·Р°РґР°С‡Р° */}

          {taskView === "new" && (

            <div className="card card--1c">

              <div className="card1c__header">РќРѕРІР°СЏ Р·Р°РґР°С‡Р°</div>

              <div className="card1c__body">

                {taskError && (

                  <div

                    className="alert alert--danger"

                    style={{ marginBottom: 8 }}

                  >

                    {taskError}

                  </div>

                )}



                <form

                  onSubmit={handleCreateTask}

                  className="form request-form-1c"

                >

                  <div className="form__group">

                    <label className="form__label">Р—Р°РіРѕР»РѕРІРѕРє</label>

                    <input

                      type="text"

                      className="form__input"

                      value={taskForm.title}

                      onChange={(e) =>

                        setTaskForm({ ...taskForm, title: e.target.value })

                      }

                      placeholder="Р§С‚Рѕ СЃРґРµР»Р°С‚СЊ?"

                      required

                    />

                  </div>



                  <div className="form__group">

                    <label className="form__label">РћРїРёСЃР°РЅРёРµ</label>

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

                      placeholder="РџРѕРґСЂРѕР±РЅРѕСЃС‚Рё..."

                    />

                  </div>



                  <div className="form__group">

                    <label className="form__label">РЎСЂРѕРє (РґР°С‚Р° Рё РІСЂРµРјСЏ)</label>

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

                    <label className="form__label">РСЃРїРѕР»РЅРёС‚РµР»СЊ (РёРјСЏ)</label>

                    <input

                      type="text"

                      className="form__input"

                      value={taskForm.executorName}

                      onChange={(e) =>

                        setTaskForm({

                          ...taskForm,

                          executorName: e.target.value,

                        })

                      }

                      placeholder="РРІР°РЅ РРІР°РЅРѕРІ"

                    />

                  </div>



                  <div className="form__group">

                    <label className="form__label">

                      ID РёСЃРїРѕР»РЅРёС‚РµР»СЏ РІ Telegram

                    </label>

                    <input

                      type="text"

                      className="form__input"

                      value={taskForm.executorChatId}

                      onChange={(e) =>

                        setTaskForm({

                          ...taskForm,

                          executorChatId: e.target.value,

                        })

                      }

                      placeholder="РќР°РїСЂРёРјРµСЂ: 514030529"

                    />

                  </div>



                  <div className="request-form-1c__actions">

                    <button

                      type="submit"

                      className="btn btn--primary"

                      disabled={taskSaving}

                    >

                      {taskSaving ? "РЎРѕР·РґР°РЅРёРµ..." : "РЎРѕР·РґР°С‚СЊ Р·Р°РґР°С‡Сѓ"}

                    </button>

                  </div>

                </form>

              </div>

            </div>

          )}



          {/* Р’РєР»Р°РґРєР°: Р–СѓСЂРЅР°Р» Р·Р°РґР°С‡ (С‚Р°Р±Р»РёС†Р° РєР°Рє РСЃС‚РѕСЂРёСЏ РґРІРёР¶РµРЅРёР№) */}

          {taskView === "journal" && (

            <div className="card card--1c">

              <div className="card1c__header">Р–СѓСЂРЅР°Р» Р·Р°РґР°С‡</div>

              <div className="card1c__body">

                {/* Р¤РёР»СЊС‚СЂС‹ СЃРІРµСЂС…Сѓ, РІ СЃС‚РёР»Рµ РСЃС‚РѕСЂРёРё РґРІРёР¶РµРЅРёР№ */}

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

                    <label className="form__label">РЎС‚Р°С‚СѓСЃ</label>

                    <select

                      className="form__select"

                      value={taskFilterStatus}

                      onChange={(e) => setTaskFilterStatus(e.target.value)}

                    >

                      <option value="ALL">Р’СЃРµ СЃС‚Р°С‚СѓСЃС‹</option>

                      {TASK_STATUS_OPTIONS.map((opt) => (

                        <option key={opt.value} value={opt.value}>

                          {opt.label}

                        </option>

                      ))}

                    </select>

                  </div>



                  {isWarehouseManager && (

                    <div>

                      <label className="form__label">РЎРїРёСЃРѕРє Р·Р°РґР°С‡</label>

                      <select

                        className="form__select"

                        value={taskTab}

                        onChange={(e) => setTaskTab(e.target.value)}

                      >

                        <option value="my">РњРѕРё Р·Р°РґР°С‡Рё</option>

                        <option value="all">Р’СЃРµ Р·Р°РґР°С‡Рё</option>

                      </select>

                    </div>

                  )}



                  <div style={{ flex: 1, minWidth: 200 }}>

                    <label className="form__label">РџРѕРёСЃРє</label>

                    <input

                      type="text"

                      className="form__input"

                      placeholder="Р—Р°РіРѕР»РѕРІРѕРє, РёСЃРїРѕР»РЅРёС‚РµР»СЊ, Р°РІС‚РѕСЂ..."

                      value={taskFilterText}

                      onChange={(e) => setTaskFilterText(e.target.value)}

                    />

                  </div>

                </div>



                {tasksLoading ? (

                  <p>Р—Р°РіСЂСѓР·РєР°...</p>

                ) : filteredTasks.length === 0 ? (

                  <p className="text-muted">Р—Р°РґР°С‡ РЅРµ РЅР°Р№РґРµРЅРѕ.</p>

                ) : (

                  <div className="table-wrapper tasks-journal-table">

                    <table className="table">

                      <thead>

                        <tr>

                          <th style={{ width: 40 }}>в„–</th>

                          <th style={{ width: 170 }}>Р”Р°С‚Р°</th>

                          <th style={{ width: 110 }}>РЎС‚Р°С‚СѓСЃ</th>

                          <th style={{ width: 170 }}>РЎСЂРѕРє</th>

                          <th>Р—Р°РґР°С‡Р°</th>

                          <th style={{ width: 180 }}>РСЃРїРѕР»РЅРёС‚РµР»СЊ</th>

                          <th style={{ width: 200 }}>РђРІС‚РѕСЂ</th>

                          <th style={{ width: 260 }}>РћРїРёСЃР°РЅРёРµ</th>

                          {isWarehouseManager && (

  <th style={{ width: 190 }}>Р”РµР№СЃС‚РІРёСЏ</th>

)}

                        </tr>

                      </thead>

                      <tbody>

                        {filteredTasks.map((t, index) => {

                          const overdue = isTaskOverdue(t);

                          return (

                            <tr key={t.id} className="tasks-journal-row">

                              <td data-label="index">{index + 1}</td>

                              <td>

                                {t.createdAt

                                  ? new Date(

                                      t.createdAt

                                    ).toLocaleString("ru-RU", {

                                      day: "2-digit",

                                      month: "2-digit",

                                      year: "numeric",

                                      hour: "2-digit",

                                      minute: "2-digit",

                                    })

                                  : "-"}

                              </td>

                              <td>

                                <span

                                  className={taskStatusBadgeClass(t.status)}

                                >

                                  {TASK_STATUS_LABELS[t.status] || t.status}

                                </span>

                              </td>

                              <td>

                                {t.dueDate

                                  ? new Date(

                                      t.dueDate

                                    ).toLocaleString("ru-RU", {

                                      day: "2-digit",

                                      month: "2-digit",

                                      year: "numeric",

                                      hour: "2-digit",

                                      minute: "2-digit",

                                    })

                                  : "-"}

                                {overdue && (

                                  <span

                                    style={{

                                      color: "red",

                                      marginLeft: 4,

                                      fontSize: "0.85em",

                                    }}

                                  >

                                    (РїСЂРѕСЃСЂРѕС‡РµРЅРѕ)

                                  </span>

                                )}

                              </td>

                              <td data-label="title">{t.title}</td>

                              <td>

                                {t.executorName || t.executorChatId

                                  ? `${t.executorName || ""}${

                                      t.executorChatId

                                        ? ` (TG: ${t.executorChatId})`

                                        : ""

                                    }`

                                  : "-"}

                              </td>

                              <td>

                                {t.assigner?.name ||

                                  t.assigner?.email ||

                                  "-"}

                              </td>

                              <td data-label="desc">{t.description || "-"}</td>

                              {isWarehouseManager && (

  <td>

    <select

      className="form__select form__select--sm"

      style={{ minWidth: 170 }}

      value={t.status}

      onChange={(e) =>

        handleTaskStatusChangeLocal(t.id, e.target.value)

      }

      onBlur={() => handleTaskStatusSave(t.id)}

      disabled={taskStatusSavingId === t.id}

    >

      {TASK_STATUS_OPTIONS.map((o) => (

        <option key={o.value} value={o.value}>

          {o.label}

        </option>

      ))}

    </select>

  </td>

)}

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



            {/* ====== РћР§Р•Р Р•Р”Р¬ РњРђРЁРРќ РџРћРЎРўРђР’Р©РРљРћР’ ====== */}

      {section === "locations" && (

        <div className="locations-section" ref={locationsRef}>

          <WarehouseLocationsPanel />

        </div>

      )}



      {section === "queue" && (

        <div className="queue-section" ref={queueRef}>

          <SupplierTrucksQueueTab />

        </div>

      )}



      {section === "tsd" && (

  <div className="tsd-section" ref={tsdRef}>

    {/* СЃСЋРґР° РІС‹РЅРµСЃРµРј РѕС‚РґРµР»СЊРЅС‹Р№ РєРѕРјРїРѕРЅРµРЅС‚, С‡С‚РѕР±С‹ РЅРµ СЂР°Р·РґСѓРІР°С‚СЊ С„Р°Р№Р» */}

    <MobileTsdTab />

  </div>

)}

      {section === "transactions" && (
        <div className="inventory-section" ref={transactionsRef}>
          <StockTransactionsTab />
        </div>
      )}

      {section === "revision" && (
        <div className="inventory-section" ref={revisionRef}>
          <StockRevisionTab />
        </div>
      )}

      {section === "tmc" && (
        <div className="inventory-section" ref={tmcRef}>
          <TmcTab />
        </div>
      )}




      {/* ====== РћРЎРўРђРўРљР / РРќР’Р•РќРўРђР РР—РђР¦РРЇ / Р—РђРљРЈРџРљР ====== */}

      {["inventory","items","movement","suppliers"].includes(section) && (

        <div className="inventory-section" ref={inventoryRef}>

          {/* Р’РЅСѓС‚СЂРµРЅРЅРёРµ РІРєР»Р°РґРєРё */}

          
          {inventoryTab === "movement" && (
            <div className="tabs tabs--sm inventory-subtabs" style={{ marginBottom: 12 }}>
              <button
                type="button"
                className={
                  "tabs__btn " + (movementTab === "movementsHistory" ? "tabs__btn--active" : "")
                }
                onClick={() => setMovementTab("movementsHistory")}
              >
                РСЃС‚РѕСЂРёСЏ РґРІРёР¶РµРЅРёР№
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
                РџРѕСЃС‚Р°РІС‰РёРєРё
              </button>
              <button
                type="button"
                className={
                  "tabs__btn " + (suppliersTab === "orders" ? "tabs__btn--active" : "")
                }
                onClick={() => setSuppliersTab("orders")}
              >
                Р—Р°РєР°Р·С‹ РїРѕСЃС‚Р°РІС‰РёРєСѓ
              </button>
            </div>
          )}



          {/* ===== Р’РєР»Р°РґРєР° 1: РќРѕРјРµРЅРєР»Р°С‚СѓСЂР° ===== */}

{inventoryTab === "items" && (

  <div className="grid-2">

    <div className="card" style={{ gridColumn: "span 2" }}>

      <div

        style={{

          display: "flex",

          gap: 16,

          alignItems: "center",

        }}

      >

        <h2 className="card__title" style={{ margin: 0 }}>

          РќРѕРјРµРЅРєР»Р°С‚СѓСЂР°

        </h2>

        <button

          className="btn btn--secondary"

          onClick={() => setShowImportModal(true)}

        >

          РРјРїРѕСЂС‚ РёР· Excel

        </button>

      </div>

      {inventoryError && (

        <div

          className="alert alert--danger"

          style={{ marginTop: 16 }}

        >

          {inventoryError}

        </div>

      )}

    </div>



    {/* Р¤РѕСЂРјР° "РќРѕРІС‹Р№ С‚РѕРІР°СЂ" С‚РµРїРµСЂСЊ РЅР° РІСЃСЋ С€РёСЂРёРЅСѓ */}

    <div className="card card--1c" style={{ gridColumn: "span 2" }}>

      <div className="card1c__header">РќРѕРІС‹Р№ С‚РѕРІР°СЂ</div>

      <div className="card1c__body">

        <form

          onSubmit={handleCreateItem}

          className="form request-form-1c"

        >

          <div className="form__group">

            <label className="form__label">РќР°РёРјРµРЅРѕРІР°РЅРёРµ</label>

            <input

              className="form__input"

              value={itemForm.name}

              onChange={(e) =>

                setItemForm({ ...itemForm, name: e.target.value })

              }

              placeholder="РќР°РїСЂРёРјРµСЂ: Р‘СѓРјР°РіР° Рђ4"

            />

          </div>



          <div className="form__group">

            <label className="form__label">РђСЂС‚РёРєСѓР» (SKU)</label>

            <input

              className="form__input"

              value={itemForm.sku}

              onChange={(e) =>

                setItemForm({ ...itemForm, sku: e.target.value })

              }

            />

          </div>



          <div className="form__group">

            <label className="form__label">РЁС‚СЂРёС…РєРѕРґ</label>

            <input

              className="form__input"

              value={itemForm.barcode}

              onChange={(e) =>

                setItemForm({ ...itemForm, barcode: e.target.value })

              }

            />

          </div>



          <div className="form__group">

            <label className="form__label">Р•Рґ. РёР·Рј.</label>

            <input

              className="form__input"

              value={itemForm.unit}

              onChange={(e) =>

                setItemForm({ ...itemForm, unit: e.target.value })

              }

              placeholder="С€С‚, РєРі..."

            />

          </div>



          <div className="form__group">

            <label className="form__label">Р¦РµРЅР° (РїРѕ СѓРјРѕР»С‡Р°РЅРёСЋ)</label>

            <input

              className="form__input"

              type="number"

              step="0.01"

              value={itemForm.defaultPrice}

              onChange={(e) =>

                setItemForm({

                  ...itemForm,

                  defaultPrice: e.target.value,

                })

              }

            />

          </div>



          <div className="form__group">

            <label className="form__label">РњРёРЅ. РѕСЃС‚Р°С‚РѕРє</label>

            <input

              className="form__input"

              type="number"

              value={itemForm.minStock}

              onChange={(e) =>

                setItemForm({

                  ...itemForm,

                  minStock: e.target.value,

                })

              }

            />

          </div>



          <div className="form__group">

            <label className="form__label">РњР°РєСЃ. РѕСЃС‚Р°С‚РѕРє</label>

            <input

              className="form__input"

              type="number"

              value={itemForm.maxStock}

              onChange={(e) =>

                setItemForm({

                  ...itemForm,

                  maxStock: e.target.value,

                })

              }

            />

          </div>



          <div className="request-form-1c__actions">

            <button type="submit" className="btn btn--primary">

              РЎРѕР·РґР°С‚СЊ С‚РѕРІР°СЂ

            </button>

          </div>

        </form>

      </div>

    </div>

  </div>

)}



          {/* ===== Р’РєР»Р°РґРєР° 2: РћСЃС‚Р°С‚РєРё (1РЎ + РїРµС‡Р°С‚СЊ Р°РєС‚Р° СЂРµРІРёР·РёРё) ===== */}

          {inventoryTab === "stock" && <StockAuditTab />}



          {/* ===== Р’РєР»Р°РґРєР° 3: Р”РІРёР¶РµРЅРёРµ С‚РѕРІР°СЂР° (С‚РѕР»СЊРєРѕ С„РѕСЂРјР°) ===== */}

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

                  <span>Р”РІРёР¶РµРЅРёРµ С‚РѕРІР°СЂР°</span>

                  <button

                    type="button"

                    className="btn btn--secondary btn--sm"

                    onClick={() => {

                      console.log(

                        "CLICK РџРћ Р—РђРљРЈРџРЈ, showReceiveModal Р±С‹Р»Рѕ:",

                        showReceiveModal

                      );

                      setShowReceiveModal(true);

                    }}

                  >

                    Р—Р°РєСѓРї РїРѕ Р·Р°РєР°Р·Сѓ

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

                      <label className="form__label">РўРёРї РѕРїРµСЂР°С†РёРё</label>

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

                        <option value="INCOME">РџСЂРёС…РѕРґ</option>

                        <option value="ISSUE">Р Р°СЃС…РѕРґ</option>

                        <option value="ADJUSTMENT">РљРѕСЂСЂРµРєС‚РёСЂРѕРІРєР°</option>

                      </select>

                    </div>



                    <div className="form__group">

                      <label className="form__label">РўРѕРІР°СЂ</label>

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

                        <option value="">-- Р’С‹Р±РµСЂРёС‚Рµ С‚РѕРІР°СЂ --</option>

                        {inventoryItems.map((it) => (

                          <option key={it.id} value={it.id}>

                            {it.name} (РћСЃС‚Р°С‚РѕРє:{" "}

                            {currentStockForItem(it.id)} {it.unit})

                          </option>

                        ))}

                      </select>

                    </div>



                    <div className="form__group">

                      <label className="form__label">РљРѕР»РёС‡РµСЃС‚РІРѕ</label>

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

                          placeholder="РќР°РїСЂРёРјРµСЂ: 5 РёР»Рё -5"

                        />

                      </div>

                    </div>



                    <div className="form__group">

                      <label className="form__label">РљРѕРјРјРµРЅС‚Р°СЂРёР№</label>

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

                        РџСЂРѕРІРµСЃС‚Рё РґРІРёР¶РµРЅРёРµ

                      </button>

                    </div>

                  </form>

                </div>

              </div>

            </div>

          )}



          {/* ===== Р’РєР»Р°РґРєР° 4: РСЃС‚РѕСЂРёСЏ РґРІРёР¶РµРЅРёР№ (1РЎ) ===== */}

          {inventoryTab === "movement" && movementTab === "movementsHistory" && <StockMovementsHistoryTab />}

          {/* ===== Р’РєР»Р°РґРєР° 5: РџРѕСЃС‚Р°РІС‰РёРєРё ===== */}
          {inventoryTab === "suppliers" && suppliersTab === "suppliers" && (
            <div className="grid-2">

              <div className="card card--1c" style={{ gridColumn: "span 2" }}>

                <div className="card1c__header">РџРѕСЃС‚Р°РІС‰РёРєРё</div>

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

                      <label className="form__label">РќР°Р·РІР°РЅРёРµ</label>

                      <input

                        className="form__input"

                        value={supplierForm.name}

                        onChange={(e) =>

                          setSupplierForm({

                            ...supplierForm,

                            name: e.target.value,

                          })

                        }

                        placeholder="РћРћРћ РџРѕСЃС‚Р°РІС‰РёРє"

                      />

                    </div>



                    <div className="form__group">

                      <label className="form__label">РРќРќ</label>

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

                      <label className="form__label">РўРµР»РµС„РѕРЅ</label>

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

                      <label className="form__label">РљРѕРјРјРµРЅС‚Р°СЂРёР№</label>

                      <input

                        className="form__input"

                        value={supplierForm.comment}

                        onChange={(e) =>

                          setSupplierForm({

                            ...supplierForm,

                            comment: e.target.value,

                          })

                        }

                        placeholder="РЈСЃР»РѕРІРёСЏ РѕРїР»Р°С‚С‹, РєРѕРЅС‚Р°РєС‚С‹ РјРµРЅРµРґР¶РµСЂР°..."

                      />

                    </div>



                    <div className="request-form-1c__actions">

                      <button type="submit" className="btn btn--primary">

                        РЎРѕС…СЂР°РЅРёС‚СЊ РїРѕСЃС‚Р°РІС‰РёРєР°

                      </button>

                    </div>

                  </form>



                  {suppliersLoading ? (

                    <p>Р—Р°РіСЂСѓР·РєР°...</p>

                  ) : suppliers.length === 0 ? (

                    <p className="text-muted">РџРѕСЃС‚Р°РІС‰РёРєРѕРІ РїРѕРєР° РЅРµС‚.</p>

                  ) : (

                    <div className="table-wrapper">

                      <table className="table">

                        <thead>

                          <tr>

                            <th>ID</th>

                            <th>РќР°Р·РІР°РЅРёРµ</th>

                            <th>РРќРќ</th>

                            <th>РўРµР»РµС„РѕРЅ</th>

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



                    {/* ===== Р’РєР»Р°РґРєР° 6: Р—Р°РєР°Р·С‹ РїРѕСЃС‚Р°РІС‰РёРєСѓ ===== */}

          {inventoryTab === "suppliers" && suppliersTab === "orders" && (

            <div className="grid-2">

              <div className="card card--1c" style={{ gridColumn: "span 2" }}>

                <div className="card1c__header">Р—Р°РєР°Р·С‹ РїРѕСЃС‚Р°РІС‰РёРєСѓ</div>

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

                      РЎРѕР·РґР°С‚СЊ Р·Р°РєР°Р· РїРѕСЃС‚Р°РІС‰РёРєСѓ

                    </button>

                    <button

                      className="btn btn--secondary"

                      onClick={handleDownloadLowStockOrder}

                    >

                      РЎРєР°С‡Р°С‚СЊ Р·Р°РєР°Р· (Low Stock)

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

                    <p>Р—Р°РіСЂСѓР·РєР° Р·Р°РєР°Р·РѕРІ...</p>

                  ) : sortedPurchaseOrders.length === 0 ? (

                    <p className="text-muted">Р—Р°РєР°Р·РѕРІ РїРѕРєР° РЅРµС‚.</p>

                  ) : (

                    <div className="table-wrapper">

                      <table className="table">

                        <thead>

                          <tr>

                            <th>ID</th>

                            <th>Р’СЂРµРјСЏ</th>

                            <th>РџРѕСЃС‚Р°РІС‰РёРє</th>

                            <th>РЎС‚Р°С‚СѓСЃ</th>

                            <th></th>

                          </tr>

                        </thead>

                        <tbody>

                          {sortedPurchaseOrders.map((po) => {

                            const dateObj = po.createdAt

                              ? new Date(po.createdAt)

                              : null;



                            const dateStr = dateObj

                              ? dateObj.toLocaleDateString("ru-RU", {

                                  day: "2-digit",

                                  month: "2-digit",

                                  year: "numeric",

                                })

                              : "Р‘РµР· РґР°С‚С‹";



                            const timeStr = dateObj

                              ? dateObj.toLocaleTimeString("ru-RU", {

                                  hour: "2-digit",

                                  minute: "2-digit",

                                })

                              : "-";



                            const showDateRow =

                              dateStr !== lastPurchaseOrderDate;

                            if (showDateRow) {

                              lastPurchaseOrderDate = dateStr;

                            }



                            return (

                              <Fragment key={po.id}>

                                {showDateRow && (

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

                                      {dateStr}

                                    </td>

                                  </tr>

                                )}



                                <tr>

                                  <td>{po.id}</td>

                                  <td>{timeStr}</td>

                                  <td>{po.supplier?.name || "-"}</td>

                                  <td>

                                    {PO_STATUS_LABELS[po.status] || po.status}

                                  </td>

                                  <td></td>

                                </tr>

                              </Fragment>

                            );

                          })}

                        </tbody>

                      </table>

                    </div>

                  )}

                </div>

              </div>

            </div>

          )}

        </div>

      )}



      {/* РњРѕРґР°Р»РєРё */}

      {showImportModal && (

        <ImportItemsModal

          onClose={() => {

            setShowImportModal(false);

            loadInventory();

          }}

        />

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



      {showOrderModal && (

        <PurchaseOrderModal

          items={orderItemsForModal}

          suppliers={suppliers}

          onClose={() => setShowOrderModal(false)}

          onSuccess={() => {

            setShowOrderModal(false);

            loadPurchaseOrders();

          }}

        />

      )}

    </div>

  );

}































