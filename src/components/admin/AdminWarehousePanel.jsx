import { useEffect, useMemo, useState } from "react";
import { API_BASE } from "../../apiConfig";

const API = API_BASE;

const REQUEST_STATUS_OPTIONS = [
  { value: "NEW", label: "Новая" },
  { value: "IN_PROGRESS", label: "Р’ рабоС‚е" },
  { value: "DONE", label: "Р—аверС€ена" },
  { value: "REJECTED", label: "ОС‚клонена" },
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
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [editItem, setEditItem] = useState(null);
  const [editLocation, setEditLocation] = useState(null);
  const [editRequest, setEditRequest] = useState(null);
  const [deleteItem, setDeleteItem] = useState(null);
  const [deleteLocation, setDeleteLocation] = useState(null);

  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

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
      const [itemsRes, locationsRes] = await Promise.all([
        fetch(`${API}/admin/warehouse/items`, { headers: authHeaders }),
        fetch(`${API}/admin/warehouse/locations`, { headers: authHeaders }),
      ]);
      const suppliersRes = await fetch(`${API}/suppliers`, {
        headers: authHeaders,
      });
      const itemsData = await itemsRes.json();
      const locationsData = await locationsRes.json();
      const suppliersData = await suppliersRes.json();
      if (!itemsRes.ok) {
        throw new Error(
          itemsData.message ||
            "ОС€ибка загрузки С‚оваров"
        );
      }
      if (!locationsRes.ok) {
        throw new Error(
          locationsData.message ||
            "ОС€ибка загрузки яС‡еек"
        );
      }
      setItems(itemsData);
      setLocations(locationsData);
      if (suppliersRes.ok && Array.isArray(suppliersData)) {
        setSuppliers(suppliersData);
      }
    } catch (err) {
      setError(
        err.message ||
          "ОС€ибка загрузки даннС‹С… склада"
      );
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
            "ОС€ибка обновления С‚овара"
        );
      }
      setEditItem(null);
      await loadAll();
    } catch (err) {
      setError(
        err.message ||
          "ОС€ибка обновления С‚овара"
      );
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
            "ОС€ибка обновления яС‡еР№ки"
        );
      }
      setEditLocation(null);
      await loadAll();
    } catch (err) {
      setError(
        err.message ||
          "ОС€ибка обновления яС‡еР№ки"
      );
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
            "ОС€ибка обновления заявки"
        );
      }
      setEditRequest(null);
      await loadAll();
    } catch (err) {
      setError(
        err.message ||
          "ОС€ибка обновления заявки"
      );
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
            "ОС€ибка удаления С‚овара"
        );
      }
      setDeleteItem(null);
      await loadAll();
    } catch (err) {
      setError(
        err.message ||
          "ОС€ибка удаления С‚овара"
      );
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
            "ОС€ибка удаления яС‡еР№ки"
        );
      }
      setDeleteLocation(null);
      await loadAll();
    } catch (err) {
      setError(
        err.message ||
          "ОС€ибка удаления яС‡еР№ки"
      );
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="admin-console__card">
      <div className="admin-console__card-title">Склад</div>
      <div className="admin-console__card-text">
        РедакС‚ирование С‚оваров, яС‡еек и заявок.
      </div>

      <div className="admin-console__tabs admin-console__tabs--small">

        <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <button
            type="button"
            className="admin-btn admin-btn--ghost"
            onClick={loadAll}
          >
            {"\u041e\u0431\u043d\u043e\u0432\u0438\u0442\u044c"}
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

      {error && <div className="admin-alert admin-alert--error">{error}</div>}
      {loading && (
        <div className="admin-muted">Р—агрузка...</div>
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
                  ✕
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
                  РедакС‚ироваС‚ь яС‡еР№ку
                </div>
                <div className="admin-modal__subtitle">{editLocation.name}</div>
              </div>
                <button
                  type="button"
                  className="admin-btn admin-btn--ghost"
                  onClick={() => setEditLocation(null)}
                >
                  вњ•
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
                  <label className="admin-label">Р—она</label>
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
                  <label className="admin-label">СС‚еллаж</label>
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
                  {"АвС‚озаказ"}
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
                  {"Р’клюС‡иС‚ь авС‚озаказ"}
                </label>
                {editItem.autoReorderActive && (
                  <div className="admin-muted" style={{ marginTop: 6 }}>
                    {"АвС‚озаказ акС‚ивен"}
                  </div>
                )}
              </div>
              <div className="admin-form__row">
                <div>
                  <label className="admin-label">
                    {"Мин. осС‚аС‚ок для авС‚озаказа"}
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
                    {"ПосС‚авС‰ик"}
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
                    <option value="">{"Р’С‹бериС‚е посС‚авС‰ика"}</option>
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
                    {"КонС‚акС‚ное лиС†о"}
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
                    {"Email для авС‚озаказа"}
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
                  {"ТексС‚ сообС‰ения посС‚авС‰ику"}
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
                  {"СбросиС‚ь С„лаг авС‚озаказа"}
                </label>
              )}
            </div>
            <div className="admin-modal__actions">
              <button
                type="button"
                className="admin-btn admin-btn--ghost"
                onClick={() => setEditLocation(null)}
              >
                ОС‚мена
              </button>
              <button
                type="button"
                className="admin-btn admin-btn--primary"
                onClick={handleSaveLocation}
                disabled={saving}
              >
                {saving
                  ? "СоС…ранение..."
                  : "СоС…раниС‚ь"}
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
                  РедакС‚ироваС‚ь заявку
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
                  <label className="admin-label">СС‚аС‚ус</label>
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
                  <label className="admin-label">Р–елаемая даС‚а</label>
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
                <label className="admin-label">КомменС‚ариР№ к сС‚аС‚усу</label>
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
                <label className="admin-label">КомменС‚ариР№</label>
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
                  {"АвС‚озаказ"}
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
                  {"Р’клюС‡иС‚ь авС‚озаказ"}
                </label>
                {editItem.autoReorderActive && (
                  <div className="admin-muted" style={{ marginTop: 6 }}>
                    {"АвС‚озаказ акС‚ивен"}
                  </div>
                )}
              </div>
              <div className="admin-form__row">
                <div>
                  <label className="admin-label">
                    {"Мин. осС‚аС‚ок для авС‚озаказа"}
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
                    {"ПосС‚авС‰ик"}
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
                    <option value="">{"Р’С‹бериС‚е посС‚авС‰ика"}</option>
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
                    {"КонС‚акС‚ное лиС†о"}
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
                    {"Email для авС‚озаказа"}
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
                  {"ТексС‚ сообС‰ения посС‚авС‰ику"}
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
                  {"СбросиС‚ь С„лаг авС‚озаказа"}
                </label>
              )}
            </div>
            <div className="admin-modal__actions">
              <button
                type="button"
                className="admin-btn admin-btn--ghost"
                onClick={() => setEditRequest(null)}
              >
                ОС‚мена
              </button>
              <button
                type="button"
                className="admin-btn admin-btn--primary"
                onClick={handleSaveRequest}
                disabled={saving}
              >
                {saving
                  ? "СоС…ранение..."
                  : "СоС…раниС‚ь"}
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteItem && (
        <div className="admin-modal">
          <div className="admin-modal__panel admin-modal__panel--danger">
            <div className="admin-modal__title">
              УдалиС‚ь С‚овар
            </div>
            <div className="admin-modal__subtitle">{deleteItem.name}</div>
            <div className="admin-modal__actions">
              <button
                type="button"
                className="admin-btn admin-btn--ghost"
                onClick={() => setDeleteItem(null)}
              >
                ОС‚мена
              </button>
              <button
                type="button"
                className="admin-btn admin-btn--danger"
                onClick={handleDeleteItem}
                disabled={deleting}
              >
                {deleting
                  ? "Удаление..."
                  : "УдалиС‚ь"}
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteLocation && (
        <div className="admin-modal">
          <div className="admin-modal__panel admin-modal__panel--danger">
            <div className="admin-modal__title">
              УдалиС‚ь яС‡еР№ку
            </div>
            <div className="admin-modal__subtitle">{deleteLocation.name}</div>
            <div className="admin-modal__actions">
              <button
                type="button"
                className="admin-btn admin-btn--ghost"
                onClick={() => setDeleteLocation(null)}
              >
                ОС‚мена
              </button>
              <button
                type="button"
                className="admin-btn admin-btn--danger"
                onClick={handleDeleteLocation}
                disabled={deleting}
              >
                {deleting
                  ? "Удаление..."
                  : "УдалиС‚ь"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}




