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
        throw new Error(data.message || "\u041e\u0448\u0438\u0431\u043a\u0430 \u0437\u0430\u0433\u0440\u0443\u0437\u043a\u0438 \u044f\u0447\u0435\u0435\u043a");
      }
      setLocations(data);
    } catch (err) {
      setError(err.message || "\u041e\u0448\u0438\u0431\u043a\u0430 \u0437\u0430\u0433\u0440\u0443\u0437\u043a\u0438 \u044f\u0447\u0435\u0435\u043a");
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
          data.message || "\u041e\u0448\u0438\u0431\u043a\u0430 \u0437\u0430\u0433\u0440\u0443\u0437\u043a\u0438 \u0442\u043e\u0432\u0430\u0440\u043e\u0432"
        );
      }
      setItems(data);
    } catch (err) {
      setError(
        err.message ||
          "\u041e\u0448\u0438\u0431\u043a\u0430 \u0437\u0430\u0433\u0440\u0443\u0437\u043a\u0438 \u0442\u043e\u0432\u0430\u0440\u043e\u0432"
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
      setError("\u0412\u0432\u0435\u0434\u0438\u0442\u0435 \u043d\u0430\u0437\u0432\u0430\u043d\u0438\u0435 \u044f\u0447\u0435\u0439\u043a\u0438.");
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
        throw new Error(data.message || "\u041e\u0448\u0438\u0431\u043a\u0430 \u0441\u043e\u0437\u0434\u0430\u043d\u0438\u044f \u044f\u0447\u0435\u0439\u043a\u0438");
      }
      setForm({ name: "", zone: "", aisle: "", rack: "", level: "" });
      setMessage(`\u042f\u0447\u0435\u0439\u043a\u0430 \u0441\u043e\u0437\u0434\u0430\u043d\u0430: ${data.name}`);
      setSelectedId(String(data.id));
      await loadLocations();
    } catch (err) {
      setError(err.message || "\u041e\u0448\u0438\u0431\u043a\u0430 \u0441\u043e\u0437\u0434\u0430\u043d\u0438\u044f \u044f\u0447\u0435\u0439\u043a\u0438");
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
      throw new Error(data.message || "\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0441\u043e\u0437\u0434\u0430\u0442\u044c QR");
    }
    return data;
  };

  const handlePrint = async () => {
    if (!selectedId) {
      setError("\u0412\u044b\u0431\u0435\u0440\u0438\u0442\u0435 \u044f\u0447\u0435\u0439\u043a\u0443.");
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
        let messageText = "\u041e\u0448\u0438\u0431\u043a\u0430 \u043f\u0435\u0447\u0430\u0442\u0438";
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
        throw new Error("\u0411\u043b\u043e\u043a\u0438\u0440\u043e\u0432\u0449\u0438\u043a \u0432\u0441\u043f\u043b\u044b\u0432\u0430\u044e\u0449\u0438\u0445 \u043e\u043a\u043e\u043d");
      }
    } catch (err) {
      setError(err.message || "\u041e\u0448\u0438\u0431\u043a\u0430 \u043f\u0435\u0447\u0430\u0442\u0438");
    } finally {
      setActionLoading(false);
    }
  };

  const handleUpdateLocation = async () => {
    if (!selectedId) {
      setError("\u0412\u044b\u0431\u0435\u0440\u0438\u0442\u0435 \u044f\u0447\u0435\u0439\u043a\u0443.");
      return;
    }
    if (!editForm.name.trim()) {
      setError("\u0423\u043a\u0430\u0436\u0438\u0442\u0435 \u043d\u0430\u0437\u0432\u0430\u043d\u0438\u0435 \u044f\u0447\u0435\u0439\u043a\u0438.");
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
            "\u041e\u0448\u0438\u0431\u043a\u0430 \u043e\u0431\u043d\u043e\u0432\u043b\u0435\u043d\u0438\u044f \u044f\u0447\u0435\u0439\u043a\u0438"
        );
      }
      setMessage(
        `\u042f\u0447\u0435\u0439\u043a\u0430 \u043e\u0431\u043d\u043e\u0432\u043b\u0435\u043d\u0430: ${data.name}`
      );
      await loadLocations();
    } catch (err) {
      setError(
        err.message ||
          "\u041e\u0448\u0438\u0431\u043a\u0430 \u043e\u0431\u043d\u043e\u0432\u043b\u0435\u043d\u0438\u044f \u044f\u0447\u0435\u0439\u043a\u0438"
      );
    } finally {
      setEditLoading(false);
    }
  };

  const handleDeleteLocation = async () => {
    if (!selectedId) {
      setError("\u0412\u044b\u0431\u0435\u0440\u0438\u0442\u0435 \u044f\u0447\u0435\u0439\u043a\u0443.");
      return;
    }
    if (!window.confirm("\u0423\u0434\u0430\u043b\u0438\u0442\u044c \u044f\u0447\u0435\u0439\u043a\u0443?")) {
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
            "\u041e\u0448\u0438\u0431\u043a\u0430 \u0443\u0434\u0430\u043b\u0435\u043d\u0438\u044f \u044f\u0447\u0435\u0439\u043a\u0438"
        );
      }
      setMessage("\u042f\u0447\u0435\u0439\u043a\u0430 \u0443\u0434\u0430\u043b\u0435\u043d\u0430.");
      setSelectedId("");
      await loadLocations();
    } catch (err) {
      setError(
        err.message ||
          "\u041e\u0448\u0438\u0431\u043a\u0430 \u0443\u0434\u0430\u043b\u0435\u043d\u0438\u044f \u044f\u0447\u0435\u0439\u043a\u0438"
      );
    } finally {
      setDeleteLoading(false);
    }
  };

  const handleResetQr = async () => {
    if (!selectedId) {
      setError("\u0412\u044b\u0431\u0435\u0440\u0438\u0442\u0435 \u044f\u0447\u0435\u0439\u043a\u0443.");
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
          data.message || "\u041e\u0448\u0438\u0431\u043a\u0430 \u043e\u0431\u043d\u043e\u0432\u043b\u0435\u043d\u0438\u044f QR"
        );
      }
      setMessage("\u041a\u043e\u0434 QR \u043e\u0431\u043d\u043e\u0432\u043b\u0435\u043d.");
      await loadLocations();
    } catch (err) {
      setError(err.message || "\u041e\u0448\u0438\u0431\u043a\u0430 \u043e\u0431\u043d\u043e\u0432\u043b\u0435\u043d\u0438\u044f QR");
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
        "\u0412\u044b\u0431\u0435\u0440\u0438\u0442\u0435 \u0442\u043e\u0432\u0430\u0440\u044b."
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
          "\u041e\u0448\u0438\u0431\u043a\u0430 \u043f\u0435\u0447\u0430\u0442\u0438";
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
          "\u0411\u043b\u043e\u043a\u0438\u0440\u043e\u0432\u0449\u0438\u043a \u0432\u0441\u043f\u043b\u044b\u0432\u0430\u044e\u0449\u0438\u0445 \u043e\u043a\u043e\u043d"
        );
      }
    } catch (err) {
      setError(
        err.message || "\u041e\u0448\u0438\u0431\u043a\u0430 \u043f\u0435\u0447\u0430\u0442\u0438"
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
          {"\u042f\u0447\u0435\u0439\u043a\u0438 / QR"}
        </button>
        <button
          type="button"
          className={
            "tabs__btn " + (subtab === "item" ? "tabs__btn--active" : "")
          }
          onClick={() => setSubtab("item")}
        >
          {"\u0422\u043e\u0432\u0430\u0440\u044b / QR"}
        </button>
      </div>

      {subtab === "location" && (
        <div className="warehouse-locations__grid">
          <div className="card">
            <h3 className="card__title">{`\u0421\u043e\u0437\u0434\u0430\u0442\u044c \u044f\u0447\u0435\u0439\u043a\u0443`}</h3>
            <p className="card__subtitle">
              {`\u041d\u0430\u0437\u0432\u0430\u043d\u0438\u0435 \u043e\u0431\u044f\u0437\u0430\u0442\u0435\u043b\u044c\u043d\u043e, \u043e\u0441\u0442\u0430\u043b\u044c\u043d\u044b\u0435 \u043f\u043e\u043b\u044f \u043c\u043e\u0436\u043d\u043e \u043d\u0435 \u0437\u0430\u043f\u043e\u043b\u043d\u044f\u0442\u044c.`}
            </p>
            <div className="warehouse-locations__form">
              <label className="form__label">{`\u041d\u0430\u0437\u0432\u0430\u043d\u0438\u0435`}</label>
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
                <label className="form__label">{`\u0417\u043e\u043d\u0430`}</label>
                <input
                  className="form__input"
                  value={form.zone}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, zone: event.target.value }))
                  }
                />
              </div>
              <div>
                <label className="form__label">{`\u0420\u044f\u0434`}</label>
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
                <label className="form__label">{`\u0421\u0442\u0435\u043b\u043b\u0430\u0436`}</label>
                <input
                  className="form__input"
                  value={form.rack}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, rack: event.target.value }))
                  }
                />
              </div>
              <div>
                <label className="form__label">{`\u0423\u0440\u043e\u0432\u0435\u043d\u044c`}</label>
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
                ? "\u0421\u043e\u0437\u0434\u0430\u043d\u0438\u0435..."
                : "\u0421\u043e\u0437\u0434\u0430\u0442\u044c \u044f\u0447\u0435\u0439\u043a\u0443"}
            </button>
          </div>
        </div>

          <div className="card">
            <h3 className="card__title">{`QR \u0434\u043b\u044f \u044f\u0447\u0435\u0439\u043a\u0438`}</h3>
            <p className="card__subtitle">
              {`\u0424\u043e\u0440\u043c\u0430\u0442 QR: BP:LOC:<id>`}
            </p>

            <div className="warehouse-locations__form">
              <label className="form__label">{`\u042f\u0447\u0435\u0439\u043a\u0430`}</label>
              <select
                className="form__select"
                value={selectedId}
                onChange={(event) => setSelectedId(event.target.value)}
              >
                <option value="">{`\u0412\u044b\u0431\u0435\u0440\u0438\u0442\u0435 \u044f\u0447\u0435\u0439\u043a\u0443`}</option>
                {locations.map((loc) => (
                  <option key={loc.id} value={loc.id}>
                    {loc.name || `\u042f\u0447\u0435\u0439\u043a\u0430 ${loc.id}`}
                  </option>
                ))}
              </select>

            {selectedLocation && (
              <div className="warehouse-locations__meta">
                <div>
                  {`\u041d\u0430\u0437\u0432\u0430\u043d\u0438\u0435: ${selectedLocation.name}`}
                </div>
                <div>
                  {`QR: ${selectedLocation.qrCode ? "\u0443\u0436\u0435 \u0441\u043e\u0437\u0434\u0430\u043d" : "\u043d\u0435 \u0441\u043e\u0437\u0434\u0430\u043d"}`}
                </div>
              </div>
            )}

            <div className="warehouse-locations__edit">
              <div className="warehouse-locations__edit-title">
                {"\u0420\u0435\u0434\u0430\u043a\u0442\u0438\u0440\u043e\u0432\u0430\u0442\u044c \u044f\u0447\u0435\u0439\u043a\u0443"}
              </div>
              <div className="warehouse-locations__row">
                <div>
                  <label className="form__label">{`\u041d\u0430\u0437\u0432\u0430\u043d\u0438\u0435`}</label>
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
                  <label className="form__label">{`\u0417\u043e\u043d\u0430`}</label>
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
                  <label className="form__label">{`\u0420\u044f\u0434`}</label>
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
                  <label className="form__label">{`\u0421\u0442\u0435\u043b\u043b\u0430\u0436`}</label>
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
                  <label className="form__label">{`\u0423\u0440\u043e\u0432\u0435\u043d\u044c`}</label>
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
                    ? "\u0421\u043e\u0445\u0440\u0430\u043d\u0435\u043d\u0438\u0435..."
                    : "\u0421\u043e\u0445\u0440\u0430\u043d\u0438\u0442\u044c"}
                </button>
                <button
                  type="button"
                  className="btn btn--secondary"
                  onClick={handleResetQr}
                  disabled={qrResetLoading || !selectedId}
                >
                  {qrResetLoading
                    ? "\u041e\u0431\u043d\u043e\u0432\u043b\u0435\u043d\u0438\u0435 QR..."
                    : "\u0421\u0431\u0440\u043e\u0441\u0438\u0442\u044c QR"}
                </button>
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={handleDeleteLocation}
                  disabled={deleteLoading || !selectedId}
                >
                  {deleteLoading
                    ? "\u0423\u0434\u0430\u043b\u0435\u043d\u0438\u0435..."
                    : "\u0423\u0434\u0430\u043b\u0438\u0442\u044c"}
                </button>
              </div>
            </div>

              <div className="warehouse-locations__row">
                <div>
                  <label className="form__label">{`\u041a\u043e\u043b\u0438\u0447\u0435\u0441\u0442\u0432\u043e`}</label>
                  <input
                    className="form__input"
                    type="number"
                    min="1"
                    value={qty}
                    onChange={(event) => setQty(event.target.value)}
                  />
                </div>
                <div>
                  <label className="form__label">{`\u041c\u0430\u043a\u0435\u0442`}</label>
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
                  {`\u041e\u0431\u043d\u043e\u0432\u0438\u0442\u044c \u0441\u043f\u0438\u0441\u043e\u043a`}
                </button>
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={handlePrint}
                  disabled={actionLoading}
                >
                  {actionLoading
                    ? "\u041f\u0435\u0447\u0430\u0442\u044c..."
                    : "\u0421\u043e\u0437\u0434\u0430\u0442\u044c QR \u0438 \u043f\u0435\u0447\u0430\u0442\u0430\u0442\u044c"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {subtab === "item" && (
        <div className="warehouse-locations__grid warehouse-locations__grid--single">
          <div className="card">
            <h3 className="card__title">{`QR \u0434\u043b\u044f \u0442\u043e\u0432\u0430\u0440\u0430`}</h3>
            <p className="card__subtitle">
              {`QR \u0444\u043e\u0440\u043c\u0438\u0440\u0443\u0435\u0442\u0441\u044f \u0438\u0437 BP:ITEM:<id>`}
            </p>

            <div className="warehouse-locations__form">
              <label className="form__label">{`\u0422\u043e\u0432\u0430\u0440`}</label>
              <div className="warehouse-locations__row">
                <select
                  className="form__select"
                  value={itemPick}
                  onChange={(event) => setItemPick(event.target.value)}
                >
                  <option value="">{`\u0412\u044b\u0431\u0435\u0440\u0438\u0442\u0435 \u0442\u043e\u0432\u0430\u0440`}</option>
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
                  {`\u0414\u043e\u0431\u0430\u0432\u0438\u0442\u044c`}
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
                  <label className="form__label">{`\u041a\u043e\u043b\u0438\u0447\u0435\u0441\u0442\u0432\u043e`}</label>
                  <input
                    className="form__input"
                    type="number"
                    min="1"
                    value={qty}
                    onChange={(event) => setQty(event.target.value)}
                  />
                </div>
                <div>
                  <label className="form__label">{`\u041c\u0430\u043a\u0435\u0442`}</label>
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
                    ? "\u041f\u0435\u0447\u0430\u0442\u044c..."
                    : "\u041f\u0435\u0447\u0430\u0442\u0430\u0442\u044c \u044d\u0442\u0438\u043a\u0435\u0442\u043a\u0438"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {loading && (
        <div className="text-muted">
          {`\u0417\u0430\u0433\u0440\u0443\u0437\u043a\u0430 \u044f\u0447\u0435\u0435\u043a...`}
        </div>
      )}
      {itemsLoading && (
        <div className="text-muted">
          {`\u0417\u0430\u0433\u0440\u0443\u0437\u043a\u0430 \u0442\u043e\u0432\u0430\u0440\u043e\u0432...`}
        </div>
      )}
    </div>
  );
}
