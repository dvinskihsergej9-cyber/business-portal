import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../apiConfig";

export default function WarehouseLocationsPanel() {
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState([]);
  const [itemsLoading, setItemsLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [createLoading, setCreateLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [subtab, setSubtab] = useState("location");
  const [editLoading, setEditLoading] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [qrResetLoading, setQrResetLoading] = useState(false);

  const [form, setForm] = useState({
    name: "",
    zone: "",
    aisle: "",
    rack: "",
    level: "",
  });

  const [selectedId, setSelectedId] = useState("");
  const [itemPick, setItemPick] = useState("");
  const [selectedItems, setSelectedItems] = useState([]);
  const [qty, setQty] = useState(1);
  const [layout, setLayout] = useState("A4");
  const [editForm, setEditForm] = useState({
    name: "",
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

  const loadLocations = async () => {
    try {
      setLoading(true);
      setError("");
      const res = await apiFetch("/warehouse/locations", {
        headers: authHeaders,
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || "Ошибка загрузки ячеек");
      }
      setLocations(data);
    } catch (err) {
      setError(err.message || "Ошибка загрузки ячеек");
    } finally {
      setLoading(false);
    }
  };

  const loadItems = async () => {
    try {
      setItemsLoading(true);
      setError("");
      const res = await apiFetch("/inventory/items", {
        headers: authHeaders,
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          data.message || "Ошибка загрузки товаров"
        );
      }
      setItems(data);
    } catch (err) {
      setError(
        err.message ||
          "Ошибка загрузки товаров"
      );
    } finally {
      setItemsLoading(false);
    }
  };

  useEffect(() => {
    loadLocations();
    loadItems();
  }, []);

  const handleCreate = async () => {
    const name = form.name.trim();
    if (!name) {
      setError("Введите название ячейки.");
      return;
    }

    try {
      setCreateLoading(true);
      setError("");
      setMessage("");
      const res = await apiFetch("/warehouse/locations", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          name,
          zone: form.zone.trim() || null,
          aisle: form.aisle.trim() || null,
          rack: form.rack.trim() || null,
          level: form.level.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || "Ошибка создания ячейки");
      }
      setForm({ name: "", zone: "", aisle: "", rack: "", level: "" });
      setMessage(`Ячейка создана: ${data.name}`);
      setSelectedId(String(data.id));
      await loadLocations();
    } catch (err) {
      setError(err.message || "Ошибка создания ячейки");
    } finally {
      setCreateLoading(false);
    }
  };

  const ensureLocationQr = async (locationId) => {
    const res = await apiFetch(`/warehouse/locations/${locationId}/qr`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({}),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.message || "Не удалось создать QR");
    }
    return data;
  };

  const handlePrint = async () => {
    if (!selectedId) {
      setError("Выберите ячейку.");
      return;
    }

    try {
      setActionLoading(true);
      setError("");
      setMessage("");
      const locationId = Number(selectedId);
      await ensureLocationQr(locationId);
      const res = await apiFetch("/warehouse/print/labels", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          kind: "location",
          ids: [locationId],
          qtyPerId: Number(qty) || 1,
          layout,
        }),
      });
      const html = await res.text();
      if (!res.ok) {
        let messageText = "Ошибка печати";
        try {
          const parsed = JSON.parse(html);
          messageText = parsed.message || messageText;
        } catch {}
        throw new Error(messageText);
      }
      const printWindow = window.open("", "_blank");
      if (printWindow) {
        printWindow.document.write(html);
        printWindow.document.close();
      } else {
        throw new Error("Блокировщик всплывающих окон");
      }
    } catch (err) {
      setError(err.message || "Ошибка печати");
    } finally {
      setActionLoading(false);
    }
  };

  const handleUpdateLocation = async () => {
    if (!selectedId) {
      setError("Выберите ячейку.");
      return;
    }
    if (!editForm.name.trim()) {
      setError("Укажите название ячейки.");
      return;
    }

    try {
      setEditLoading(true);
      setError("");
      setMessage("");
      const res = await apiFetch(`/warehouse/locations/${selectedId}`, {
        method: "PUT",
        headers: authHeaders,
        body: JSON.stringify({
          name: editForm.name,
          zone: editForm.zone,
          aisle: editForm.aisle,
          rack: editForm.rack,
          level: editForm.level,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          data.message ||
            "Ошибка обновления ячейки"
        );
      }
      setMessage(
        `Ячейка обновлена: ${data.name}`
      );
      await loadLocations();
    } catch (err) {
      setError(
        err.message ||
          "Ошибка обновления ячейки"
      );
    } finally {
      setEditLoading(false);
    }
  };

  const handleDeleteLocation = async () => {
    if (!selectedId) {
      setError("Выберите ячейку.");
      return;
    }
    if (!window.confirm("Удалить ячейку?")) {
      return;
    }
    try {
      setDeleteLoading(true);
      setError("");
      setMessage("");
      const res = await apiFetch(`/warehouse/locations/${selectedId}`, {
        method: "DELETE",
        headers: authHeaders,
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          data.message ||
            "Ошибка удаления ячейки"
        );
      }
      setMessage("Ячейка удалена.");
      setSelectedId("");
      await loadLocations();
    } catch (err) {
      setError(
        err.message ||
          "Ошибка удаления ячейки"
      );
    } finally {
      setDeleteLoading(false);
    }
  };

  const handleResetQr = async () => {
    if (!selectedId) {
      setError("Выберите ячейку.");
      return;
    }
    try {
      setQrResetLoading(true);
      setError("");
      setMessage("");
      const res = await apiFetch(`/warehouse/locations/${selectedId}/qr`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ force: true }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          data.message || "Ошибка обновления QR"
        );
      }
      setMessage("Код QR обновлен.");
      await loadLocations();
    } catch (err) {
      setError(err.message || "Ошибка обновления QR");
    } finally {
      setQrResetLoading(false);
    }
  };

  const handleAddItem = () => {
    const id = Number(itemPick);
    if (!id) return;
    const selected = items.find((item) => item.id === id);
    if (!selected) return;
    setSelectedItems((prev) => {
      if (prev.find((entry) => entry.id === selected.id)) return prev;
      return [...prev, selected];
    });
    setItemPick("");
  };

  const handlePrintItems = async () => {
    if (!selectedItems.length) {
      setError(
        "Выберите товары."
      );
      return;
    }

    try {
      setActionLoading(true);
      setError("");
      setMessage("");
      const res = await apiFetch("/warehouse/print/labels", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          kind: "item",
          ids: selectedItems.map((item) => item.id),
          qtyPerId: Number(qty) || 1,
          layout,
        }),
      });
      const html = await res.text();
      if (!res.ok) {
        let messageText =
          "Ошибка печати";
        try {
          const parsed = JSON.parse(html);
          messageText = parsed.message || messageText;
        } catch {}
        throw new Error(messageText);
      }
      const printWindow = window.open("", "_blank");
      if (printWindow) {
        printWindow.document.write(html);
        printWindow.document.close();
      } else {
        throw new Error(
          "Блокировщик всплывающих окон"
        );
      }
    } catch (err) {
      setError(
        err.message || "Ошибка печати"
      );
    } finally {
      setActionLoading(false);
    }
  };

  const selectedLocation = locations.find(
    (loc) => String(loc.id) === String(selectedId)
  );
  useEffect(() => {
    if (!selectedLocation) {
      setEditForm({
        name: "",
        zone: "",
        aisle: "",
        rack: "",
        level: "",
      });
      return;
    }
    setEditForm({
      name: selectedLocation.name || "",
      zone: selectedLocation.zone || "",
      aisle: selectedLocation.aisle || "",
      rack: selectedLocation.rack || "",
      level: selectedLocation.level || "",
    });
  }, [selectedLocation]);

  return (
    <div className="warehouse-locations">
      {error && <div className="alert alert--error">{error}</div>}
      {message && <div className="alert alert--success">{message}</div>}

      <div className="tabs tabs--sm">
        <button
          type="button"
          className={
            "tabs__btn " +
            (subtab === "location" ? "tabs__btn--active" : "")
          }
          onClick={() => setSubtab("location")}
        >
          {"Ячейки / QR"}
        </button>
        <button
          type="button"
          className={
            "tabs__btn " + (subtab === "item" ? "tabs__btn--active" : "")
          }
          onClick={() => setSubtab("item")}
        >
          {"Товары / QR"}
        </button>
      </div>

      {subtab === "location" && (
        <div className="warehouse-locations__grid">
          <div className="card">
            <h3 className="card__title">{`Создать ячейку`}</h3>
            <p className="card__subtitle">
              {`Название обязательно, остальные поля можно не заполнять.`}
            </p>
            <div className="warehouse-locations__form">
              <label className="form__label">{`Название`}</label>
              <input
                className="form__input"
                value={form.name}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, name: event.target.value }))
                }
              placeholder={"Например: A-01-01"}
              />

            <div className="warehouse-locations__row">
              <div>
                <label className="form__label">{`Зона`}</label>
                <input
                  className="form__input"
                  value={form.zone}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, zone: event.target.value }))
                  }
                />
              </div>
              <div>
                <label className="form__label">{`Ряд`}</label>
                <input
                  className="form__input"
                  value={form.aisle}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, aisle: event.target.value }))
                  }
                />
              </div>
            </div>

            <div className="warehouse-locations__row">
              <div>
                <label className="form__label">{`Стеллаж`}</label>
                <input
                  className="form__input"
                  value={form.rack}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, rack: event.target.value }))
                  }
                />
              </div>
              <div>
                <label className="form__label">{`Уровень`}</label>
                <input
                  className="form__input"
                  value={form.level}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, level: event.target.value }))
                  }
                />
              </div>
            </div>

            <button
              type="button"
              className="btn btn--primary"
              onClick={handleCreate}
              disabled={createLoading}
            >
              {createLoading
                ? "Создание..."
                : "Создать ячейку"}
            </button>
          </div>
        </div>

          <div className="card">
            <h3 className="card__title">{`QR для ячейки`}</h3>
            <p className="card__subtitle">
              {`Формат QR: BP:LOC:<id>`}
            </p>

            <div className="warehouse-locations__form">
              <label className="form__label">{`Ячейка`}</label>
              <select
                className="form__select"
                value={selectedId}
                onChange={(event) => setSelectedId(event.target.value)}
              >
                <option value="">{`Выберите ячейку`}</option>
                {locations.map((loc) => (
                  <option key={loc.id} value={loc.id}>
                    {loc.name || `Ячейка ${loc.id}`}
                  </option>
                ))}
              </select>

            {selectedLocation && (
              <div className="warehouse-locations__meta">
                <div>
                  {`Название: ${selectedLocation.name}`}
                </div>
                <div>
                  {`QR: ${selectedLocation.qrCode ? "уже создан" : "не создан"}`}
                </div>
              </div>
            )}

            <div className="warehouse-locations__edit">
              <div className="warehouse-locations__edit-title">
                {"Редактировать ячейку"}
              </div>
              <div className="warehouse-locations__row">
                <div>
                  <label className="form__label">{`Название`}</label>
                  <input
                    className="form__input"
                    value={editForm.name}
                    onChange={(event) =>
                      setEditForm((prev) => ({
                        ...prev,
                        name: event.target.value,
                      }))
                    }
                    disabled={!selectedId}
                  />
                </div>
                <div>
                  <label className="form__label">{`Зона`}</label>
                  <input
                    className="form__input"
                    value={editForm.zone}
                    onChange={(event) =>
                      setEditForm((prev) => ({
                        ...prev,
                        zone: event.target.value,
                      }))
                    }
                    disabled={!selectedId}
                  />
                </div>
              </div>
              <div className="warehouse-locations__row">
                <div>
                  <label className="form__label">{`Ряд`}</label>
                  <input
                    className="form__input"
                    value={editForm.aisle}
                    onChange={(event) =>
                      setEditForm((prev) => ({
                        ...prev,
                        aisle: event.target.value,
                      }))
                    }
                    disabled={!selectedId}
                  />
                </div>
                <div>
                  <label className="form__label">{`Стеллаж`}</label>
                  <input
                    className="form__input"
                    value={editForm.rack}
                    onChange={(event) =>
                      setEditForm((prev) => ({
                        ...prev,
                        rack: event.target.value,
                      }))
                    }
                    disabled={!selectedId}
                  />
                </div>
              </div>
              <div className="warehouse-locations__row">
                <div>
                  <label className="form__label">{`Уровень`}</label>
                  <input
                    className="form__input"
                    value={editForm.level}
                    onChange={(event) =>
                      setEditForm((prev) => ({
                        ...prev,
                        level: event.target.value,
                      }))
                    }
                    disabled={!selectedId}
                  />
                </div>
                <div />
              </div>
              <div className="warehouse-locations__actions">
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={handleUpdateLocation}
                  disabled={editLoading || !selectedId}
                >
                  {editLoading
                    ? "Сохранение..."
                    : "Сохранить"}
                </button>
                <button
                  type="button"
                  className="btn btn--secondary"
                  onClick={handleResetQr}
                  disabled={qrResetLoading || !selectedId}
                >
                  {qrResetLoading
                    ? "Обновление QR..."
                    : "Сбросить QR"}
                </button>
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={handleDeleteLocation}
                  disabled={deleteLoading || !selectedId}
                >
                  {deleteLoading
                    ? "Удаление..."
                    : "Удалить"}
                </button>
              </div>
            </div>

              <div className="warehouse-locations__row">
                <div>
                  <label className="form__label">{`Количество`}</label>
                  <input
                    className="form__input"
                    type="number"
                    min="1"
                    value={qty}
                    onChange={(event) => setQty(event.target.value)}
                  />
                </div>
                <div>
                  <label className="form__label">{`Макет`}</label>
                  <select
                    className="form__select"
                    value={layout}
                    onChange={(event) => setLayout(event.target.value)}
                  >
                    <option value="A4">A4</option>
                    <option value="label">Этикетка</option>
                  </select>
                </div>
              </div>

              <div className="warehouse-locations__actions">
                <button
                  type="button"
                  className="btn btn--secondary"
                  onClick={loadLocations}
                  disabled={loading}
                >
                  {`Обновить список`}
                </button>
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={handlePrint}
                  disabled={actionLoading}
                >
                  {actionLoading
                    ? "Печать..."
                    : "Создать QR и печатать"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {subtab === "item" && (
        <div className="warehouse-locations__grid warehouse-locations__grid--single">
          <div className="card">
            <h3 className="card__title">{`QR для товара`}</h3>
            <p className="card__subtitle">
              {`QR формируется из BP:ITEM:<id>`}
            </p>

            <div className="warehouse-locations__form">
              <label className="form__label">{`Товар`}</label>
              <div className="warehouse-locations__row">
                <select
                  className="form__select"
                  value={itemPick}
                  onChange={(event) => setItemPick(event.target.value)}
                >
                  <option value="">{`Выберите товар`}</option>
                  {items.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} {item.sku ? `(${item.sku})` : ""}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn btn--secondary"
                  onClick={handleAddItem}
                >
                  {`Добавить`}
                </button>
              </div>

              {selectedItems.length > 0 && (
                <div className="warehouse-locations__list">
                  {selectedItems.map((item) => (
                    <div className="warehouse-locations__list-item" key={item.id}>
                      <div>
                        <div className="warehouse-locations__list-title">
                          {item.name}
                        </div>
                        {item.sku && (
                          <div className="warehouse-locations__list-meta">
                            Артикул: {item.sku}
                          </div>
                        )}
                      </div>
                      <button
                        type="button"
                        className="btn btn--ghost"
                        onClick={() =>
                          setSelectedItems((prev) =>
                            prev.filter((entry) => entry.id !== item.id)
                          )
                        }
                      >
                        &times;
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="warehouse-locations__row">
                <div>
                  <label className="form__label">{`Количество`}</label>
                  <input
                    className="form__input"
                    type="number"
                    min="1"
                    value={qty}
                    onChange={(event) => setQty(event.target.value)}
                  />
                </div>
                <div>
                  <label className="form__label">{`Макет`}</label>
                  <select
                    className="form__select"
                    value={layout}
                    onChange={(event) => setLayout(event.target.value)}
                  >
                    <option value="A4">A4</option>
                    <option value="label">Этикетка</option>
                  </select>
                </div>
              </div>

              <div className="warehouse-locations__actions">
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={handlePrintItems}
                  disabled={actionLoading}
                >
                  {actionLoading
                    ? "Печать..."
                    : "Печатать этикетки"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {loading && (
        <div className="text-muted">
          {`Загрузка ячеек...`}
        </div>
      )}
      {itemsLoading && (
        <div className="text-muted">
          {`Загрузка товаров...`}
        </div>
      )}
    </div>
  );
}
