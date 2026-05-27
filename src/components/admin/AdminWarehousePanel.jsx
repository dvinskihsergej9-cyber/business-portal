import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { API_BASE, normalizeErrorMessage } from "../../apiConfig";
import ImportOrdersModal from "../ImportOrdersModal";
import ImportItemsModal from "../ImportItemsModal";

const API = API_BASE;

const ITEM_IMAGE_MAX_BYTES = 3 * 1024 * 1024;
const ITEM_IMAGE_MAX_SIDE = 1200;
const CARD_REFRESH_BTN_STYLE = {
  width: 26,
  height: 26,
  borderRadius: "50%",
  padding: 0,
  lineHeight: "26px",
  textAlign: "center",
  fontSize: 14,
  fontWeight: 700,
  background: "#ffffff",
  border: "1px solid #e5e7eb",
  color: "#9ca3af",
  position: "absolute",
  top: 8,
  right: 8,
  zIndex: 5,
};

async function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Не удалось прочитать файл."));
    reader.readAsDataURL(file);
  });
}

async function compressImageToDataUrl(file) {
  const initialDataUrl = await fileToDataUrl(file);
  const image = await new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Не удалось обработать изображение."));
    img.src = initialDataUrl;
  });

  const srcW = Number(image.width) || 0;
  const srcH = Number(image.height) || 0;
  if (!srcW || !srcH) return initialDataUrl;

  const scale = Math.min(1, ITEM_IMAGE_MAX_SIDE / Math.max(srcW, srcH));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(srcW * scale));
  canvas.height = Math.max(1, Math.round(srcH * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) return initialDataUrl;
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

  const tryQualities = [0.9, 0.82, 0.74, 0.66, 0.58];
  for (const quality of tryQualities) {
    const result = canvas.toDataURL("image/jpeg", quality);
    const bytes = Math.floor((result.length * 3) / 4);
    if (bytes <= ITEM_IMAGE_MAX_BYTES) return result;
  }
  return canvas.toDataURL("image/jpeg", 0.5);
}

