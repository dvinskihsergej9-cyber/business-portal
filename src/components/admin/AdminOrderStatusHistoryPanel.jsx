import { useCallback, useEffect, useMemo, useState } from "react";
import { API_BASE, normalizeErrorMessage } from "../../apiConfig";

const STATUS_LABELS = {
  NEW: "Новый",
  IN_PICKING: "В отборе",
  PICKED: "Отобран",
  PACKED: "Упакован",
  READY_TO_SHIP: "Готов к отгрузке",
  SHIPPED: "Отгружен",
  CANCELLED: "Отменен",
};

const EVENT_LABELS = {
  COMPLETE: "Завершение отбора",
  SHIP: "Отгрузка",
};

const formatDateTime = (value) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("ru-RU");
};

const statusLabel = (status) =>
  STATUS_LABELS[String(status || "").trim()] || String(status || "-");

const eventLabel = (eventType) =>
  EVENT_LABELS[String(eventType || "").trim()] || String(eventType || "-");

const actorLabel = (actor) => {
  if (!actor) return "-";
  return actor.name || actor.email || `#${actor.id}`;
};

const compactMeta = (meta) => {
  if (!meta || typeof meta !== "object") return "-";
  const entries = Object.entries(meta).filter(([, value]) => {
    if (value == null) return false;
    return String(value).trim().length > 0;
  });
  if (!entries.length) return "-";
  return entries
    .map(([key, value]) => `${key}: ${value}`)
    .join(" | ");
};

export default function AdminOrderStatusHistoryPanel() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [orderId, setOrderId] = useState("");
  const [toStatus, setToStatus] = useState("");
  const [actorUserId, setActorUserId] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const limit = 50;

  const authHeaders = useMemo(() => {
    const token = localStorage.getItem("token");
    return {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
  }, []);

  const totalPages = Math.max(1, Math.ceil((Number(total) || 0) / limit));

  const buildQuery = useCallback(() => {
    const params = new URLSearchParams();
    params.set("page", String(page));
    params.set("limit", String(limit));
    if (String(orderId).trim()) params.set("orderId", String(orderId).trim());
    if (String(toStatus).trim()) params.set("toStatus", String(toStatus).trim());
    if (String(actorUserId).trim()) params.set("actorUserId", String(actorUserId).trim());
    if (String(fromDate).trim()) params.set("fromDate", String(fromDate).trim());
    if (String(toDate).trim()) params.set("toDate", String(toDate).trim());
    return params.toString();
  }, [actorUserId, fromDate, orderId, page, toDate, toStatus]);

  const loadHistory = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const query = buildQuery();
      const res = await fetch(`${API_BASE}/orders/status-history?${query}`, {
        headers: authHeaders,
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.message || "Не удалось загрузить журнал статусов.");
      }
      setItems(Array.isArray(data?.items) ? data.items : []);
      setTotal(Number(data?.total) || 0);
    } catch (err) {
      setError(normalizeErrorMessage(err, "Не удалось загрузить журнал статусов."));
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [authHeaders, buildQuery]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  return (
    <div className="admin-console__card">
      <div className="admin-console__card-title">Журнал статусов заказов</div>
      <div className="admin-console__card-text">
        Общая история переходов по заказам: кто и когда перевел заказ в следующий статус.
      </div>

      {error ? <div className="admin-alert admin-alert--error">{error}</div> : null}
      {loading ? <div className="admin-muted">Загрузка...</div> : null}

      <div className="admin-form" style={{ marginTop: 16 }}>
        <div>
          <label className="admin-label">ID заказа</label>
          <input
            className="admin-input"
            value={orderId}
            onChange={(event) => {
              setOrderId(event.target.value);
              setPage(1);
            }}
            placeholder="Например: 123"
          />
        </div>
        <div>
          <label className="admin-label">Статус назначения</label>
          <select
            className="admin-input"
            value={toStatus}
            onChange={(event) => {
              setToStatus(event.target.value);
              setPage(1);
            }}
          >
            <option value="">Все</option>
            <option value="READY_TO_SHIP">{statusLabel("READY_TO_SHIP")}</option>
            <option value="SHIPPED">{statusLabel("SHIPPED")}</option>
            <option value="CANCELLED">{statusLabel("CANCELLED")}</option>
          </select>
        </div>
        <div>
          <label className="admin-label">ID пользователя</label>
          <input
            className="admin-input"
            value={actorUserId}
            onChange={(event) => {
              setActorUserId(event.target.value);
              setPage(1);
            }}
            placeholder="Например: 15"
          />
        </div>
        <div>
          <label className="admin-label">С даты</label>
          <input
            className="admin-input"
            type="date"
            value={fromDate}
            onChange={(event) => {
              setFromDate(event.target.value);
              setPage(1);
            }}
          />
        </div>
        <div>
          <label className="admin-label">По дату</label>
          <input
            className="admin-input"
            type="date"
            value={toDate}
            onChange={(event) => {
              setToDate(event.target.value);
              setPage(1);
            }}
          />
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button
          type="button"
          className="admin-btn admin-btn--primary"
          onClick={() => loadHistory()}
          disabled={loading}
        >
          Применить фильтр
        </button>
        <button
          type="button"
          className="admin-btn admin-btn--ghost"
          onClick={() => {
            setOrderId("");
            setToStatus("");
            setActorUserId("");
            setFromDate("");
            setToDate("");
            setPage(1);
          }}
          disabled={loading}
        >
          Сбросить
        </button>
      </div>

      <div className="admin-table-wrapper" style={{ marginTop: 16 }}>
        <table className="admin-table">
          <thead>
            <tr>
              <th>Дата</th>
              <th>Заказ</th>
              <th>Переход</th>
              <th>Событие</th>
              <th>Кто</th>
              <th>Meta</th>
            </tr>
          </thead>
          <tbody>
            {items.map((row) => (
              <tr key={row.id}>
                <td data-label="date">{formatDateTime(row.createdAt)}</td>
                <td data-label="order">
                  <div className="admin-table__title">
                    {row.order?.orderNumber || `#${row.orderId}`}
                  </div>
                  <div className="admin-table__meta">{row.order?.customerName || "-"}</div>
                </td>
                <td data-label="transition">
                  {statusLabel(row.fromStatus)} {"->"} {statusLabel(row.toStatus)}
                </td>
                <td data-label="event">{eventLabel(row.eventType)}</td>
                <td data-label="actor">{actorLabel(row.actorUser)}</td>
                <td data-label="meta">{compactMeta(row.metaJson)}</td>
              </tr>
            ))}
            {items.length === 0 ? (
              <tr>
                <td colSpan={6} className="admin-muted">
                  Записей не найдено.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12 }}>
        <button
          type="button"
          className="admin-btn admin-btn--ghost"
          disabled={loading || page <= 1}
          onClick={() => setPage((prev) => Math.max(1, prev - 1))}
        >
          Назад
        </button>
        <div className="admin-muted">
          Страница {page} из {totalPages} • Всего: {total}
        </div>
        <button
          type="button"
          className="admin-btn admin-btn--ghost"
          disabled={loading || page >= totalPages}
          onClick={() => setPage((prev) => prev + 1)}
        >
          Вперед
        </button>
      </div>
    </div>
  );
}

