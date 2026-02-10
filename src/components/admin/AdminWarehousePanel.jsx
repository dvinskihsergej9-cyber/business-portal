import { useEffect, useMemo, useRef, useState } from "react";
import { API_BASE, normalizeErrorMessage } from "../../apiConfig";
import ImportOrdersModal from "../ImportOrdersModal";

const API = API_BASE;

const REQUEST_STATUS_OPTIONS = [
  { value: "NEW", label: "Новая" },
  { value: "IN_PROGRESS", label: "В работе" },
  { value: "DONE", label: "Завершена" },
  { value: "REJECTED", label: "Отклонена" },
];

function toDateInput(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

export default function AdminWarehousePanel() {
  const [activeTab, setActiveTab] = useState("items");
  const [items, setItems] = useState([]);
  const [locations, setLocations] = useState([]);
  const [requests, setRequests] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const errorRef = useRef(null);

  const [editItem, setEditItem] = useState(null);
  const [editLocation, setEditLocation] = useState(null);
  const [editRequest, setEditRequest] = useState(null);
  const [deleteItem, setDeleteItem] = useState(null);
  const [deleteLocation, setDeleteLocation] = useState(null);

  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showOrdersImport, setShowOrdersImport] = useState(false);
  const [clearingItems, setClearingItems] = useState(false);

  const [itemForm, setItemForm] = useState({
    name: "",
    sku: "",
    barcode: "",
    unit: "",
    minStock: "",
    maxStock: "",
    defaultPrice: "",
    autoReorderEnabled: false,
    autoReorderMin: "",
    autoReorderSupplierId: "",
    autoReorderContactName: "",
    autoReorderContactEmail: "",
    autoReorderMessage: "",
    autoReorderReset: false,
  });

  const [locationForm, setLocationForm] = useState({
    name: "",
    code: "",
    zone: "",
    aisle: "",
    rack: "",
    level: "",
  });

  const [requestForm, setRequestForm] = useState({
    status: "NEW",
    statusComment: "",
    comment: "",
    desiredDate: "",
  });

  const authHeaders = useMemo(() => {
    const token = localStorage.getItem("token");
    return {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
  }, []);

  const loadAll = async () => {
    try {
      setLoading(true);
      setError("");
      const [itemsRes, locationsRes, requestsRes] = await Promise.all([
        fetch(`${API}/admin/warehouse/items`, { headers: authHeaders }),
        fetch(`${API}/admin/warehouse/locations`, { headers: authHeaders }),
        fetch(`${API}/admin/warehouse/requests`, { headers: authHeaders }),
      ]);
      const suppliersRes = await fetch(`${API}/suppliers`, {
        headers: authHeaders,
      });
      const itemsData = await itemsRes.json();
      const locationsData = await locationsRes.json();
      const requestsData = await requestsRes.json();
      const suppliersData = await suppliersRes.json();
      if (!itemsRes.ok) {
        throw new Error(
          itemsData.message ||
            "Ошибка загрузки товаров"
        );
      }
      if (!locationsRes.ok) {
        throw new Error(
          locationsData.message ||
            "Ошибка загрузки ячеек"
        );
      }
      if (!requestsRes.ok) {
        throw new Error(
          requestsData.message ||
            "Ошибка загрузки заявок"
        );
      }
      setItems(itemsData);
      setLocations(locationsData);
      setRequests(requestsData);
      if (suppliersRes.ok && Array.isArray(suppliersData)) {
        setSuppliers(suppliersData);
      }
    } catch (err) {
      setError(normalizeErrorMessage(err, "Ошибка загрузки данных склада."));
    } finally {
      setLoading(false);
    }
  };


  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!editItem) return;
    setItemForm({
      name: editItem.name || "",
      sku: editItem.sku || "",
      barcode: editItem.barcode || "",
      unit: editItem.unit || "",
      minStock: editItem.minStock ?? "",
      maxStock: editItem.maxStock ?? "",
      defaultPrice: editItem.defaultPrice ?? "",
      autoReorderEnabled: Boolean(editItem.autoReorderEnabled),
      autoReorderMin: editItem.autoReorderMin ?? "",
      autoReorderSupplierId: editItem.autoReorderSupplierId ?? "",
      autoReorderContactName: editItem.autoReorderContactName ?? "",
      autoReorderContactEmail: editItem.autoReorderContactEmail ?? "",
      autoReorderMessage: editItem.autoReorderMessage ?? "",
      autoReorderReset: false,
    });
  }, [editItem]);

  useEffect(() => {
    if (!editLocation) return;
    setLocationForm({
      name: editLocation.name || "",
      code: editLocation.code || "",
      zone: editLocation.zone || "",
      aisle: editLocation.aisle || "",
      rack: editLocation.rack || "",
      level: editLocation.level || "",
    });
  }, [editLocation]);

  useEffect(() => {
    if (!editRequest) return;
    setRequestForm({
      status: editRequest.status || "NEW",
      statusComment: editRequest.statusComment || "",
      comment: editRequest.comment || "",
      desiredDate: toDateInput(editRequest.desiredDate),
    });
  }, [editRequest]);

  useEffect(() => {
    if (!error) return;
    const node = errorRef.current;
    if (node?.scrollIntoView) {
      node.scrollIntoView({ behavior: "smooth", block: "start" });
    } else if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, [error]);

  const handleSaveItem = async () => {
    if (!editItem) return;
    try {
      setSaving(true);
      setError("");
      const res = await fetch(
        `${API}/admin/warehouse/items/${editItem.id}`,
        {
          method: "PUT",
          headers: authHeaders,
          body: JSON.stringify(itemForm),
        }
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          data.message ||
            "Ошибка обновления товара"
        );
      }
      setEditItem(null);
      await loadAll();
    } catch (err) {
      setError(normalizeErrorMessage(err, "Ошибка обновления товара."));
    } finally {
      setSaving(false);
    }
  };

  const handleSaveLocation = async () => {
    if (!editLocation) return;
    try {
      setSaving(true);
      setError("");
      const res = await fetch(
        `${API}/admin/warehouse/locations/${editLocation.id}`,
        {
          method: "PUT",
          headers: authHeaders,
          body: JSON.stringify(locationForm),
        }
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          data.message ||
            "Ошибка обновления ячейки"
        );
      }
      setEditLocation(null);
      await loadAll();
    } catch (err) {
      setError(normalizeErrorMessage(err, "Ошибка обновления ячейки."));
    } finally {
      setSaving(false);
    }
  };

  const handleSaveRequest = async () => {
    if (!editRequest) return;
    try {
      setSaving(true);
      setError("");
      const payload = {
        status: requestForm.status,
        statusComment: requestForm.statusComment,
        comment: requestForm.comment,
        desiredDate: requestForm.desiredDate
          ? new Date(requestForm.desiredDate).toISOString()
          : null,
      };
      const res = await fetch(
        `${API}/admin/warehouse/requests/${editRequest.id}`,
        {
          method: "PUT",
          headers: authHeaders,
          body: JSON.stringify(payload),
        }
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          data.message ||
            "Ошибка обновления заявки"
        );
      }
      setEditRequest(null);
      await loadAll();
    } catch (err) {
      setError(normalizeErrorMessage(err, "Ошибка обновления заявки."));
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteItem = async () => {
    if (!deleteItem) return;
    try {
      setDeleting(true);
      setError("");
      const res = await fetch(
        `${API}/admin/warehouse/items/${deleteItem.id}`,
        {
          method: "DELETE",
          headers: authHeaders,
        }
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          data.message ||
            "Ошибка удаления товара"
        );
      }
      setDeleteItem(null);
      await loadAll();
    } catch (err) {
      setError(normalizeErrorMessage(err, "Ошибка удаления товара."));
    } finally {
      setDeleting(false);
    }
  };

  const handleDeleteLocation = async () => {
    if (!deleteLocation) return;
    try {
      setDeleting(true);
      setError("");
      const res = await fetch(
        `${API}/admin/warehouse/locations/${deleteLocation.id}`,
        {
          method: "DELETE",
          headers: authHeaders,
        }
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          data.message ||
            "Ошибка удаления ячейки"
        );
      }
      setDeleteLocation(null);
      await loadAll();
    } catch (err) {
      setError(normalizeErrorMessage(err, "Ошибка удаления ячейки."));
    } finally {
      setDeleting(false);
    }
  };

  const handleClearItems = async () => {
    if (clearingItems) return;
    const confirmText =
      "Удалить все позиции склада? Это также очистит движения и размещения.";
    if (typeof window !== "undefined" && !window.confirm(confirmText)) {
      return;
    }
    try {
      setClearingItems(true);
      setError("");
      const res = await fetch(`${API}/admin/warehouse/items/clear`, {
        method: "POST",
        headers: authHeaders,
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          data.message || "Ошибка очистки позиций"
        );
      }
      if (typeof window !== "undefined") {
        window.alert("Все позиции удалены.");
      }
      await loadAll();
    } catch (err) {
      setError(normalizeErrorMessage(err, "Ошибка очистки позиций."));
    } finally {
      setClearingItems(false);
    }
  };


  return (
    <div className="admin-console__card">
      <div className="admin-console__card-title">Склад</div>
      <div className="admin-console__card-text">
        Редактирование товаров, ячеек и заявок.
      </div>

      <div className="admin-console__tabs admin-console__tabs--small">
        <button
          type="button"
          className={
            "admin-console__tab" +
            (activeTab === "items" ? " admin-console__tab--active" : "")
          }
          onClick={() => setActiveTab("items")}
        >
          Товары
        </button>
        <button
          type="button"
          className={
            "admin-console__tab" +
            (activeTab === "locations" ? " admin-console__tab--active" : "")
          }
          onClick={() => setActiveTab("locations")}
        >
          Ячейки
        </button>
        <button
          type="button"
          className={
            "admin-console__tab" +
            (activeTab === "requests" ? " admin-console__tab--active" : "")
          }
          onClick={() => setActiveTab("requests")}
        >
          Заявки
        </button>
        <button
          type="button"
          className={
            "admin-console__tab" +
            (activeTab === "orders" ? " admin-console__tab--active" : "")
          }
          onClick={() => setActiveTab("orders")}
        >
          Заказы
        </button>
        <div className="admin-console__tab-actions">
          <button
            type="button"
            className="admin-console__tab admin-console__tab--action"
            onClick={loadAll}
          >
            {"Обновить"}
          </button>
          <button
            type="button"
            className="admin-btn admin-btn--ghost"
            title="\u041e\u0431\u043d\u043e\u0432\u0438\u0442\u044c \u0441\u043f\u0438\u0441\u043e\u043a \u0442\u043e\u0432\u0430\u0440\u043e\u0432, \u044f\u0447\u0435\u0435\u043a \u0438 \u0437\u0430\u044f\u0432\u043e\u043a"
            aria-label="\u041f\u043e\u0434\u0441\u043a\u0430\u0437\u043a\u0430: \u043e\u0431\u043d\u043e\u0432\u043b\u044f\u0435\u0442 \u0441\u043f\u0438\u0441\u043e\u043a \u0442\u043e\u0432\u0430\u0440\u043e\u0432, \u044f\u0447\u0435\u0435\u043a \u0438 \u0437\u0430\u044f\u0432\u043e\u043a"
            onClick={() => {
              if (typeof window !== "undefined") {
                window.alert("\u041e\u0431\u043d\u043e\u0432\u043b\u044f\u0435\u0442 \u0441\u043f\u0438\u0441\u043e\u043a \u0442\u043e\u0432\u0430\u0440\u043e\u0432, \u044f\u0447\u0435\u0435\u043a \u0438 \u0437\u0430\u044f\u0432\u043e\u043a.");
              }
            }}
            style={{
              width: 28,
              height: 28,
              borderRadius: "50%",
              padding: 0,
              lineHeight: "28px",
              textAlign: "center",
            }}
          >
            ?
          </button>
        </div>
      </div>

      {error && (
  <div ref={errorRef} className="admin-alert admin-alert--error">
  {error}
  </div>
  )}
      {loading && <div className="admin-muted">Загрузка...</div>}

      {!loading && activeTab === "items" && (
        <div className="admin-table-wrapper">
          <div className="admin-table__actions" style={{ marginBottom: 12 }}>
            <button
              type="button"
              className="admin-btn admin-btn--danger"
              onClick={handleClearItems}
              disabled={clearingItems}
            >
              {clearingItems ? "Очистка..." : "Удалить все позиции"}
            </button>
          </div>
          <table className="admin-table">
            <thead>
              <tr>
                <th>Товар</th>
                <th>SKU</th>
                <th>Штрихкод</th>
                <th>Ед.</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td data-label="Товар">
                    <div className="admin-table__title">{item.name}</div>
                    <div className="admin-table__meta">ID: {item.id}</div>
                  </td>
                  <td data-label="SKU">{item.sku || "-"}</td>
                  <td data-label="Штрихкод">{item.barcode || "-"}</td>
                  <td data-label="Ед.">{item.unit || "-"}</td>
                  <td data-label="Действия" className="admin-table__actions">
                    <button
                      type="button"
                      className="admin-btn admin-btn--secondary"
                      onClick={() => setEditItem(item)}
                    >
                      Редактировать
                    </button>
                    <button
                      type="button"
                      className="admin-btn admin-btn--danger"
                      onClick={() => setDeleteItem(item)}
                    >
                      Удалить
                    </button>
                  </td>
                </tr>
              ))}
              {!items.length && (
                <tr>
                  <td colSpan="5" className="admin-muted">
                    Нет товаров.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {!loading && activeTab === "locations" && (
        <div className="admin-table-wrapper">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Ячейка</th>
                <th>Код</th>
                <th>Зона</th>
                <th>Ряд</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {locations.map((loc) => (
                <tr key={loc.id}>
                  <td data-label="Ячейка">
                    <div className="admin-table__title">{loc.name}</div>
                    <div className="admin-table__meta">ID: {loc.id}</div>
                  </td>
                  <td data-label="Код">{loc.code || "-"}</td>
                  <td data-label="Зона">{loc.zone || "-"}</td>
                  <td data-label="Ряд">{loc.aisle || "-"}</td>
                  <td data-label="Действия" className="admin-table__actions">
                    <button
                      type="button"
                      className="admin-btn admin-btn--secondary"
                      onClick={() => setEditLocation(loc)}
                    >
                      Редактировать
                    </button>
                    <button
                      type="button"
                      className="admin-btn admin-btn--danger"
                      onClick={() => setDeleteLocation(loc)}
                    >
                      Удалить
                    </button>
                  </td>
                </tr>
              ))}
              {!locations.length && (
                <tr>
                  <td colSpan="5" className="admin-muted">
                    Нет ячеек.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {!loading && activeTab === "requests" && (
        <div className="admin-table-wrapper">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Заявка</th>
                <th>Тип</th>
                <th>Статус</th>
                <th>Автор</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {requests.map((req) => (
                <tr key={req.id}>
                  <td data-label="Заявка">
                    <div className="admin-table__title">{req.title}</div>
                    <div className="admin-table__meta">ID: {req.id}</div>
                  </td>
                  <td data-label="Тип">{req.type}</td>
                  <td data-label="Статус">{req.status}</td>
                  <td data-label="Автор">{req.createdBy?.name || "-"}</td>
                  <td data-label="Действия" className="admin-table__actions">
                    <button
                      type="button"
                      className="admin-btn admin-btn--secondary"
                      onClick={() => setEditRequest(req)}
                    >
                      Открыть
                    </button>
                  </td>
                </tr>
              ))}
              {!requests.length && (
                <tr>
                  <td colSpan="5" className="admin-muted">
                    Нет заявок.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {!loading && activeTab === "orders" && (
        <div className="admin-form">
          <div className="admin-label" style={{ fontWeight: 600 }}>
            Импорт заказов из Excel
          </div>
          <div className="admin-muted" style={{ marginBottom: 8 }}>
            Используйте, если нет интеграции.
          </div>
          <button
            type="button"
            className="admin-btn admin-btn--secondary"
            onClick={() => setShowOrdersImport(true)}
          >
            Импортировать Excel
          </button>
        </div>
      )}

      {editItem && (
        <div className="admin-modal">
          <div className="admin-modal__panel">
            <div className="admin-modal__header">
              <div>
                <div className="admin-modal__title">
                  Редактировать товар
                </div>
                <div className="admin-modal__subtitle">{editItem.name}</div>
              </div>
                <button
                  type="button"
                  className="admin-btn admin-btn--ghost"
                  onClick={() => setEditItem(null)}
                >
                  X
                </button>
            </div>
            <div className="admin-form">
              <div className="admin-form__row">
                <div>
                  <label className="admin-label">Название</label>
                  <input
                    className="admin-input"
                    value={itemForm.name}
                    onChange={(event) =>
                      setItemForm((prev) => ({
                        ...prev,
                        name: event.target.value,
                      }))
                    }
                  />
                </div>
                <div>
                  <label className="admin-label">SKU</label>
                  <input
                    className="admin-input"
                    value={itemForm.sku}
                    onChange={(event) =>
                      setItemForm((prev) => ({
                        ...prev,
                        sku: event.target.value,
                      }))
                    }
                  />
                </div>
              </div>
              <div className="admin-form__row">
                <div>
                  <label className="admin-label">Штрихкод</label>
                  <input
                    className="admin-input"
                    value={itemForm.barcode}
                    onChange={(event) =>
                      setItemForm((prev) => ({
                        ...prev,
                        barcode: event.target.value,
                      }))
                    }
                  />
                </div>
                <div>
                  <label className="admin-label">Единица</label>
                  <input
                    className="admin-input"
                    value={itemForm.unit}
                    onChange={(event) =>
                      setItemForm((prev) => ({
                        ...prev,
                        unit: event.target.value,
                      }))
                    }
                  />
                </div>
              </div>
              <div className="admin-form__row">
                <div>
                  <label className="admin-label">Мин. остаток</label>
                  <input
                    className="admin-input"
                    type="number"
                    value={itemForm.minStock}
                    onChange={(event) =>
                      setItemForm((prev) => ({
                        ...prev,
                        minStock: event.target.value,
                      }))
                    }
                  />
                </div>
                <div>
                  <label className="admin-label">Макс. остаток</label>
                  <input
                    className="admin-input"
                    type="number"
                    value={itemForm.maxStock}
                    onChange={(event) =>
                      setItemForm((prev) => ({
                        ...prev,
                        maxStock: event.target.value,
                      }))
                    }
                  />
                </div>
              </div>
              <div>
                <label className="admin-label">Цена по умолчанию</label>
                <input
                  className="admin-input"
                  type="number"
                  value={itemForm.defaultPrice}
                  onChange={(event) =>
                    setItemForm((prev) => ({
                      ...prev,
                      defaultPrice: event.target.value,
                    }))
                  }
                />
              </div>
              <div className="admin-divider" />
              <div>
                <div className="admin-label" style={{ fontWeight: 600 }}>
                  {"Автозаказ"}
                </div>
                <label className="admin-checkbox">
                  <input
                    type="checkbox"
                    checked={itemForm.autoReorderEnabled}
                    onChange={(event) =>
                      setItemForm((prev) => ({
                        ...prev,
                        autoReorderEnabled: event.target.checked,
                      }))
                    }
                  />
                  {"Включить автозаказ"}
                </label>
                {editItem.autoReorderActive && (
                  <div className="admin-muted" style={{ marginTop: 6 }}>
                    {"Автозаказ активен"}
                  </div>
                )}
              </div>
              <div className="admin-form__row">
                <div>
                  <label className="admin-label">
                    {"Мин. остаток для автозаказа"}
                  </label>
                  <input
                    className="admin-input"
                    type="number"
                    value={itemForm.autoReorderMin}
                    onChange={(event) =>
                      setItemForm((prev) => ({
                        ...prev,
                        autoReorderMin: event.target.value,
                      }))
                    }
                  />
                </div>
                <div>
                  <label className="admin-label">
                    {"Поставщик"}
                  </label>
                  <select
                    className="admin-select"
                    value={itemForm.autoReorderSupplierId}
                    onChange={(event) =>
                      setItemForm((prev) => ({
                        ...prev,
                        autoReorderSupplierId: event.target.value,
                      }))
                    }
                  >
                    <option value="">{"Выберите поставщика"}</option>
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="admin-form__row">
                <div>
                  <label className="admin-label">
                    {"Контактное лицо"}
                  </label>
                  <input
                    className="admin-input"
                    value={itemForm.autoReorderContactName}
                    onChange={(event) =>
                      setItemForm((prev) => ({
                        ...prev,
                        autoReorderContactName: event.target.value,
                      }))
                    }
                  />
                </div>
                <div>
                  <label className="admin-label">
                    {"Email для автозаказа"}
                  </label>
                  <input
                    className="admin-input"
                    value={itemForm.autoReorderContactEmail}
                    onChange={(event) =>
                      setItemForm((prev) => ({
                        ...prev,
                        autoReorderContactEmail: event.target.value,
                      }))
                    }
                  />
                </div>
              </div>
              <div>
                <label className="admin-label">
                  {"Текст сообщения поставщику"}
                </label>
                <textarea
                  className="admin-input"
                  rows={3}
                  value={itemForm.autoReorderMessage}
                  onChange={(event) =>
                    setItemForm((prev) => ({
                      ...prev,
                      autoReorderMessage: event.target.value,
                    }))
                  }
                />
              </div>
              {editItem.autoReorderActive && (
                <label className="admin-checkbox" style={{ marginTop: 6 }}>
                  <input
                    type="checkbox"
                    checked={itemForm.autoReorderReset}
                    onChange={(event) =>
                      setItemForm((prev) => ({
                        ...prev,
                        autoReorderReset: event.target.checked,
                      }))
                    }
                  />
                  {"Сбросить флаг автозаказа"}
                </label>
              )}
            </div>
            <div className="admin-modal__actions">
              <button
                type="button"
                className="admin-btn admin-btn--ghost"
                onClick={() => setEditItem(null)}
              >
                Отмена
              </button>
              <button
                type="button"
                className="admin-btn admin-btn--primary"
                onClick={handleSaveItem}
                disabled={saving}
              >
                {saving
                  ? "Сохранение..."
                  : "Сохранить"}
              </button>
            </div>
          </div>
        </div>
      )}

      {editLocation && (
        <div className="admin-modal">
          <div className="admin-modal__panel">
            <div className="admin-modal__header">
              <div>
                <div className="admin-modal__title">
                  Редактировать ячейку
                </div>
                <div className="admin-modal__subtitle">{editLocation.name}</div>
              </div>
                <button
                  type="button"
                  className="admin-btn admin-btn--ghost"
                  onClick={() => setEditLocation(null)}
                >
                  X
                </button>
            </div>
            <div className="admin-form">
              <div className="admin-form__row">
                <div>
                  <label className="admin-label">Название</label>
                  <input
                    className="admin-input"
                    value={locationForm.name}
                    onChange={(event) =>
                      setLocationForm((prev) => ({
                        ...prev,
                        name: event.target.value,
                      }))
                    }
                  />
                </div>
                <div>
                  <label className="admin-label">Код</label>
                  <input
                    className="admin-input"
                    value={locationForm.code}
                    onChange={(event) =>
                      setLocationForm((prev) => ({
                        ...prev,
                        code: event.target.value,
                      }))
                    }
                  />
                </div>
              </div>
              <div className="admin-form__row">
                <div>
                  <label className="admin-label">Зона</label>
                  <input
                    className="admin-input"
                    value={locationForm.zone}
                    onChange={(event) =>
                      setLocationForm((prev) => ({
                        ...prev,
                        zone: event.target.value,
                      }))
                    }
                  />
                </div>
                <div>
                  <label className="admin-label">Ряд</label>
                  <input
                    className="admin-input"
                    value={locationForm.aisle}
                    onChange={(event) =>
                      setLocationForm((prev) => ({
                        ...prev,
                        aisle: event.target.value,
                      }))
                    }
                  />
                </div>
              </div>
              <div className="admin-form__row">
                <div>
                  <label className="admin-label">Стеллаж</label>
                  <input
                    className="admin-input"
                    value={locationForm.rack}
                    onChange={(event) =>
                      setLocationForm((prev) => ({
                        ...prev,
                        rack: event.target.value,
                      }))
                    }
                  />
                </div>
                <div>
                  <label className="admin-label">Уровень</label>
                  <input
                    className="admin-input"
                    value={locationForm.level}
                    onChange={(event) =>
                      setLocationForm((prev) => ({
                        ...prev,
                        level: event.target.value,
                      }))
                    }
                  />
                </div>
              </div>
              <div className="admin-divider" />
              <div>
                <div className="admin-label" style={{ fontWeight: 600 }}>
                  {"Автозаказ"}
                </div>
                <label className="admin-checkbox">
                  <input
                    type="checkbox"
                    checked={itemForm.autoReorderEnabled}
                    onChange={(event) =>
                      setItemForm((prev) => ({
                        ...prev,
                        autoReorderEnabled: event.target.checked,
                      }))
                    }
                  />
                  {"Включить автозаказ"}
                </label>
                {editItem.autoReorderActive && (
                  <div className="admin-muted" style={{ marginTop: 6 }}>
                    {"Автозаказ активен"}
                  </div>
                )}
              </div>
              <div className="admin-form__row">
                <div>
                  <label className="admin-label">
                    {"Мин. остаток для автозаказа"}
                  </label>
                  <input
                    className="admin-input"
                    type="number"
                    value={itemForm.autoReorderMin}
                    onChange={(event) =>
                      setItemForm((prev) => ({
                        ...prev,
                        autoReorderMin: event.target.value,
                      }))
                    }
                  />
                </div>
                <div>
                  <label className="admin-label">
                    {"Поставщик"}
                  </label>
                  <select
                    className="admin-select"
                    value={itemForm.autoReorderSupplierId}
                    onChange={(event) =>
                      setItemForm((prev) => ({
                        ...prev,
                        autoReorderSupplierId: event.target.value,
                      }))
                    }
                  >
                    <option value="">{"Выберите поставщика"}</option>
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="admin-form__row">
                <div>
                  <label className="admin-label">
                    {"Контактное лицо"}
                  </label>
                  <input
                    className="admin-input"
                    value={itemForm.autoReorderContactName}
                    onChange={(event) =>
                      setItemForm((prev) => ({
                        ...prev,
                        autoReorderContactName: event.target.value,
                      }))
                    }
                  />
                </div>
                <div>
                  <label className="admin-label">
                    {"Email для автозаказа"}
                  </label>
                  <input
                    className="admin-input"
                    value={itemForm.autoReorderContactEmail}
                    onChange={(event) =>
                      setItemForm((prev) => ({
                        ...prev,
                        autoReorderContactEmail: event.target.value,
                      }))
                    }
                  />
                </div>
              </div>
              <div>
                <label className="admin-label">
                  {"Текст сообщения поставщику"}
                </label>
                <textarea
                  className="admin-input"
                  rows={3}
                  value={itemForm.autoReorderMessage}
                  onChange={(event) =>
                    setItemForm((prev) => ({
                      ...prev,
                      autoReorderMessage: event.target.value,
                    }))
                  }
                />
              </div>
              {editItem.autoReorderActive && (
                <label className="admin-checkbox" style={{ marginTop: 6 }}>
                  <input
                    type="checkbox"
                    checked={itemForm.autoReorderReset}
                    onChange={(event) =>
                      setItemForm((prev) => ({
                        ...prev,
                        autoReorderReset: event.target.checked,
                      }))
                    }
                  />
                  {"Сбросить флаг автозаказа"}
                </label>
              )}
            </div>
            <div className="admin-modal__actions">
              <button
                type="button"
                className="admin-btn admin-btn--ghost"
                onClick={() => setEditLocation(null)}
              >
                Отмена
              </button>
              <button
                type="button"
                className="admin-btn admin-btn--primary"
                onClick={handleSaveLocation}
                disabled={saving}
              >
                {saving
                  ? "Сохранение..."
                  : "Сохранить"}
              </button>
            </div>
          </div>
        </div>
      )}

      {editRequest && (
        <div className="admin-modal">
          <div className="admin-modal__panel">
            <div className="admin-modal__header">
              <div>
                <div className="admin-modal__title">
                  Редактировать заявку
                </div>
                <div className="admin-modal__subtitle">{editRequest.title}</div>
              </div>
              <button
                type="button"
                className="admin-btn admin-btn--ghost"
                onClick={() => setEditRequest(null)}
              >
                ?
              </button>
            </div>
            <div className="admin-form">
              <div className="admin-form__row">
                <div>
                  <label className="admin-label">Статус</label>
                  <select
                    className="admin-select"
                    value={requestForm.status}
                    onChange={(event) =>
                      setRequestForm((prev) => ({
                        ...prev,
                        status: event.target.value,
                      }))
                    }
                  >
                    {REQUEST_STATUS_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="admin-label">Желаемая дата</label>
                  <input
                    className="admin-input"
                    type="date"
                    value={requestForm.desiredDate}
                    onChange={(event) =>
                      setRequestForm((prev) => ({
                        ...prev,
                        desiredDate: event.target.value,
                      }))
                    }
                  />
                </div>
              </div>
              <div>
                <label className="admin-label">Комментарий к статусу</label>
                <input
                  className="admin-input"
                  value={requestForm.statusComment}
                  onChange={(event) =>
                    setRequestForm((prev) => ({
                      ...prev,
                      statusComment: event.target.value,
                    }))
                  }
                />
              </div>
              <div>
                <label className="admin-label">Комментарий</label>
                <input
                  className="admin-input"
                  value={requestForm.comment}
                  onChange={(event) =>
                    setRequestForm((prev) => ({
                      ...prev,
                      comment: event.target.value,
                    }))
                  }
                />
              </div>
              <div className="admin-divider" />
              <div>
                <div className="admin-label" style={{ fontWeight: 600 }}>
                  {"Автозаказ"}
                </div>
                <label className="admin-checkbox">
                  <input
                    type="checkbox"
                    checked={itemForm.autoReorderEnabled}
                    onChange={(event) =>
                      setItemForm((prev) => ({
                        ...prev,
                        autoReorderEnabled: event.target.checked,
                      }))
                    }
                  />
                  {"Включить автозаказ"}
                </label>
                {editItem.autoReorderActive && (
                  <div className="admin-muted" style={{ marginTop: 6 }}>
                    {"Автозаказ активен"}
                  </div>
                )}
              </div>
              <div className="admin-form__row">
                <div>
                  <label className="admin-label">
                    {"Мин. остаток для автозаказа"}
                  </label>
                  <input
                    className="admin-input"
                    type="number"
                    value={itemForm.autoReorderMin}
                    onChange={(event) =>
                      setItemForm((prev) => ({
                        ...prev,
                        autoReorderMin: event.target.value,
                      }))
                    }
                  />
                </div>
                <div>
                  <label className="admin-label">
                    {"Поставщик"}
                  </label>
                  <select
                    className="admin-select"
                    value={itemForm.autoReorderSupplierId}
                    onChange={(event) =>
                      setItemForm((prev) => ({
                        ...prev,
                        autoReorderSupplierId: event.target.value,
                      }))
                    }
                  >
                    <option value="">{"Выберите поставщика"}</option>
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="admin-form__row">
                <div>
                  <label className="admin-label">
                    {"Контактное лицо"}
                  </label>
                  <input
                    className="admin-input"
                    value={itemForm.autoReorderContactName}
                    onChange={(event) =>
                      setItemForm((prev) => ({
                        ...prev,
                        autoReorderContactName: event.target.value,
                      }))
                    }
                  />
                </div>
                <div>
                  <label className="admin-label">
                    {"Email для автозаказа"}
                  </label>
                  <input
                    className="admin-input"
                    value={itemForm.autoReorderContactEmail}
                    onChange={(event) =>
                      setItemForm((prev) => ({
                        ...prev,
                        autoReorderContactEmail: event.target.value,
                      }))
                    }
                  />
                </div>
              </div>
              <div>
                <label className="admin-label">
                  {"Текст сообщения поставщику"}
                </label>
                <textarea
                  className="admin-input"
                  rows={3}
                  value={itemForm.autoReorderMessage}
                  onChange={(event) =>
                    setItemForm((prev) => ({
                      ...prev,
                      autoReorderMessage: event.target.value,
                    }))
                  }
                />
              </div>
              {editItem.autoReorderActive && (
                <label className="admin-checkbox" style={{ marginTop: 6 }}>
                  <input
                    type="checkbox"
                    checked={itemForm.autoReorderReset}
                    onChange={(event) =>
                      setItemForm((prev) => ({
                        ...prev,
                        autoReorderReset: event.target.checked,
                      }))
                    }
                  />
                  {"Сбросить флаг автозаказа"}
                </label>
              )}
            </div>
            <div className="admin-modal__actions">
              <button
                type="button"
                className="admin-btn admin-btn--ghost"
                onClick={() => setEditRequest(null)}
              >
                Отмена
              </button>
              <button
                type="button"
                className="admin-btn admin-btn--primary"
                onClick={handleSaveRequest}
                disabled={saving}
              >
                {saving
                  ? "Сохранение..."
                  : "Сохранить"}
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteItem && (
        <div className="admin-modal">
          <div className="admin-modal__panel admin-modal__panel--danger">
            <div className="admin-modal__title">
              Удалить товар
            </div>
            <div className="admin-modal__subtitle">{deleteItem.name}</div>
            <div className="admin-modal__actions">
              <button
                type="button"
                className="admin-btn admin-btn--ghost"
                onClick={() => setDeleteItem(null)}
              >
                Отмена
              </button>
              <button
                type="button"
                className="admin-btn admin-btn--danger"
                onClick={handleDeleteItem}
                disabled={deleting}
              >
                {deleting
                  ? "Удаление..."
                  : "Удалить"}
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteLocation && (
        <div className="admin-modal">
          <div className="admin-modal__panel admin-modal__panel--danger">
            <div className="admin-modal__title">
              Удалить ячейку
            </div>
            <div className="admin-modal__subtitle">{deleteLocation.name}</div>
            <div className="admin-modal__actions">
              <button
                type="button"
                className="admin-btn admin-btn--ghost"
                onClick={() => setDeleteLocation(null)}
              >
                Отмена
              </button>
              <button
                type="button"
                className="admin-btn admin-btn--danger"
                onClick={handleDeleteLocation}
                disabled={deleting}
              >
                {deleting
                  ? "Удаление..."
                  : "Удалить"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showOrdersImport && (
        <ImportOrdersModal
          onClose={() => setShowOrdersImport(false)}
          onImportSuccess={() => setShowOrdersImport(false)}
        />
      )}
    </div>
  );
}










