import { useEffect, useMemo, useState } from "react";
import { API_BASE } from "../apiConfig";

const API = API_BASE;

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("ru-RU");
}

function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

export default function StockHoldsPanel({
  showTitle = true,
  withTopMargin = true,
}) {
  const token = localStorage.getItem("token");
  const authHeaders = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);

  const [items, setItems] = useState([]);
  const [locations, setLocations] = useState([]);
  const [holds, setHolds] = useState([]);

  const [statusFilter, setStatusFilter] = useState("ACTIVE");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [releasingId, setReleasingId] = useState(null);
  const [error, setError] = useState("");

  const [mobileView, setMobileView] = useState("create");
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth <= 680 : false
  );

  const [itemId, setItemId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");

  const loadHolds = async (status = statusFilter) => {
    const query = new URLSearchParams({ status, limit: "200" });
    const res = await fetch(`${API}/warehouse/holds?${query.toString()}`, {
      headers: authHeaders,
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      throw new Error(data?.message || "Не удалось загрузить блокировки остатков.");
    }

    setHolds(Array.isArray(data?.items) ? data.items : []);
  };

  const loadInitial = async () => {
    setLoading(true);
    setError("");
    try {
      const [itemsRes, locationsRes] = await Promise.all([
        fetch(`${API}/inventory/items`, { headers: authHeaders }),
        fetch(`${API}/warehouse/locations`, { headers: authHeaders }),
      ]);

      const itemsData = await itemsRes.json().catch(() => []);
      const locationsData = await locationsRes.json().catch(() => []);

      if (!itemsRes.ok) {
        throw new Error(itemsData?.message || "Не удалось загрузить товары.");
      }
      if (!locationsRes.ok) {
        throw new Error(locationsData?.message || "Не удалось загрузить ячейки.");
      }

      const stockItems = (Array.isArray(itemsData) ? itemsData : []).filter(
        (it) => String(it?.category || "STOCK").toUpperCase() === "STOCK"
      );
      setItems(stockItems);
      setLocations(Array.isArray(locationsData) ? locationsData : []);

      await loadHolds(statusFilter);
    } catch (e) {
      setError(e?.message || "Ошибка загрузки данных блокировок.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const onResize = () => setIsMobile(window.innerWidth <= 680);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    loadInitial();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (loading) return;
    loadHolds(statusFilter).catch((e) =>
      setError(e?.message || "Не удалось загрузить список блокировок.")
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  const onCreateHold = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const payload = {
        itemId: Number(itemId),
        locationId: Number(locationId),
        qty: Number(qty),
        reason: String(reason || "").trim(),
        note: note ? String(note).trim() : null,
      };

      const res = await fetch(`${API}/warehouse/holds`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders,
        },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data?.message || "Не удалось создать блокировку.");
      }

      setQty("");
      setReason("");
      setNote("");
      setStatusFilter("ACTIVE");
      await loadHolds("ACTIVE");

      if (isMobile) {
        setMobileView("journal");
      }
    } catch (e) {
      setError(e?.message || "Ошибка создания блокировки.");
    } finally {
      setSaving(false);
    }
  };

  const onReleaseHold = async (id) => {
    setReleasingId(id);
    setError("");
    try {
      const res = await fetch(`${API}/warehouse/holds/${id}/release`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders,
        },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.message || "Не удалось снять блокировку.");
      }
      await loadHolds(statusFilter);
    } catch (e) {
      setError(e?.message || "Ошибка снятия блокировки.");
    } finally {
      setReleasingId(null);
    }
  };

  const showCreate = !isMobile || mobileView === "create";
  const showJournal = !isMobile || mobileView === "journal";

  return (
    <div className="card stock-holds-panel" style={{ marginTop: withTopMargin ? 16 : 0 }}>
      <div className="stock-holds-header">
        {showTitle ? <h3 className="stock-holds-title">Блокировка остатков</h3> : <span />}
        <div className="stock-holds-tabs">
          <button
            type="button"
            className={`tabs__btn ${statusFilter === "ACTIVE" ? "tabs__btn--active" : ""}`}
            onClick={() => setStatusFilter("ACTIVE")}
          >
            Активные
          </button>
          <button
            type="button"
            className={`tabs__btn ${statusFilter === "RELEASED" ? "tabs__btn--active" : ""}`}
            onClick={() => setStatusFilter("RELEASED")}
          >
            Снятые
          </button>
        </div>
      </div>

      {isMobile && (
        <div className="stock-holds-mobile-nav">
          <button
            type="button"
            className={`tabs__btn ${mobileView === "create" ? "tabs__btn--active" : ""}`}
            onClick={() => setMobileView("create")}
          >
            Создать
          </button>
          <button
            type="button"
            className={`tabs__btn ${mobileView === "journal" ? "tabs__btn--active" : ""}`}
            onClick={() => setMobileView("journal")}
          >
            Журнал
          </button>
        </div>
      )}

      {error && <div className="alert alert--danger">{error}</div>}

      {showCreate && (
        <form className="stock-holds-form" onSubmit={onCreateHold}>
          <select value={itemId} onChange={(e) => setItemId(e.target.value)} required>
            <option value="">Выберите товар</option>
            {items.map((it) => (
              <option key={it.id} value={it.id}>
                {it.name}
                {it.article || it.sku ? ` (${it.article || it.sku})` : ""}
              </option>
            ))}
          </select>

          <select value={locationId} onChange={(e) => setLocationId(e.target.value)} required>
            <option value="">Выберите ячейку</option>
            {locations.map((loc) => (
              <option key={loc.id} value={loc.id}>
                {loc.code || loc.name}
              </option>
            ))}
          </select>

          <input
            type="number"
            min="0.0001"
            step="0.0001"
            placeholder="Количество"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            required
          />

          <input
            type="text"
            placeholder="Причина"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            required
          />

          <input
            type="text"
            placeholder="Комментарий (необязательно)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />

          <button type="submit" disabled={saving || loading}>
            {saving ? "Сохраняем..." : "Заблокировать"}
          </button>
        </form>
      )}

      {showJournal &&
        (loading ? (
          <p style={{ marginTop: 12 }}>Загрузка...</p>
        ) : (
          <div className="table-wrapper stock-holds-table" style={{ marginTop: 12 }}>
            <table>
              <thead>
                <tr>
                  <th>№</th>
                  <th>Товар</th>
                  <th>Ячейка</th>
                  <th>Количество</th>
                  <th>Причина</th>
                  <th>Дата</th>
                  <th>Статус</th>
                  <th>Действие</th>
                </tr>
              </thead>
              <tbody>
                {holds.length === 0 ? (
                  <tr>
                    <td colSpan={8} style={{ textAlign: "center", color: "#64748b" }}>
                      Нет записей.
                    </td>
                  </tr>
                ) : (
                  holds.map((hold) => (
                    <tr key={hold.id}>
                      <td data-label="№">{hold.id}</td>
                      <td data-label="Товар">{hold.item?.name || `#${hold.itemId}`}</td>
                      <td data-label="Ячейка">
                        {hold.location?.code || hold.location?.name || `#${hold.locationId}`}
                      </td>
                      <td data-label="Количество">{toNumber(hold.qty)}</td>
                      <td data-label="Причина">{hold.reason || "-"}</td>
                      <td data-label="Дата">{formatDateTime(hold.createdAt)}</td>
                      <td data-label="Статус">
                        {hold.status === "ACTIVE" ? "Активна" : "Снята"}
                      </td>
                      <td data-label="Действие">
                        {hold.status === "ACTIVE" ? (
                          <button
                            type="button"
                            className="btn btn--secondary btn--sm"
                            onClick={() => onReleaseHold(hold.id)}
                            disabled={releasingId === hold.id}
                          >
                            {releasingId === hold.id ? "Снимаем..." : "Снять"}
                          </button>
                        ) : (
                          "-"
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        ))}
    </div>
  );
}
