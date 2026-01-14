
import { useEffect, useMemo, useState, Fragment } from "react";
import { useAuth } from "../context/AuthContext";
import ImportItemsModal from "../components/ImportItemsModal";
import PurchaseOrderModal from "../components/PurchaseOrderModal";
import PurchaseOrderReceiveModal from "../components/PurchaseOrderReceiveModal";
import StockAuditTab from "../components/StockAuditTab";
import StockMovementsHistoryTab from "../components/StockMovementsHistoryTab";
import StockDiscrepanciesTab from "../components/StockDiscrepanciesTab";
import SupplierTrucksQueueTab from "../components/SupplierTrucksQueueTab";
import MobileTsdTab from "../components/MobileTsdTab";
import WarehouseLocationsPanel from "../components/WarehouseLocationsPanel";
import { apiFetch } from "../apiConfig";

const TYPE_LABELS = {
  ISSUE: "Выдача расходных материалов (РМ)",
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
  NEW: "Не выполнена",
  IN_PROGRESS: "В работе",
  DONE: "Выполнена",
  CANCELLED: "Отменена",
};

const TASK_STATUS_OPTIONS = [
  { value: "NEW", label: "Не выполнена" },
  { value: "IN_PROGRESS", label: "В работе" },
  { value: "DONE", label: "Выполнена" },
  { value: "CANCELLED", label: "Отменена" },
];

const PO_STATUS_LABELS = {
  DRAFT: "Не получен",
  SENT: "Не получен",
  PARTIAL: "Частично",
  RECEIVED: "Получен",
  CLOSED: "Получен",
};

