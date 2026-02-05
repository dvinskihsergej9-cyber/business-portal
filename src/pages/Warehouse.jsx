

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
  inventory: "🧾",
  items: "рџ“љ",
  movement: "\uD83D\uDCE6",
  transactions: "\uD83D\uDD01",
  revision: "\uD83E\uDDFE",
  tmc: "\uD83D\uDCCE",
  locations: "рџ“Ќ",
  queue: "🚚",
  tsd: "рџ“±",
  qr: "🏷️",
  receive: "рџ“¦",
  ship: "🚚",
  audit: "🧾",
  moves: "рџ”Ѓ",
  suppliers: "🏭",
  docs: "рџ—‚️",
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

  ISSUE: "Р’С‹даС‡а расС…однС‹С… маС‚ериалов (РМ)",

  RETURN: "Р’озвраС‚ на склад",

  INCOME: "ПриС…од (приС‘мка)",

};



const STATUS_LABELS = {

  NEW: "Новая",

  IN_PROGRESS: "Р’ рабоС‚е",

  DONE: "Р’С‹полнена",

  REJECTED: "ОС‚клонена",

  PENDING: "ОжидаеС‚",

  APPROVED: "Одобрено",

  COMPLETED: "Р’С‹дано",

};



const STATUS_OPTIONS = [

  { value: "NEW", label: "Новая" },

  { value: "IN_PROGRESS", label: "Р’ рабоС‚е" },

  { value: "DONE", label: "Р’С‹полнена" },

  { value: "REJECTED", label: "ОС‚клонена" },

];



const TASK_STATUS_LABELS = {

  NEW: "Не вС‹полнена",

  IN_PROGRESS: "Р’ рабоС‚е",

  DONE: "Р’С‹полнена",

  CANCELLED: "ОС‚менена",

};



const TASK_STATUS_OPTIONS = [

  { value: "NEW", label: "Не вС‹полнена" },

  { value: "IN_PROGRESS", label: "Р’ рабоС‚е" },

  { value: "DONE", label: "Р’С‹полнена" },

  { value: "CANCELLED", label: "ОС‚менена" },

];



