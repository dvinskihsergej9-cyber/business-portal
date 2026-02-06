import { useEffect, useMemo, useState } from "react";
import { API_BASE } from "../../apiConfig";
import ImportOrdersModal from "../ImportOrdersModal";

const API = API_BASE;

const REQUEST_STATUS_OPTIONS = [
  { value: "NEW", label: "РќРѕРІР°СЏ" },
  { value: "IN_PROGRESS", label: "Р’ СЂР°Р±РѕС‚Рµ" },
  { value: "DONE", label: "Р—Р°РІРµСЂС€РµРЅР°" },
  { value: "REJECTED", label: "РћС‚РєР»РѕРЅРµРЅР°" },
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

  const [editItem, setEditItem] = useState(null);
  const [editLocation, setEditLocation] = useState(null);
  const [editRequest, setEditRequest] = useState(null);
  const [deleteItem, setDeleteItem] = useState(null);
  const [deleteLocation, setDeleteLocation] = useState(null);

  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showOrdersImport, setShowOrdersImport] = useState(false);
  const [apiKeyInfo, setApiKeyInfo] = useState({
    hasKey: false,
    hint: null,
    lastRotatedAt: null,
  });
  const [apiKeyValue, setApiKeyValue] = useState("");
  const [apiKeyLoading, setApiKeyLoading] = useState(false);

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
            "РћС€РёР±РєР° Р·Р°РіСЂСѓР·РєРё С‚РѕРІР°СЂРѕРІ"
        );
      }
      if (!locationsRes.ok) {
        throw new Error(
          locationsData.message ||
            "РћС€РёР±РєР° Р·Р°РіСЂСѓР·РєРё СЏС‡РµРµРє"
        );
      }
      if (!requestsRes.ok) {
        throw new Error(
          requestsData.message ||
            "РћС€РёР±РєР° Р·Р°РіСЂСѓР·РєРё Р·Р°СЏРІРѕРє"
        );
      }
      setItems(itemsData);
      setLocations(locationsData);
      setRequests(requestsData);
      if (suppliersRes.ok && Array.isArray(suppliersData)) {
        setSuppliers(suppliersData);
      }
    } catch (err) {
      setError(
        err.message ||
          "РћС€РёР±РєР° Р·Р°РіСЂСѓР·РєРё РґР°РЅРЅС‹С… СЃРєР»Р°РґР°"
      );
    } finally {
      setLoading(false);
    }
  };

  const loadApiKeyInfo = async () => {
    try {
      setApiKeyLoading(true);
      const res = await fetch(`${API}/integrations/api-key`, { headers: authHeaders });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || "РћС€РёР±РєР° Р·Р°РіСЂСѓР·РєРё РєР»СЋС‡Р°.");
      }
      setApiKeyInfo({
        hasKey: Boolean(data?.hasKey),
        hint: data?.hint || null,
        lastRotatedAt: data?.lastRotatedAt || null,
      });
    } catch (err) {
      setError(err.message || "РћС€РёР±РєР° Р·Р°РіСЂСѓР·РєРё РєР»СЋС‡Р°.");
    } finally {
      setApiKeyLoading(false);
    }
  };

  const rotateApiKey = async () => {
    try {
      setApiKeyLoading(true);
      setError("");
      const res = await fetch(`${API}/integrations/api-key/rotate`, {
        method: "POST",
        headers: authHeaders,
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || "РћС€РёР±РєР° РіРµРЅРµСЂР°С†РёРё РєР»СЋС‡Р°.");
      }
      setApiKeyValue(data.apiKey || "");
      setApiKeyInfo({
        hasKey: true,
        hint: data.hint || null,
        lastRotatedAt: data.lastRotatedAt || null,
      });
    } catch (err) {
      setError(err.message || "РћС€РёР±РєР° РіРµРЅРµСЂР°С†РёРё РєР»СЋС‡Р°.");
    } finally {
      setApiKeyLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (activeTab !== "orders") return;
    loadApiKeyInfo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

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
            "РћС€РёР±РєР° РѕР±РЅРѕРІР»РµРЅРёСЏ С‚РѕРІР°СЂР°"
        );
      }
      setEditItem(null);
      await loadAll();
    } catch (err) {
      setError(
        err.message ||
          "РћС€РёР±РєР° РѕР±РЅРѕРІР»РµРЅРёСЏ С‚РѕРІР°СЂР°"
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
            "РћС€РёР±РєР° РѕР±РЅРѕРІР»РµРЅРёСЏ СЏС‡РµР№РєРё"
        );
      }
      setEditLocation(null);
      await loadAll();
    } catch (err) {
      setError(
        err.message ||
          "РћС€РёР±РєР° РѕР±РЅРѕРІР»РµРЅРёСЏ СЏС‡РµР№РєРё"
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
            "РћС€РёР±РєР° РѕР±РЅРѕРІР»РµРЅРёСЏ Р·Р°СЏРІРєРё"
        );
      }
      setEditRequest(null);
      await loadAll();
    } catch (err) {
      setError(
        err.message ||
          "РћС€РёР±РєР° РѕР±РЅРѕРІР»РµРЅРёСЏ Р·Р°СЏРІРєРё"
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
            "РћС€РёР±РєР° СѓРґР°Р»РµРЅРёСЏ С‚РѕРІР°СЂР°"
        );
      }
      setDeleteItem(null);
      await loadAll();
    } catch (err) {
      setError(
        err.message ||
          "РћС€РёР±РєР° СѓРґР°Р»РµРЅРёСЏ С‚РѕРІР°СЂР°"
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
            "РћС€РёР±РєР° СѓРґР°Р»РµРЅРёСЏ СЏС‡РµР№РєРё"
        );
      }
      setDeleteLocation(null);
      await loadAll();
    } catch (err) {
      setError(
        err.message ||
          "РћС€РёР±РєР° СѓРґР°Р»РµРЅРёСЏ СЏС‡РµР№РєРё"
      );
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="admin-console__card">
      <div className="admin-console__card-title">РЎРєР»Р°Рґ</div>
      <div className="admin-console__card-text">
        Р РµРґР°РєС‚РёСЂРѕРІР°РЅРёРµ С‚РѕРІР°СЂРѕРІ, СЏС‡РµРµРє Рё Р·Р°СЏРІРѕРє.
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
        <div className="admin-muted">Р—Р°РіСЂСѓР·РєР°...</div>
      )}

      {!loading && activeTab === "items" && (
        <div className="admin-table-wrapper">
          <table className="admin-table">
            <thead>
              <tr>
                <th>РўРѕРІР°СЂ</th>
                <th>SKU</th>
                <th>РЁС‚СЂРёС…РєРѕРґ</th>
                <th>Р•Рґ.</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td data-label="РўРѕРІР°СЂ">
                    <div className="admin-table__title">{item.name}</div>
                    <div className="admin-table__meta">ID: {item.id}</div>
                  </td>
                  <td data-label="SKU">{item.sku || "-"}</td>
                  <td data-label="РЁС‚СЂРёС…РєРѕРґ">{item.barcode || "-"}</td>
                  <td data-label="Р•Рґ.">{item.unit || "-"}</td>
                  <td data-label="Р”РµР№СЃС‚РІРёСЏ" className="admin-table__actions">
                    <button
                      type="button"
                      className="admin-btn admin-btn--secondary"
                      onClick={() => setEditItem(item)}
                    >
                      Р РµРґР°РєС‚РёСЂРѕРІР°С‚СЊ
                    </button>
                    <button
                      type="button"
                      className="admin-btn admin-btn--danger"
                      onClick={() => setDeleteItem(item)}
                    >
                      РЈРґР°Р»РёС‚СЊ
                    </button>
                  </td>
                </tr>
              ))}
              {!items.length && (
                <tr>
                  <td colSpan="5" className="admin-muted">
                    РќРµС‚ С‚РѕРІР°СЂРѕРІ.
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
                <th>РЇС‡РµР№РєР°</th>
                <th>РљРѕРґ</th>
                <th>Р—РѕРЅР°</th>
                <th>Р СЏРґ</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {locations.map((loc) => (
                <tr key={loc.id}>
                  <td data-label="РЇС‡РµР№РєР°">
                    <div className="admin-table__title">{loc.name}</div>
                    <div className="admin-table__meta">ID: {loc.id}</div>
                  </td>
                  <td data-label="РљРѕРґ">{loc.code || "-"}</td>
                  <td data-label="Р—РѕРЅР°">{loc.zone || "-"}</td>
                  <td data-label="Р СЏРґ">{loc.aisle || "-"}</td>
                  <td data-label="Р”РµР№СЃС‚РІРёСЏ" className="admin-table__actions">
                    <button
                      type="button"
                      className="admin-btn admin-btn--secondary"
                      onClick={() => setEditLocation(loc)}
                    >
                      Р РµРґР°РєС‚РёСЂРѕРІР°С‚СЊ
                    </button>
                    <button
                      type="button"
                      className="admin-btn admin-btn--danger"
                      onClick={() => setDeleteLocation(loc)}
                    >
                      РЈРґР°Р»РёС‚СЊ
                    </button>
                  </td>
                </tr>
              ))}
              {!locations.length && (
                <tr>
                  <td colSpan="5" className="admin-muted">
                    РќРµС‚ СЏС‡РµРµРє.
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
                <th>Р—Р°СЏРІРєР°</th>
                <th>РўРёРї</th>
                <th>РЎС‚Р°С‚СѓСЃ</th>
                <th>РђРІС‚РѕСЂ</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {requests.map((req) => (
                <tr key={req.id}>
                  <td data-label="Р—Р°СЏРІРєР°">
                    <div className="admin-table__title">{req.title}</div>
                    <div className="admin-table__meta">ID: {req.id}</div>
                  </td>
                  <td data-label="РўРёРї">{req.type}</td>
                  <td data-label="РЎС‚Р°С‚СѓСЃ">{req.status}</td>
                  <td data-label="РђРІС‚РѕСЂ">{req.createdBy?.name || "-"}</td>
                  <td data-label="Р”РµР№СЃС‚РІРёСЏ" className="admin-table__actions">
                    <button
                      type="button"
                      className="admin-btn admin-btn--secondary"
                      onClick={() => setEditRequest(req)}
                    >
                      РћС‚РєСЂС‹С‚СЊ
                    </button>
                  </td>
                </tr>
              ))}
              {!requests.length && (
                <tr>
                  <td colSpan="5" className="admin-muted">
                    РќРµС‚ Р·Р°СЏРІРѕРє.
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
            Ключ интеграции (на компанию)
          </div>
          <div className="admin-muted" style={{ marginBottom: 8 }}>
            Используется для автоматической загрузки заказов.
          </div>
          <div className="admin-form__row">
            <div>
              <label className="admin-label">Статус</label>
              <div className="admin-muted">
                {apiKeyInfo.hasKey ? "Ключ установлен" : "Ключ не задан"}
              </div>
            </div>
            <div>
              <label className="admin-label">Подсказка</label>
              <div className="admin-muted">{apiKeyInfo.hint || "-"}</div>
            </div>
          </div>
          <div className="admin-form__row">
            <div>
              <label className="admin-label">Последняя ротация</label>
              <div className="admin-muted">
                {apiKeyInfo.lastRotatedAt
                  ? new Date(apiKeyInfo.lastRotatedAt).toLocaleString("ru-RU")
                  : "-"}
              </div>
            </div>
          </div>
          <div className="admin-form__row">
            <div>
              <button
                type="button"
                className="admin-btn admin-btn--primary"
                onClick={rotateApiKey}
                disabled={apiKeyLoading}
              >
                {apiKeyLoading ? "Генерация..." : "Сгенерировать ключ"}
              </button>
            </div>
          </div>
          {apiKeyValue && (
            <div className="admin-form__row">
              <div>
                <label className="admin-label">Новый ключ</label>
                <input className="admin-input" readOnly value={apiKeyValue} />
              </div>
              <div>
                <label className="admin-label">&nbsp;</label>
                <button
                  type="button"
                  className="admin-btn admin-btn--secondary"
                  onClick={() => {
                    if (navigator?.clipboard?.writeText) {
                      navigator.clipboard.writeText(apiKeyValue);
                    }
                  }}
                >
                  Скопировать
                </button>
              </div>
            </div>
          )}

          <div className="admin-divider" />
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
                  Р РµРґР°РєС‚РёСЂРѕРІР°С‚СЊ С‚РѕРІР°СЂ
                </div>
                <div className="admin-modal__subtitle">{editItem.name}</div>
              </div>
                <button
                  type="button"
                  className="admin-btn admin-btn--ghost"
                  onClick={() => setEditItem(null)}
                >
                  вњ•
                </button>
            </div>
            <div className="admin-form">
              <div className="admin-form__row">
                <div>
                  <label className="admin-label">РќР°Р·РІР°РЅРёРµ</label>
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
                  <label className="admin-label">РЁС‚СЂРёС…РєРѕРґ</label>
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
                  <label className="admin-label">Р•РґРёРЅРёС†Р°</label>
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
                  <label className="admin-label">РњРёРЅ. РѕСЃС‚Р°С‚РѕРє</label>
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
                  <label className="admin-label">РњР°РєСЃ. РѕСЃС‚Р°С‚РѕРє</label>
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
                <label className="admin-label">Р¦РµРЅР° РїРѕ СѓРјРѕР»С‡Р°РЅРёСЋ</label>
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
                  {"РђРІС‚РѕР·Р°РєР°Р·"}
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
                  {"Р’РєР»СЋС‡РёС‚СЊ Р°РІС‚РѕР·Р°РєР°Р·"}
                </label>
                {editItem.autoReorderActive && (
                  <div className="admin-muted" style={{ marginTop: 6 }}>
                    {"РђРІС‚РѕР·Р°РєР°Р· Р°РєС‚РёРІРµРЅ"}
                  </div>
                )}
              </div>
              <div className="admin-form__row">
                <div>
                  <label className="admin-label">
                    {"РњРёРЅ. РѕСЃС‚Р°С‚РѕРє РґР»СЏ Р°РІС‚РѕР·Р°РєР°Р·Р°"}
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
                    {"РџРѕСЃС‚Р°РІС‰РёРє"}
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
                    <option value="">{"Р’С‹Р±РµСЂРёС‚Рµ РїРѕСЃС‚Р°РІС‰РёРєР°"}</option>
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
                    {"РљРѕРЅС‚Р°РєС‚РЅРѕРµ Р»РёС†Рѕ"}
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
                    {"Email РґР»СЏ Р°РІС‚РѕР·Р°РєР°Р·Р°"}
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
                  {"РўРµРєСЃС‚ СЃРѕРѕР±С‰РµРЅРёСЏ РїРѕСЃС‚Р°РІС‰РёРєСѓ"}
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
                  {"РЎР±СЂРѕСЃРёС‚СЊ С„Р»Р°Рі Р°РІС‚РѕР·Р°РєР°Р·Р°"}
                </label>
              )}
            </div>
            <div className="admin-modal__actions">
              <button
                type="button"
                className="admin-btn admin-btn--ghost"
                onClick={() => setEditItem(null)}
              >
                РћС‚РјРµРЅР°
              </button>
              <button
                type="button"
                className="admin-btn admin-btn--primary"
                onClick={handleSaveItem}
                disabled={saving}
              >
                {saving
                  ? "РЎРѕС…СЂР°РЅРµРЅРёРµ..."
                  : "РЎРѕС…СЂР°РЅРёС‚СЊ"}
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
                  Р РµРґР°РєС‚РёСЂРѕРІР°С‚СЊ СЏС‡РµР№РєСѓ
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
                  <label className="admin-label">РќР°Р·РІР°РЅРёРµ</label>
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
                  <label className="admin-label">РљРѕРґ</label>
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
                  <label className="admin-label">Р—РѕРЅР°</label>
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
                  <label className="admin-label">Р СЏРґ</label>
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
                  <label className="admin-label">РЎС‚РµР»Р»Р°Р¶</label>
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
                  <label className="admin-label">РЈСЂРѕРІРµРЅСЊ</label>
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
                  {"РђРІС‚РѕР·Р°РєР°Р·"}
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
                  {"Р’РєР»СЋС‡РёС‚СЊ Р°РІС‚РѕР·Р°РєР°Р·"}
                </label>
                {editItem.autoReorderActive && (
                  <div className="admin-muted" style={{ marginTop: 6 }}>
                    {"РђРІС‚РѕР·Р°РєР°Р· Р°РєС‚РёРІРµРЅ"}
                  </div>
                )}
              </div>
              <div className="admin-form__row">
                <div>
                  <label className="admin-label">
                    {"РњРёРЅ. РѕСЃС‚Р°С‚РѕРє РґР»СЏ Р°РІС‚РѕР·Р°РєР°Р·Р°"}
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
                    {"РџРѕСЃС‚Р°РІС‰РёРє"}
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
                    <option value="">{"Р’С‹Р±РµСЂРёС‚Рµ РїРѕСЃС‚Р°РІС‰РёРєР°"}</option>
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
                    {"РљРѕРЅС‚Р°РєС‚РЅРѕРµ Р»РёС†Рѕ"}
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
                    {"Email РґР»СЏ Р°РІС‚РѕР·Р°РєР°Р·Р°"}
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
                  {"РўРµРєСЃС‚ СЃРѕРѕР±С‰РµРЅРёСЏ РїРѕСЃС‚Р°РІС‰РёРєСѓ"}
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
                  {"РЎР±СЂРѕСЃРёС‚СЊ С„Р»Р°Рі Р°РІС‚РѕР·Р°РєР°Р·Р°"}
                </label>
              )}
            </div>
            <div className="admin-modal__actions">
              <button
                type="button"
                className="admin-btn admin-btn--ghost"
                onClick={() => setEditLocation(null)}
              >
                РћС‚РјРµРЅР°
              </button>
              <button
                type="button"
                className="admin-btn admin-btn--primary"
                onClick={handleSaveLocation}
                disabled={saving}
              >
                {saving
                  ? "РЎРѕС…СЂР°РЅРµРЅРёРµ..."
                  : "РЎРѕС…СЂР°РЅРёС‚СЊ"}
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
                  Р РµРґР°РєС‚РёСЂРѕРІР°С‚СЊ Р·Р°СЏРІРєСѓ
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
                  <label className="admin-label">РЎС‚Р°С‚СѓСЃ</label>
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
                  <label className="admin-label">Р–РµР»Р°РµРјР°СЏ РґР°С‚Р°</label>
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
                <label className="admin-label">РљРѕРјРјРµРЅС‚Р°СЂРёР№ Рє СЃС‚Р°С‚СѓСЃСѓ</label>
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
                <label className="admin-label">РљРѕРјРјРµРЅС‚Р°СЂРёР№</label>
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
                  {"РђРІС‚РѕР·Р°РєР°Р·"}
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
                  {"Р’РєР»СЋС‡РёС‚СЊ Р°РІС‚РѕР·Р°РєР°Р·"}
                </label>
                {editItem.autoReorderActive && (
                  <div className="admin-muted" style={{ marginTop: 6 }}>
                    {"РђРІС‚РѕР·Р°РєР°Р· Р°РєС‚РёРІРµРЅ"}
                  </div>
                )}
              </div>
              <div className="admin-form__row">
                <div>
                  <label className="admin-label">
                    {"РњРёРЅ. РѕСЃС‚Р°С‚РѕРє РґР»СЏ Р°РІС‚РѕР·Р°РєР°Р·Р°"}
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
                    {"РџРѕСЃС‚Р°РІС‰РёРє"}
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
                    <option value="">{"Р’С‹Р±РµСЂРёС‚Рµ РїРѕСЃС‚Р°РІС‰РёРєР°"}</option>
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
                    {"РљРѕРЅС‚Р°РєС‚РЅРѕРµ Р»РёС†Рѕ"}
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
                    {"Email РґР»СЏ Р°РІС‚РѕР·Р°РєР°Р·Р°"}
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
                  {"РўРµРєСЃС‚ СЃРѕРѕР±С‰РµРЅРёСЏ РїРѕСЃС‚Р°РІС‰РёРєСѓ"}
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
                  {"РЎР±СЂРѕСЃРёС‚СЊ С„Р»Р°Рі Р°РІС‚РѕР·Р°РєР°Р·Р°"}
                </label>
              )}
            </div>
            <div className="admin-modal__actions">
              <button
                type="button"
                className="admin-btn admin-btn--ghost"
                onClick={() => setEditRequest(null)}
              >
                РћС‚РјРµРЅР°
              </button>
              <button
                type="button"
                className="admin-btn admin-btn--primary"
                onClick={handleSaveRequest}
                disabled={saving}
              >
                {saving
                  ? "РЎРѕС…СЂР°РЅРµРЅРёРµ..."
                  : "РЎРѕС…СЂР°РЅРёС‚СЊ"}
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteItem && (
        <div className="admin-modal">
          <div className="admin-modal__panel admin-modal__panel--danger">
            <div className="admin-modal__title">
              РЈРґР°Р»РёС‚СЊ С‚РѕРІР°СЂ
            </div>
            <div className="admin-modal__subtitle">{deleteItem.name}</div>
            <div className="admin-modal__actions">
              <button
                type="button"
                className="admin-btn admin-btn--ghost"
                onClick={() => setDeleteItem(null)}
              >
                РћС‚РјРµРЅР°
              </button>
              <button
                type="button"
                className="admin-btn admin-btn--danger"
                onClick={handleDeleteItem}
                disabled={deleting}
              >
                {deleting
                  ? "РЈРґР°Р»РµРЅРёРµ..."
                  : "РЈРґР°Р»РёС‚СЊ"}
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteLocation && (
        <div className="admin-modal">
          <div className="admin-modal__panel admin-modal__panel--danger">
            <div className="admin-modal__title">
              РЈРґР°Р»РёС‚СЊ СЏС‡РµР№РєСѓ
            </div>
            <div className="admin-modal__subtitle">{deleteLocation.name}</div>
            <div className="admin-modal__actions">
              <button
                type="button"
                className="admin-btn admin-btn--ghost"
                onClick={() => setDeleteLocation(null)}
              >
                РћС‚РјРµРЅР°
              </button>
              <button
                type="button"
                className="admin-btn admin-btn--danger"
                onClick={handleDeleteLocation}
                disabled={deleting}
              >
                {deleting
                  ? "РЈРґР°Р»РµРЅРёРµ..."
                  : "РЈРґР°Р»РёС‚СЊ"}
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