export default function Warehouse() {
  const { user } = useAuth();
  const isWarehouseManager =
    user?.role === "ADMIN" || user?.role === "ACCOUNTING";

  const [section, setSection] = useState("requests");
  const [requestsTab, setRequestsTab] = useState("new"); // 'new' | 'journal'

  // ===== ЗАЯВКИ НА СКЛАД =====
  const [requestForm, setRequestForm] = useState({
    title: "",
    quantity: "",
    description: "",
  });

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

  // ===== ИНВЕНТАРИЗАЦИЯ / ОСТАТКИ / ПОСТАВЩИКИ / ЗАКУПКИ =====
  const [inventoryItems, setInventoryItems] = useState([]);
  const [inventoryStock, setInventoryStock] = useState([]);
  const [inventoryLoading, setInventoryLoading] = useState(true);
  const [inventoryError, setInventoryError] = useState("");
  const [showImportModal, setShowImportModal] = useState(false);
  const [inventoryTab, setInventoryTab] = useState("items"); // items | stock | movements | movementsHistory | suppliers | orders

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

  // ===== API: ЗАЯВКИ =====
  const loadRequests = async () => {
    try {
      setLoading(true);
      setError("");
      setPostMessage("");

      const myRes = await apiFetch("/warehouse/requests/my", {
        headers: authHeaders,
      });
      const myData = await myRes.json();
      if (!myRes.ok) {
        throw new Error(myData.message || "Ошибка загрузки ваших заявок");
      }
      setMyList(myData);

      if (isWarehouseManager) {
        const allRes = await apiFetch("/warehouse/requests", {
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

      const myRes = await apiFetch("/warehouse/tasks/my", {
        headers: authHeaders,
      });
      const myData = await myRes.json();
      if (!myRes.ok) {
        throw new Error(myData.message || "Ошибка загрузки ваших задач склада");
      }
      setTaskMyList(myData);

      if (isWarehouseManager) {
        const allRes = await apiFetch("/warehouse/tasks", {
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

  // ===== API: ИНВЕНТАРИЗАЦИЯ / ОСТАТКИ =====
  const loadInventory = async () => {
    try {
      setInventoryLoading(true);
      setInventoryError("");

      const [itemsRes, stockRes] = await Promise.all([
        apiFetch("/inventory/items", {
          headers: { Authorization: authHeaders.Authorization },
        }),
        apiFetch("/inventory/stock", {
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

  const loadSuppliers = async () => {
    try {
      setSuppliersLoading(true);
      setSuppliersError("");

      const res = await apiFetch("/suppliers", {
        headers: { Authorization: authHeaders.Authorization },
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.message || "Ошибка загрузки поставщиков");
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

      const res = await apiFetch("/purchase-orders", {
        headers: { Authorization: authHeaders.Authorization },
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(
          data.message || "Ошибка загрузки заказов поставщику"
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
    loadRequests();
    loadTasks();
    loadInventory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const loadItemsForSuggestions = async () => {
      try {
        const res = await apiFetch("/inventory/items", {
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

  // ===== ХЕЛПЕРЫ ДЛЯ ЗАЯВОК =====
  const handleCreateRequest = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    setPostMessage("");

    try {
      const title = requestForm.title.trim();

      if (!title) {
        setSaving(false);
        return setError("Укажите товар или название заявки.");
      }

      const qty = Number(requestForm.quantity);

      if (!Number.isFinite(qty) || !Number.isInteger(qty) || qty <= 0) {
        setSaving(false);
        return setError("Количество должно быть положительным целым числом.");
      }

      const body = {
        title,
        type: "ISSUE",
        comment: requestForm.description?.trim() || null,
        items: [
          {
            name: title,
            quantity: qty,
            unit: "шт",
          },
        ],
      };

      const res = await apiFetch("/warehouse/requests", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || "Ошибка создания заявки на склад");
      }

      setRequestForm({
        title: "",
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
      const res = await apiFetch(`/warehouse/requests/${id}/status`, {
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

  // Товары, у которых текущий остаток > 0 (для выпадающего списка в заявке)
  const availableStockItems = useMemo(
    () => inventoryStock.filter((row) => row.currentStock > 0),
    [inventoryStock]
  );

  // ===== ХЕЛПЕРЫ ДЛЯ ЗАДАЧ =====
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

      const res = await apiFetch("/warehouse/tasks", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || "Ошибка создания задачи");
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
      const res = await apiFetch(`/warehouse/tasks/${id}/status`, {
        method: "PUT",
        headers: authHeaders,
        body: JSON.stringify({ status: task.status }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || "Ошибка обновления статуса задачи");
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

  // ===== ХЕЛПЕРЫ ДЛЯ ИНВЕНТАРИЗАЦИИ / ЗАКУПОК =====
  const handleCreateItem = async (e) => {
    e.preventDefault();
    setInventoryError("");

    try {
      if (!itemForm.name.trim()) {
        return setInventoryError("Наименование товара обязательно.");
      }
      if (!itemForm.sku.trim()) {
        return setInventoryError("Артикул (SKU) обязателен.");
      }
      if (!itemForm.barcode.trim()) {
        return setInventoryError("Штрихкод обязателен.");
      }
      if (!itemForm.unit.trim()) {
        return setInventoryError("Единица измерения обязательна.");
      }

      const minVal = Number(itemForm.minStock);
      const maxVal = Number(itemForm.maxStock);
      const priceVal = Number(String(itemForm.defaultPrice).replace(",", "."));

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

      if (!Number.isFinite(priceVal) || priceVal <= 0) {
        return setInventoryError(
          "Цена за единицу должна быть положительным числом."
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

      const res = await apiFetch("/inventory/items", {
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

      const res = await apiFetch("/inventory/movements", {
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
      const res = await apiFetch(`/inventory/items/${itemId}`, {
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

  const handleDownloadLowStockOrder = async () => {
    try {
      setInventoryError("");

      const res = await apiFetch("/inventory/low-stock-order-file", {
        headers: { Authorization: authHeaders.Authorization },
      });

      if (!res.ok) {
        let errorMessage = "Не удалось сформировать файл заказа";
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

      const res = await apiFetch("/suppliers", {
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

  const handleOpenPurchaseOrder = () => {
    setInventoryError("");

    if (!suppliers.length) {
      setSuppliersError(
        "Сначала создайте хотя бы одного поставщика ниже на странице."
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
          unit: row.unit || "шт",
          orderQty,
          price: defaultPrice,
        };
      })
      .filter(Boolean);

    if (!itemsForOrder.length) {
      setInventoryError(
        "Нет товаров ниже минимального остатка, заказ не требуется."
      );
      return;
    }

    setOrderItemsForModal(itemsForOrder);
    setShowOrderModal(true);
  };

  const handlePurchaseOrderStatusReceived = async (orderId) => {
    const ok = window.confirm("Провести заказ и оприходовать товар на склад?");
    if (!ok) return;

    try {
      setPurchaseOrdersError("");

      const res = await apiFetch(`/purchase-orders/${orderId}/status`, {
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

    const sortedPurchaseOrders = useMemo(() => {
    return [...purchaseOrders].sort((a, b) => {
      const da = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const db = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return db - da; // новые сверху
    });
  }, [purchaseOrders]);

  let lastPurchaseOrderDate = "";

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Склад</h1>
        <p className="page-subtitle">
          Заявки, задачи и учёт остатков на складе.
        </p>
      </div>

      {/* Верхние карточки-подразделы склада */}
      <div className="warehouse-section">
        <div className="warehouse-grid">
          <button
            type="button"
            className={
              "warehouse-card" +
              (section === "requests" ? " warehouse-card--active" : "")
            }
            onClick={() => setSection("requests")}
          >
            <div className="warehouse-card__icon">
              <span className="warehouse-card__icon-symbol">📥</span>
            </div>
            <div className="warehouse-card__body">
              <div className="warehouse-card__title">Заявки на склад</div>
              <div className="warehouse-card__subtitle">
                Создание заявок и контроль выдачи расходных материалов.
              </div>
            </div>
          </button>

          <button
            type="button"
            className={
              "warehouse-card" +
              (section === "tasks" ? " warehouse-card--active" : "")
            }
            onClick={() => setSection("tasks")}
          >
            <div className="warehouse-card__icon">
              <span className="warehouse-card__icon-symbol">📝</span>
            </div>
            <div className="warehouse-card__body">
              <div className="warehouse-card__title">Задачи склада</div>
              <div className="warehouse-card__subtitle">
                Назначение задач, сроки и напоминания в Telegram.
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
              <span className="warehouse-card__icon-symbol">📦</span>
            </div>
            <div className="warehouse-card__body">
              <div className="warehouse-card__title">Остатки / закупки</div>
              <div className="warehouse-card__subtitle">
                Номенклатура, инвентаризация и заказы поставщику.
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
              <span className="warehouse-card__icon-symbol">🏷️</span>
            </div>
            <div className="warehouse-card__body">
              <div className="warehouse-card__title">{"\u042f\u0447\u0435\u0439\u043a\u0438 / QR"}</div>
              <div className="warehouse-card__subtitle">
                {"\u0421\u043e\u0437\u0434\u0430\u043d\u0438\u0435 \u044f\u0447\u0435\u0435\u043a \u0438 \u043f\u0435\u0447\u0430\u0442\u044c QR-\u044d\u0442\u0438\u043a\u0435\u0442\u043e\u043a."}
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
    <span className="warehouse-card__icon-symbol">🚚</span>
  </div>
  <div className="warehouse-card__body">
    <div className="warehouse-card__title">
      Машины поставщиков в очереди
    </div>
    <div className="warehouse-card__subtitle">
      Очередь на разгрузку, ворота и время.
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
    <span className="warehouse-card__icon-symbol">📱</span>
  </div>
  <div className="warehouse-card__body">
    <div className="warehouse-card__title">Мобильный ТСД</div>
    <div className="warehouse-card__subtitle">
      Сканирование штрихкодов и быстрые операции.
    </div>
  </div>
</button>
        </div>
      </div>

            {/* ====== ЗАЯВКИ ====== */}
      {section === "requests" && (
        <div className="requests-section">
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
                    <label className="form__label">Название / Товар</label>
                    <input
                      type="text"
                      className="form__input"
                      list="warehouse-items-list"
                      value={requestForm.title}
                      onChange={(e) =>
                        setRequestForm({
                          ...requestForm,
                          title: e.target.value,
                        })
                      }
                      placeholder="Что требуется?"
                    />
                    <datalist id="warehouse-items-list">
                      {availableStockItems.map((item) => (
                        <option key={item.id} value={item.name} />
                      ))}
                    </datalist>
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
                  <div className="table-wrapper">
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
                            <tr key={req.id}>
                              <td>{index + 1}</td>
                              <td>
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
                              <td>{statusLabel(req.status)}</td>
                              <td>
                                {createdBy?.name ||
                                  createdBy?.email ||
                                  "-"}
                              </td>
                              <td>{title}</td>
                              <td style={{ textAlign: "right" }}>
                                {totalQty != null && totalQty !== 0
                                  ? totalQty
                                  : "-"}
                              </td>
                              <td>{requestComment || "-"}</td>
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
      {section === "tasks" && (
        <div className="tasks-section">
          {/* Вкладки: Новая задача / Журнал задач */}
          <div className="tabs tabs--sm" style={{ marginBottom: 16 }}>
            <button
              type="button"
              className={
                "tabs__btn " + (taskView === "new" ? "tabs__btn--active" : "")
              }
              onClick={() => setTaskView("new")}
            >
              Новая задача
            </button>
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

                <form
                  onSubmit={handleCreateTask}
                  className="form request-form-1c"
                >
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
                    <label className="form__label">Исполнитель (имя)</label>
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
                      placeholder="Иван Иванов"
                    />
                  </div>

                  <div className="form__group">
                    <label className="form__label">
                      ID исполнителя в Telegram
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
                      {taskSaving ? "Создание..." : "Создать задачу"}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* Вкладка: Журнал задач (таблица как История движений) */}
          {taskView === "journal" && (
            <div className="card card--1c">
              <div className="card1c__header">Журнал задач</div>
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
                  <div className="table-wrapper">
                    <table className="table">
                      <thead>
                        <tr>
                          <th style={{ width: 40 }}>№</th>
                          <th style={{ width: 170 }}>Дата</th>
                          <th style={{ width: 110 }}>Статус</th>
                          <th style={{ width: 170 }}>Срок</th>
                          <th>Задача</th>
                          <th style={{ width: 180 }}>Исполнитель</th>
                          <th style={{ width: 200 }}>Автор</th>
                          <th style={{ width: 260 }}>Описание</th>
                          {isWarehouseManager && (
  <th style={{ width: 190 }}>Действия</th>
)}
                        </tr>
                      </thead>
                      <tbody>
                        {filteredTasks.map((t, index) => {
                          const overdue = isTaskOverdue(t);
                          return (
                            <tr key={t.id}>
                              <td>{index + 1}</td>
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
                                    (просрочено)
                                  </span>
                                )}
                              </td>
                              <td>{t.title}</td>
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
                              <td>{t.description || "-"}</td>
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

            {/* ====== ОЧЕРЕДЬ МАШИН ПОСТАВЩИКОВ ====== */}
      {section === "locations" && (
        <div className="locations-section">
          <WarehouseLocationsPanel />
        </div>
      )}

      {section === "queue" && (
        <div className="queue-section">
          <SupplierTrucksQueueTab />
        </div>
      )}

      {section === "tsd" && (
  <div className="tsd-section">
    {/* сюда вынесем отдельный компонент, чтобы не раздувать файл */}
    <MobileTsdTab />
  </div>
)}

      {/* ====== ОСТАТКИ / ИНВЕНТАРИЗАЦИЯ / ЗАКУПКИ ====== */}
      {section === "inventory" && (
        <div className="inventory-section">
          {/* Внутренние вкладки */}
          <div className="tabs tabs--sm" style={{ marginBottom: 16 }}>
            <button
              type="button"
              className={
                "tabs__btn " +
                (inventoryTab === "items" ? "tabs__btn--active" : "")
              }
              onClick={() => setInventoryTab("items")}
            >
              Номенклатура
            </button>
            <button
              type="button"
              className={
                "tabs__btn " +
                (inventoryTab === "stock" ? "tabs__btn--active" : "")
              }
              onClick={() => setInventoryTab("stock")}
            >
              Текущие остатки
            </button>
            <button
              type="button"
              className={
                "tabs__btn " +
                (inventoryTab === "movements" ? "tabs__btn--active" : "")
              }
              onClick={() => setInventoryTab("movements")}
            >
              Движение товара
            </button>
            <button
              type="button"
              className={
                "tabs__btn " +
                (inventoryTab === "movementsHistory"
                  ? "tabs__btn--active"
                  : "")
              }
              onClick={() => setInventoryTab("movementsHistory")}
            >
              История движений
            </button>
            <button
              type="button"
              className={
                "tabs__btn " +
                (inventoryTab === "discrepancies" ? "tabs__btn--active" : "")
              }
              onClick={() => setInventoryTab("discrepancies")}
            >
              Косяки
            </button>
            <button
              type="button"
              className={
                "tabs__btn " +
                (inventoryTab === "suppliers" ? "tabs__btn--active" : "")
              }
              onClick={() => setInventoryTab("suppliers")}
            >
              Поставщики
            </button>
            <button
              type="button"
              className={
                "tabs__btn " +
                (inventoryTab === "orders" ? "tabs__btn--active" : "")
              }
              onClick={() => setInventoryTab("orders")}
            >
              Заказы поставщику
            </button>
          </div>

          {/* ===== Вкладка 1: Номенклатура ===== */}
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
          Номенклатура
        </h2>
        <button
          className="btn btn--secondary"
          onClick={() => setShowImportModal(true)}
        >
          Импорт из Excel
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

    {/* Форма "Новый товар" теперь на всю ширину */}
    <div className="card card--1c" style={{ gridColumn: "span 2" }}>
      <div className="card1c__header">Новый товар</div>
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
              placeholder="Например: Бумага А4"
            />
          </div>

          <div className="form__group">
            <label className="form__label">Артикул (SKU)</label>
            <input
              className="form__input"
              value={itemForm.sku}
              onChange={(e) =>
                setItemForm({ ...itemForm, sku: e.target.value })
              }
            />
          </div>

          <div className="form__group">
            <label className="form__label">Штрихкод</label>
            <input
              className="form__input"
              value={itemForm.barcode}
              onChange={(e) =>
                setItemForm({ ...itemForm, barcode: e.target.value })
              }
            />
          </div>

          <div className="form__group">
            <label className="form__label">Ед. изм.</label>
            <input
              className="form__input"
              value={itemForm.unit}
              onChange={(e) =>
                setItemForm({ ...itemForm, unit: e.target.value })
              }
              placeholder="шт, кг..."
            />
          </div>

          <div className="form__group">
            <label className="form__label">Цена (по умолчанию)</label>
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
            <label className="form__label">Мин. остаток</label>
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
            <label className="form__label">Макс. остаток</label>
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
              Создать товар
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
)}

          {/* ===== Вкладка 2: Текущие остатки (1С + печать акта ревизии) ===== */}
          {inventoryTab === "stock" && <StockAuditTab />}

          {/* ===== Вкладка 3: Движение товара (только форма) ===== */}
          {inventoryTab === "movements" && (
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
          {inventoryTab === "movementsHistory" && <StockMovementsHistoryTab />}
          {inventoryTab === "discrepancies" && <StockDiscrepanciesTab />}

          {/* ===== Вкладка 5: Поставщики ===== */}
          {inventoryTab === "suppliers" && (
            <div className="grid-2">
              <div className="card card--1c" style={{ gridColumn: "span 2" }}>
                <div className="card1c__header">Поставщики</div>
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
          {inventoryTab === "orders" && (
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
                    <button
                      className="btn btn--secondary"
                      onClick={handleDownloadLowStockOrder}
                    >
                      Скачать заказ (Low Stock)
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
                    <div className="table-wrapper">
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
                              : "Без даты";

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