const PO_STATUS_LABELS = {
  DRAFT: "Не полуС‡ен",
  SENT: "Не полуС‡ен",
  PARTIAL: "ЧасС‚иС‡но",
  RECEIVED: "ПолуС‡ен",
  CLOSED: "ПолуС‡ен",
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



  // ===== Р—АЯР’КР НА СКР›АР” =====

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



  // ===== РНР’Р•НТАРРР—АЦРЯ / ОСТАТКР / ПОСТАР’ЩРКР / Р—АКУПКР =====

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



  // ПосС‚авС‰ики

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



  // Р—аказС‹ посС‚авС‰ику

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



  // ===== API: Р—АЯР’КР =====



  // ===== API: Р—АР”АЧР =====

  const loadTasks = async () => {

    try {

      setTasksLoading(true);

      setTaskError("");



      const myRes = await fetch(`${API}/warehouse/tasks/my`, {

        headers: authHeaders,

      });

      const myData = await myRes.json();

      if (!myRes.ok) {

        throw new Error(myData.message || "ОС€ибка загрузки ваС€иС… задаС‡ склада");

      }

      setTaskMyList(myData);



      if (isWarehouseManager) {

        const allRes = await fetch(`${API}/warehouse/tasks`, {

          headers: { Authorization: authHeaders.Authorization },

        });

        const allData = await allRes.json();

        if (!allRes.ok) {

          throw new Error(allData.message || "ОС€ибка загрузки задаС‡ склада");

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



  // ===== API: РНР’Р•НТАРРР—АЦРЯ / ОСТАТКР =====

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

        throw new Error(itemsData.message || "ОС€ибка загрузки С‚оваров");

      }

      if (!stockRes.ok) {

        throw new Error(stockData.message || "ОС€ибка загрузки осС‚аС‚ков");

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
        throw new Error(data.message || "ОС€ибка загрузки ТМЦ");
      }
      setTmcStock(data || []);
    } catch (e) {
      console.error(e);
      setError(e.message || "ОС€ибка загрузки ТМЦ");
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

        throw new Error(data.message || "ОС€ибка загрузки посС‚авС‰иков");

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

          data.message || "ОС€ибка загрузки заказов посС‚авС‰ику"

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

          console.error("ОС€ибка загрузки номенклаС‚урС‹:", data);

        }

      } catch (e) {

        console.error("ОС€ибка загрузки номенклаС‚урС‹:", e);

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



  // ===== ХР•Р›ПР•РЫ Р”Р›Я Р—АЯР’ОК =====

  



  



  // ТоварС‹, у коС‚орС‹С… С‚екуС‰иР№ осС‚аС‚ок > 0 (для вС‹падаюС‰его списка в заявке)

  // ===== ХР•Р›ПР•РЫ Р”Р›Я Р—АР”АЧ =====

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

        throw new Error(data.message || "ОС€ибка создания задаС‡и");

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

        throw new Error(data.message || "ОС€ибка обновления сС‚аС‚уса задаС‡и");

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



  // ===== ХР•Р›ПР•РЫ Р”Р›Я РНР’Р•НТАРРР—АЦРР / Р—АКУПОК =====

  const handleCreateItem = async (e) => {

    e.preventDefault();

    setInventoryError("");



    try {

      if (!itemForm.name.trim()) {

        return setInventoryError("Наименование С‚овара обязаС‚ельно.");

      }

      if (!itemForm.sku.trim()) {

        return setInventoryError("АрС‚икул (SKU) обязаС‚елен.");

      }

      if (!itemForm.barcode.trim()) {

        return setInventoryError("ШС‚риС…код обязаС‚елен.");

      }

      if (!itemForm.unit.trim()) {

        return setInventoryError("Р•диниС†а измерения обязаС‚ельна.");

      }



      const minVal = Number(itemForm.minStock);

      const maxVal = Number(itemForm.maxStock);

      const priceVal = Number(String(itemForm.defaultPrice).replace(",", "."));



      if (!Number.isFinite(minVal) || minVal <= 0) {

        return setInventoryError(

          "МинимальнС‹Р№ осС‚аС‚ок должен бС‹С‚ь положиС‚ельнС‹м С‡ислом."

        );

      }



      if (!Number.isFinite(maxVal) || maxVal <= 0) {

        return setInventoryError(

          "МаксимальнС‹Р№ осС‚аС‚ок должен бС‹С‚ь положиС‚ельнС‹м С‡ислом."

        );

      }



      if (!Number.isFinite(priceVal) || priceVal <= 0) {

        return setInventoryError(

          "Цена за единиС†у должна бС‹С‚ь положиС‚ельнС‹м С‡ислом."

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

        throw new Error(data.message || "ОС€ибка создания С‚овара");

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

        return setInventoryError("Р’С‹бериС‚е С‚овар и укажиС‚е колиС‡есС‚во.");

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

          data.message || "ОС€ибка создания движения по складу"

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

      `УдалиС‚ь С‚овар "${itemName}" и все движения по нему?`

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

          (data && data.message) || "ОС€ибка при удалении С‚овара"

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

        let errorMessage = "Не удалось сС„ормироваС‚ь С„аР№л заказа";

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

      comment: "ПосС‚упление С‚овара",

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

        return setSuppliersError("Название посС‚авС‰ика обязаС‚ельно.");

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

        throw new Error(data.message || "ОС€ибка создания посС‚авС‰ика");

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

        "СнаС‡ала создаР№С‚е С…оС‚я бС‹ одного посС‚авС‰ика ниже на сС‚раниС†е."

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

        "НеС‚ С‚оваров ниже минимального осС‚аС‚ка, заказ не С‚ребуеС‚ся."

      );

      return;

    }



    setOrderItemsForModal(itemsForOrder);

    setShowOrderModal(true);

  };



  const handlePurchaseOrderStatusReceived = async (orderId) => {

    const ok = window.confirm("ПровесС‚и заказ и оприС…одоваС‚ь С‚овар на склад?");

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

          data.message || "ОС€ибка сменС‹ сС‚аС‚уса заказа посС‚авС‰ику"

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

      return db - da; // новС‹е сверС…у

    });

  }, [purchaseOrders]);



  let lastPurchaseOrderDate = "";



  return (

    <div className="page">

      <div className="page-header">

        <h1 className="page-title">Склад</h1>

        <p className="page-subtitle">

          Р—аявки, задаС‡и и уС‡С‘С‚ осС‚аС‚ков на складе.

        </p>

      </div>



      {/* Р’ерС…ние карС‚оС‡ки-подразделС‹ склада */}

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

              <div className="warehouse-card__title">Р—адаС‡и склада</div>

              <div className="warehouse-card__subtitle">

                НазнаС‡ение задаС‡, сроки и напоминания в Telegram.

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

              <div className="warehouse-card__title">ОсС‚аС‚ки</div>

              <div className="warehouse-card__subtitle">

                ТекуС‰ие осС‚аС‚ки по складу.

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
              <div className="warehouse-card__title">НоменклаС‚ура</div>
              <div className="warehouse-card__subtitle">
                СправоС‡ник С‚оваров.
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
              <div className="warehouse-card__title">ТранзакС†ии</div>
              <div className="warehouse-card__subtitle">
                Р’се деР№сС‚вия по яС‡еР№кам и С‚овару.
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
              <div className="warehouse-card__title">ПосС‚авС‰ики</div>
              <div className="warehouse-card__subtitle">
                ПосС‚авС‰ики и заказС‹ посС‚авС‰ику.
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

              <div className="warehouse-card__title">{"\С\п\р\а\в\о\С‡\н\и\к \я\С‡\е\е\к"}</div>

              <div className="warehouse-card__subtitle">

                {"\С\о\з\д\а\н\и\е \я\С‡\е\е\к \и \п\е\С‡\а\С‚\ь QR-\э\С‚\и\к\е\С‚\о\к\."}

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

      МаС€инС‹ посС‚авС‰иков в оС‡ереди

    </div>

    <div className="warehouse-card__subtitle">

      ОС‡ередь на разгрузку, вороС‚а и время.

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

    <div className="warehouse-card__title">МобильнС‹Р№ ТСР”</div>

    <div className="warehouse-card__subtitle">

      Сканирование С€С‚риС…кодов и бС‹сС‚рС‹е операС†ии.

    </div>

  </div>

</button>

        </div>

      </div>

      {section === "tasks" && (
        <div className="tasks-section" ref={tasksRef}>

          {/* Р’кладки: Новая задаС‡а / Р–урнал задаС‡ */}

          <div className="tabs tabs--sm" style={{ marginBottom: 16 }}>

            <button

              type="button"

              className={

                "tabs__btn " + (taskView === "new" ? "tabs__btn--active" : "")

              }

              onClick={() => setTaskView("new")}

            >

              Новая задаС‡а

            </button>

            <button

              type="button"

              className={

                "tabs__btn " +

                (taskView === "journal" ? "tabs__btn--active" : "")

              }

              onClick={() => setTaskView("journal")}

            >

              Р–урнал задаС‡

            </button>

          </div>



          {/* Р’кладка: Новая задаС‡а */}

          {taskView === "new" && (

            <div className="card card--1c">

              <div className="card1c__header">Новая задаС‡а</div>

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

                    <label className="form__label">Р—аголовок</label>

                    <input

                      type="text"

                      className="form__input"

                      value={taskForm.title}

                      onChange={(e) =>

                        setTaskForm({ ...taskForm, title: e.target.value })

                      }

                      placeholder="ЧС‚о сделаС‚ь?"

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

                      placeholder="ПодробносС‚и..."

                    />

                  </div>



                  <div className="form__group">

                    <label className="form__label">Срок (даС‚а и время)</label>

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

                    <label className="form__label">РсполниС‚ель (имя)</label>

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

                      placeholder="Рван Рванов"

                    />

                  </div>



                  <div className="form__group">

                    <label className="form__label">

                      ID исполниС‚еля в Telegram

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

                      placeholder="Например: 514030529"

                    />

                  </div>



                  <div className="request-form-1c__actions">

                    <button

                      type="submit"

                      className="btn btn--primary"

                      disabled={taskSaving}

                    >

                      {taskSaving ? "Создание..." : "СоздаС‚ь задаС‡у"}

                    </button>

                  </div>

                </form>

              </div>

            </div>

          )}



          {/* Р’кладка: Р–урнал задаС‡ (С‚аблиС†а как РсС‚ория движениР№) */}

          {taskView === "journal" && (

            <div className="card card--1c">

              <div className="card1c__header">Р–урнал задаС‡</div>

              <div className="card1c__body">

                {/* ФильС‚рС‹ сверС…у, в сС‚иле РсС‚ории движениР№ */}

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

                    <label className="form__label">СС‚аС‚ус</label>

                    <select

                      className="form__select"

                      value={taskFilterStatus}

                      onChange={(e) => setTaskFilterStatus(e.target.value)}

                    >

                      <option value="ALL">Р’се сС‚аС‚усС‹</option>

                      {TASK_STATUS_OPTIONS.map((opt) => (

                        <option key={opt.value} value={opt.value}>

                          {opt.label}

                        </option>

                      ))}

                    </select>

                  </div>



                  {isWarehouseManager && (

                    <div>

                      <label className="form__label">Список задаС‡</label>

                      <select

                        className="form__select"

                        value={taskTab}

                        onChange={(e) => setTaskTab(e.target.value)}

                      >

                        <option value="my">Мои задаС‡и</option>

                        <option value="all">Р’се задаС‡и</option>

                      </select>

                    </div>

                  )}



                  <div style={{ flex: 1, minWidth: 200 }}>

                    <label className="form__label">Поиск</label>

                    <input

                      type="text"

                      className="form__input"

                      placeholder="Р—аголовок, исполниС‚ель, авС‚ор..."

                      value={taskFilterText}

                      onChange={(e) => setTaskFilterText(e.target.value)}

                    />

                  </div>

                </div>



                {tasksLoading ? (

                  <p>Р—агрузка...</p>

                ) : filteredTasks.length === 0 ? (

                  <p className="text-muted">Р—адаС‡ не наР№дено.</p>

                ) : (

                  <div className="table-wrapper tasks-journal-table">

                    <table className="table">

                      <thead>

                        <tr>

                          <th style={{ width: 40 }}>в„–</th>

                          <th style={{ width: 170 }}>Р”аС‚а</th>

                          <th style={{ width: 110 }}>СС‚аС‚ус</th>

                          <th style={{ width: 170 }}>Срок</th>

                          <th>Р—адаС‡а</th>

                          <th style={{ width: 180 }}>РсполниС‚ель</th>

                          <th style={{ width: 200 }}>АвС‚ор</th>

                          <th style={{ width: 260 }}>Описание</th>

                          {isWarehouseManager && (

  <th style={{ width: 190 }}>Р”еР№сС‚вия</th>

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

                                    (просроС‡ено)

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



            {/* ====== ОЧР•РР•Р”Ь МАШРН ПОСТАР’ЩРКОР’ ====== */}

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

    {/* сюда вС‹несем оС‚дельнС‹Р№ компоненС‚, С‡С‚обС‹ не раздуваС‚ь С„аР№л */}

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




      {/* ====== ОСТАТКР / РНР’Р•НТАРРР—АЦРЯ / Р—АКУПКР ====== */}

      {["inventory","items","movement","suppliers"].includes(section) && (

        <div className="inventory-section" ref={inventoryRef}>

          {/* Р’нуС‚ренние вкладки */}

          
          {inventoryTab === "movement" && (
            <div className="tabs tabs--sm inventory-subtabs" style={{ marginBottom: 12 }}>
              <button
                type="button"
                className={
                  "tabs__btn " + (movementTab === "movementsHistory" ? "tabs__btn--active" : "")
                }
                onClick={() => setMovementTab("movementsHistory")}
              >
                РсС‚ория движениР№
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
                ПосС‚авС‰ики
              </button>
              <button
                type="button"
                className={
                  "tabs__btn " + (suppliersTab === "orders" ? "tabs__btn--active" : "")
                }
                onClick={() => setSuppliersTab("orders")}
              >
                Р—аказС‹ посС‚авС‰ику
              </button>
            </div>
          )}



          {/* ===== Р’кладка 1: НоменклаС‚ура ===== */}

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

          НоменклаС‚ура

        </h2>

        <button

          className="btn btn--secondary"

          onClick={() => setShowImportModal(true)}

        >

          РмпорС‚ из Excel

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



    {/* Форма "НовС‹Р№ С‚овар" С‚еперь на всю С€ирину */}

    <div className="card card--1c" style={{ gridColumn: "span 2" }}>

      <div className="card1c__header">НовС‹Р№ С‚овар</div>

      <div className="card1c__body">

        <form

          onSubmit={handleCreateItem}

          className="form request-form-1c"

        >

          <div className="form__group">

            <label className="form__label">Наименование</label>

            <input

              className="form__input"

              value={itemForm.name}

              onChange={(e) =>

                setItemForm({ ...itemForm, name: e.target.value })

              }

              placeholder="Например: Р‘умага А4"

            />

          </div>



          <div className="form__group">

            <label className="form__label">АрС‚икул (SKU)</label>

            <input

              className="form__input"

              value={itemForm.sku}

              onChange={(e) =>

                setItemForm({ ...itemForm, sku: e.target.value })

              }

            />

          </div>



          <div className="form__group">

            <label className="form__label">ШС‚риС…код</label>

            <input

              className="form__input"

              value={itemForm.barcode}

              onChange={(e) =>

                setItemForm({ ...itemForm, barcode: e.target.value })

              }

            />

          </div>



          <div className="form__group">

            <label className="form__label">Р•д. изм.</label>

            <input

              className="form__input"

              value={itemForm.unit}

              onChange={(e) =>

                setItemForm({ ...itemForm, unit: e.target.value })

              }

              placeholder="С€С‚, кг..."

            />

          </div>



          <div className="form__group">

            <label className="form__label">Цена (по умолС‡анию)</label>

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

            <label className="form__label">Мин. осС‚аС‚ок</label>

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

            <label className="form__label">Макс. осС‚аС‚ок</label>

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

              СоздаС‚ь С‚овар

            </button>

          </div>

        </form>

      </div>

    </div>

  </div>

)}



          {/* ===== Р’кладка 2: ОсС‚аС‚ки (1С + пеС‡аС‚ь акС‚а ревизии) ===== */}

          {inventoryTab === "stock" && <StockAuditTab />}



          {/* ===== Р’кладка 3: Р”вижение С‚овара (С‚олько С„орма) ===== */}

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

                  <span>Р”вижение С‚овара</span>

                  <button

                    type="button"

                    className="btn btn--secondary btn--sm"

                    onClick={() => {

                      console.log(

                        "CLICK ПО Р—АКУПУ, showReceiveModal бС‹ло:",

                        showReceiveModal

                      );

                      setShowReceiveModal(true);

                    }}

                  >

                    Р—акуп по заказу

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

                      <label className="form__label">Тип операС†ии</label>

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

                        <option value="INCOME">ПриС…од</option>

                        <option value="ISSUE">РасС…од</option>

                        <option value="ADJUSTMENT">КоррекС‚ировка</option>

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

                        <option value="">-- Р’С‹бериС‚е С‚овар --</option>

                        {inventoryItems.map((it) => (

                          <option key={it.id} value={it.id}>

                            {it.name} (ОсС‚аС‚ок:?????????? ?????

                            {currentStockForItem(it.id)} {it.unit})

                          </option>

                        ))}

                      </select>

                    </div>



                    <div className="form__group">

                      <label className="form__label">КолиС‡есС‚во</label>

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

                      <label className="form__label">КомменС‚ариР№</label>

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

                        ПровесС‚и движение

                      </button>

                    </div>

                  </form>

                </div>

              </div>

            </div>

          )}



          {/* ===== Р’кладка 4: РсС‚ория движениР№ (1С) ===== */}

          {inventoryTab === "movement" && movementTab === "movementsHistory" && <StockMovementsHistoryTab />}

          {/* ===== Р’кладка 5: ПосС‚авС‰ики ===== */}
          {inventoryTab === "suppliers" && suppliersTab === "suppliers" && (
            <div className="grid-2">

              <div className="card card--1c" style={{ gridColumn: "span 2" }}>

                <div className="card1c__header">ПосС‚авС‰ики</div>

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

                        placeholder="ООО ПосС‚авС‰ик"

                      />

                    </div>



                    <div className="form__group">

                      <label className="form__label">РНН</label>

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

                      <label className="form__label">ТелеС„он</label>

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

                      <label className="form__label">КомменС‚ариР№</label>

                      <input

                        className="form__input"

                        value={supplierForm.comment}

                        onChange={(e) =>

                          setSupplierForm({

                            ...supplierForm,

                            comment: e.target.value,

                          })

                        }

                        placeholder="Условия оплаС‚С‹, конС‚акС‚С‹ менеджера..."

                      />

                    </div>



                    <div className="request-form-1c__actions">

                      <button type="submit" className="btn btn--primary">

                        СоС…раниС‚ь посС‚авС‰ика

                      </button>

                    </div>

                  </form>



                  {suppliersLoading ? (

                    <p>Р—агрузка...</p>

                  ) : suppliers.length === 0 ? (

                    <p className="text-muted">ПосС‚авС‰иков пока неС‚.</p>

                  ) : (

                    <div className="table-wrapper">

                      <table className="table">

                        <thead>

                          <tr>

                            <th>ID</th>

                            <th>Название</th>

                            <th>РНН</th>

                            <th>ТелеС„он</th>

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



                    {/* ===== Р’кладка 6: Р—аказС‹ посС‚авС‰ику ===== */}

          {inventoryTab === "suppliers" && suppliersTab === "orders" && (

            <div className="grid-2">

              <div className="card card--1c" style={{ gridColumn: "span 2" }}>

                <div className="card1c__header">Р—аказС‹ посС‚авС‰ику</div>

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

                      СоздаС‚ь заказ посС‚авС‰ику

                    </button>

                    <button

                      className="btn btn--secondary"

                      onClick={handleDownloadLowStockOrder}

                    >

                      СкаС‡аС‚ь заказ (Low Stock)

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

                    <p>Р—агрузка заказов...</p>

                  ) : sortedPurchaseOrders.length === 0 ? (

                    <p className="text-muted">Р—аказов пока неС‚.</p>

                  ) : (

                    <div className="table-wrapper">

                      <table className="table">

                        <thead>

                          <tr>

                            <th>ID</th>

                            <th>Р’ремя</th>

                            <th>ПосС‚авС‰ик</th>

                            <th>СС‚аС‚ус</th>

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

                              : "Р‘ез даС‚С‹";



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



      {/* Модалки */}

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