export default function AdminWarehousePanel() {
  const [activeTab, setActiveTab] = useState("items");
  const [items, setItems] = useState([]);
  const [locations, setLocations] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const errorRef = useRef(null);

  const [editItem, setEditItem] = useState(null);
  const [editLocation, setEditLocation] = useState(null);
  const [deleteItem, setDeleteItem] = useState(null);
  const [deleteLocation, setDeleteLocation] = useState(null);

  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showOrdersImport, setShowOrdersImport] = useState(false);
  const [showItemsImport, setShowItemsImport] = useState(false);
  const [itemError, setItemError] = useState("");
  const [itemImageBusyId, setItemImageBusyId] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const hasOpenModal = Boolean(
    editItem ||
      editLocation ||
      deleteItem ||
      deleteLocation ||
      imagePreview
  );
  const renderInPortal = (node) =>
    typeof document === "undefined" ? node : createPortal(node, document.body);

  const openImagePreview = (url, title) => {
    const imageUrl = String(url || "").trim();
    if (!imageUrl) return;
    setImagePreview({
      url: imageUrl,
      title: String(title || "").trim() || "Фото товара",
    });
  };

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

  const authHeaders = useMemo(() => {
    const token = localStorage.getItem("token");
    return {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
  }, []);
  const selectedAutoReorderSupplier = useMemo(() => {
    const supplierId = String(itemForm.autoReorderSupplierId || "").trim();
    if (!supplierId) return null;
    return (
      suppliers.find((supplier) => String(supplier?.id || "") === supplierId) ||
      null
    );
  }, [suppliers, itemForm.autoReorderSupplierId]);

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
            "Ошибка загрузки товаров"
        );
      }
      if (!locationsRes.ok) {
        throw new Error(
          locationsData.message ||
            "Ошибка загрузки ячеек"
        );
      }
      setItems(itemsData);
      setLocations(locationsData);
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
    if (!error) return;
    // Ошибки показываются через глобальное модальное окно.
  }, [error]);

  useEffect(() => {
    if (!hasOpenModal || typeof document === "undefined") return undefined;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [hasOpenModal]);

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

  const handleCreateItem = async (event) => {
    event.preventDefault();
    setItemError("");
    try {
      if (!itemForm.name.trim()) {
        return setItemError("Наименование товара обязательно.");
      }
      if (!itemForm.sku.trim()) {
        return setItemError("Артикул обязателен.");
      }
      if (!itemForm.barcode.trim()) {
        return setItemError("Штрихкод обязателен.");
      }
      if (!itemForm.unit.trim()) {
        return setItemError("Единица измерения обязательна.");
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
        return setItemError("Минимальный остаток должен быть положительным числом.");
      }
      if (!Number.isFinite(maxVal) || maxVal <= 0) {
        return setItemError("Максимальный остаток должен быть положительным числом.");
      }
      if (hasDefaultPrice && (!Number.isFinite(priceVal) || priceVal < 0)) {
        return setItemError("Цена за единицу должна быть числом (0 и больше).");
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
        autoReorderEnabled: false,
        autoReorderMin: "",
        autoReorderSupplierId: "",
        autoReorderContactName: "",
        autoReorderContactEmail: "",
        autoReorderMessage: "",
        autoReorderReset: false,
      });

      await loadAll();
    } catch (err) {
      setItemError(normalizeErrorMessage(err, "Ошибка создания товара."));
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

  const handleUploadItemImage = async (item, file) => {
    if (!item?.id || !file) return;
    try {
      setItemImageBusyId(item.id);
      setError("");

      const allowedTypes = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);
      if (!allowedTypes.has(String(file.type || "").toLowerCase())) {
        throw new Error("Поддерживаются только JPG, PNG или WEBP.");
      }

      const preparedDataUrl = await compressImageToDataUrl(file);
      const bytes = Math.floor((preparedDataUrl.length * 3) / 4);
      if (bytes > ITEM_IMAGE_MAX_BYTES) {
        throw new Error("Фото слишком большое. Максимум 3 МБ.");
      }

      const res = await fetch(`${API}/admin/warehouse/items/${item.id}/image`, {
        method: "PUT",
        headers: authHeaders,
        body: JSON.stringify({ imageDataUrl: preparedDataUrl }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.message || "Ошибка сохранения фото.");
      }
      await loadAll();
    } catch (err) {
      setError(normalizeErrorMessage(err, "Ошибка загрузки фото товара."));
    } finally {
      setItemImageBusyId(null);
    }
  };

  const handleRemoveItemImage = async (item) => {
    if (!item?.id) return;
    try {
      setItemImageBusyId(item.id);
      setError("");
      const res = await fetch(`${API}/admin/warehouse/items/${item.id}/image`, {
        method: "PUT",
        headers: authHeaders,
        body: JSON.stringify({ imageDataUrl: null }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.message || "Ошибка удаления фото.");
      }
      await loadAll();
    } catch (err) {
      setError(normalizeErrorMessage(err, "Ошибка удаления фото товара."));
    } finally {
      setItemImageBusyId(null);
    }
  };


  return (
    <div className="admin-console__card admin-panel admin-panel--warehouse" style={{ position: "relative" }}>
      <div className="admin-console__card-title">Склад</div>
      <div className="admin-console__card-text">
        Редактирование товаров, ячеек и заказов.
      </div>
      <button
        type="button"
        className="admin-corner-refresh-btn"
        onClick={loadAll}
        title="Обновить раздел"
        aria-label="Обновить данные склада"
        style={CARD_REFRESH_BTN_STYLE}
      >
        ↻
      </button>

      <div className="admin-console__tabs admin-console__tabs--small">
        <button
          type="button"
          className={
            "admin-console__tab" +
            (activeTab === "items" ? " admin-console__tab--active" : "")
          }
          onClick={() => setActiveTab("items")}
        >
          Номенклатура
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
            (activeTab === "orders" ? " admin-console__tab--active" : "")
          }
          onClick={() => setActiveTab("orders")}
        >
          Отгрузка клиентам
        </button>
      </div>

      {error && (
  <div ref={errorRef} className="admin-alert admin-alert--error">
  {error}
  </div>
  )}
      {loading && <div className="admin-muted">Загрузка...</div>}

      {!loading && activeTab === "items" && (
        <div className="admin-form">
          <div className="admin-form__row" style={{ alignItems: "center" }}>
            <div className="admin-label" style={{ fontWeight: 700 }}>
              Номенклатура
            </div>
            <button
              type="button"
              className="admin-btn admin-btn--secondary"
              onClick={() => setShowItemsImport(true)}
            >
              Импорт из Excel
            </button>
          </div>

          {itemError && (
            <div className="admin-alert admin-alert--error">{itemError}</div>
          )}

          <form onSubmit={handleCreateItem} className="admin-form">
            <div className="admin-form__row">
              <div>
                <label className="admin-label">Наименование</label>
                <input
                  className="admin-input"
                  value={itemForm.name}
                  onChange={(event) =>
                    setItemForm((prev) => ({ ...prev, name: event.target.value }))
                  }
                  placeholder="Например: Стартер 24V"
                />
              </div>
              <div>
                <label className="admin-label">Артикул</label>
                <input
                  className="admin-input"
                  value={itemForm.sku}
                  onChange={(event) =>
                    setItemForm((prev) => ({ ...prev, sku: event.target.value }))
                  }
                  placeholder="ST-001"
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
                  placeholder="ST-001"
                />
              </div>
              <div>
                <label className="admin-label">Ед. изм.</label>
                <input
                  className="admin-input"
                  value={itemForm.unit}
                  onChange={(event) =>
                    setItemForm((prev) => ({ ...prev, unit: event.target.value }))
                  }
                  placeholder="шт"
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
              <div>
                <label className="admin-label">Цена (необязательно)</label>
                <input
                  className="admin-input"
                  type="number"
                  value={itemForm.defaultPrice}
                  placeholder="Например: 120.50"
                  onChange={(event) =>
                    setItemForm((prev) => ({
                      ...prev,
                      defaultPrice: event.target.value,
                    }))
                  }
                />
              </div>
            </div>
            <div className="admin-form__actions">
              <button type="submit" className="admin-btn admin-btn--primary">
                Добавить товар
              </button>
            </div>
          </form>

          <div className="admin-table-wrapper" style={{ marginTop: 16 }}>
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Фото</th>
                  <th>Товар</th>
                  <th>Артикул</th>
                  <th>Штрихкод</th>
                  <th>Ед.</th>
                  <th>Мин</th>
                  <th>Макс</th>
                  <th>Цена</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td data-label="Фото">
                      {item.imageUrl ? (
                        <img
                          src={item.imageUrl}
                          alt={item.name || "Товар"}
                          onClick={() => openImagePreview(item.imageUrl, item.name)}
                          style={{
                            width: 56,
                            height: 56,
                            objectFit: "cover",
                            borderRadius: 10,
                            border: "1px solid #dbe3f3",
                            background: "#f8fafc",
                            cursor: "zoom-in",
                          }}
                          loading="lazy"
                        />
                      ) : (
                        <div className="admin-table__meta">Нет фото</div>
                      )}
                    </td>
                    <td data-label="Товар">
                      <div className="admin-table__title">{item.name}</div>
                      <div className="admin-table__meta">ID: {item.id}</div>
                    </td>
                    <td data-label="Артикул">{item.sku || "-"}</td>
                    <td data-label="Штрихкод">{item.barcode || "-"}</td>
                    <td data-label="Ед.">{item.unit || "-"}</td>
                    <td data-label="Мин">{item.minStock ?? "-"}</td>
                    <td data-label="Макс">{item.maxStock ?? "-"}</td>
                    <td data-label="Цена">{item.defaultPrice ?? "-"}</td>
                    <td data-label="Действия" className="admin-table__actions">
                      <label className="admin-btn admin-btn--secondary" style={{ cursor: "pointer" }}>
                        {itemImageBusyId === item.id ? "Загрузка..." : item.imageUrl ? "Заменить фото" : "Добавить фото"}
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/webp"
                          style={{ display: "none" }}
                          disabled={itemImageBusyId === item.id}
                          onChange={(event) => {
                            const file = event.target.files?.[0];
                            if (file) {
                              handleUploadItemImage(item, file);
                            }
                            event.target.value = "";
                          }}
                        />
                      </label>
                      {item.imageUrl ? (
                        <button
                          type="button"
                          className="admin-btn admin-btn--ghost"
                          onClick={() => handleRemoveItemImage(item)}
                          disabled={itemImageBusyId === item.id}
                        >
                          Удалить фото
                        </button>
                      ) : null}
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
                    <td colSpan="9" className="admin-muted">
                      Нет товаров.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!loading && activeTab === "locations" && (
        <div className="admin-form">
          <div className="admin-label" style={{ fontWeight: 700 }}>
            Ячейки
          </div>
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
        </div>
      )}

      {!loading && activeTab === "orders" && (
        <div className="admin-form">
          <div className="admin-label" style={{ fontWeight: 700 }}>
            Отгрузка клиентам
          </div>
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

      {editItem && renderInPortal(
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
                  <label className="admin-label">Артикул</label>
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
                <label className="admin-label">Цена по умолчанию (необязательно)</label>
                <input
                  className="admin-input"
                  type="number"
                  placeholder="Например: 120.50"
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
                    onChange={(event) => {
                      const supplierId = event.target.value;
                      const supplier = suppliers.find(
                        (entry) => String(entry?.id || "") === String(supplierId)
                      );
                      setItemForm((prev) => ({
                        ...prev,
                        autoReorderSupplierId: supplierId,
                        autoReorderContactEmail:
                          prev.autoReorderContactEmail ||
                          String(supplier?.email || "").trim(),
                      }));
                    }}
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
              {selectedAutoReorderSupplier && (
                <div className="admin-form__row">
                  <div>
                    <label className="admin-label">{"Телефон поставщика"}</label>
                    <input
                      className="admin-input"
                      value={String(selectedAutoReorderSupplier.phone || "")}
                      placeholder="Не указан"
                      readOnly
                    />
                  </div>
                  <div>
                    <label className="admin-label">{"Email поставщика"}</label>
                    <input
                      className="admin-input"
                      value={String(selectedAutoReorderSupplier.email || "")}
                      placeholder="Не указан"
                      readOnly
                    />
                  </div>
                </div>
              )}
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
                    {"Email получателя автозаказа"}
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
                className="admin-btn admin-btn--secondary"
                style={{
                  background: "#dbe3f1",
                  color: "#334155",
                }}
                onClick={() => setEditItem(null)}
              >
                Отмена
              </button>
              <button
                type="button"
                className="admin-btn admin-btn--primary"
                style={{
                  background: "linear-gradient(180deg, #2f73ff 0%, #1e54cb 100%)",
                  color: "#ffffff",
                  boxShadow: "0 8px 22px rgba(47, 115, 255, 0.28)",
                }}
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

      {editLocation && renderInPortal(
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

      {deleteItem && renderInPortal(
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

      {deleteLocation && renderInPortal(
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

      {showItemsImport && (
        <ImportItemsModal
          onClose={() => setShowItemsImport(false)}
          onImportSuccess={() => {
            setShowItemsImport(false);
            loadAll();
          }}
        />
      )}

      {imagePreview?.url && renderInPortal(
        <div className="admin-modal" onClick={() => setImagePreview(null)}>
          <div
            className="admin-modal__panel admin-modal__panel--image"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="admin-modal__header">
              <div>
                <div className="admin-modal__title">{imagePreview.title}</div>
                <div className="admin-modal__subtitle">Увеличенный просмотр</div>
              </div>
            </div>
            <div className="admin-image-preview-wrap">
              <img
                src={imagePreview.url}
                alt={imagePreview.title || "Фото товара"}
                className="admin-image-preview"
              />
            </div>
            <div className="admin-modal__actions">
              <button
                type="button"
                className="admin-btn admin-btn--ghost"
                onClick={() => setImagePreview(null)}
              >
                Закрыть
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

