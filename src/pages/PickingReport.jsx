import { Fragment, useEffect, useMemo, useState } from "react";
import { apiFetch, normalizeErrorMessage } from "../apiConfig";

function toLocalDateTimeInputValue(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60 * 1000);
  return local.toISOString().slice(0, 16);
}

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("ru-RU");
}

const EMPTY_REPORT = {
  range: { from: null, to: null },
  totals: { workers: 0, orders: 0, lines: 0, qtyOrdered: 0, qtyPicked: 0 },
  users: [],
};

const ORDER_STATUS_LABELS = {
  NEW: "Новый",
  IN_PICKING: "В отборе",
  PICKED: "Отобран",
  PACKED: "Упакован",
  READY_TO_SHIP: "Готов к отгрузке",
  SHIPPED: "Отгружен",
  CANCELLED: "Отменён",
};

function formatOrderStatus(status) {
  if (!status) return "-";
  return ORDER_STATUS_LABELS[status] || status;
}

export default function PickingReport() {
  const [from, setFrom] = useState(() =>
    toLocalDateTimeInputValue(Date.now() - 7 * 24 * 60 * 60 * 1000)
  );
  const [to, setTo] = useState(() => toLocalDateTimeInputValue(new Date()));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [report, setReport] = useState(EMPTY_REPORT);
  const [expandedUserId, setExpandedUserId] = useState(null);

  const headers = useMemo(() => {
    const token = localStorage.getItem("token");
    return {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
  }, []);

  const loadReport = async () => {
    try {
      setLoading(true);
      setError("");
      const query = new URLSearchParams();
      if (from) query.set("from", new Date(from).toISOString());
      if (to) query.set("to", new Date(to).toISOString());

      const res = await apiFetch(`/admin/reports/picking?${query.toString()}`, {
        headers,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.message || "Не удалось сформировать отчёт.");
      }
      setReport({
        range: data?.range || EMPTY_REPORT.range,
        totals: data?.totals || EMPTY_REPORT.totals,
        users: Array.isArray(data?.users) ? data.users : [],
      });
    } catch (err) {
      setError(normalizeErrorMessage(err, "Ошибка загрузки отчёта по отбору."));
      setReport(EMPTY_REPORT);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="admin-console__card admin-panel">
      <div className="admin-console__card-title">Биллинг ресурсов</div>
      <div className="admin-console__card-text">
        Отчёт по отбору заявок сотрудниками за выбранный период.
      </div>

      <div className="admin-form__row" style={{ marginTop: 12 }}>
        <div>
          <label className="admin-label">Период: с</label>
          <input
            className="admin-input"
            type="datetime-local"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
          />
        </div>
        <div>
          <label className="admin-label">по</label>
          <input
            className="admin-input"
            type="datetime-local"
            value={to}
            onChange={(event) => setTo(event.target.value)}
          />
        </div>
      </div>

      <div className="admin-panel__toolbar">
        <button
          type="button"
          className="admin-btn admin-btn--primary"
          onClick={loadReport}
          disabled={loading}
        >
          {loading ? "Формирование..." : "Сформировать отчёт"}
        </button>
      </div>

      {error && <div className="admin-alert admin-alert--error">{error}</div>}

      {!error && (
        <div className="admin-console__card admin-panel admin-panel--nested" style={{ marginTop: 12 }}>
          <div className="admin-console__card-title">Итоги</div>
          <div className="admin-console__card-text">
            Сотрудников: {report.totals.workers || 0} • Заявок:{" "}
            {report.totals.orders || 0} • Строк: {report.totals.lines || 0} • К
            отбору: {report.totals.qtyOrdered || 0} • Отобрано:{" "}
            {report.totals.qtyPicked || 0}
          </div>
          <div className="admin-muted">
            Период отчёта: {formatDateTime(report.range?.from)} —{" "}
            {formatDateTime(report.range?.to)}
          </div>
        </div>
      )}

      {!loading && !error && report.users.length === 0 && (
        <div className="admin-muted">Нет данных по отбору за выбранный период.</div>
      )}

      {!error && report.users.length > 0 && (
        <div className="admin-table-wrapper">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Сотрудник</th>
                <th>Логин</th>
                <th>Заявок</th>
                <th>Строк</th>
                <th>Отобрано</th>
                <th>Первый отбор</th>
                <th>Последний отбор</th>
                <th>Детали</th>
              </tr>
            </thead>
            <tbody>
              {report.users.map((row) => {
                const isExpanded = expandedUserId === row.userId;
                return (
                  <Fragment key={row.userId}>
                    <tr>
                      <td data-label="Сотрудник">{row.userName || "-"}</td>
                      <td data-label="Логин">{row.userLogin || "-"}</td>
                      <td data-label="Заявок">{row.ordersCount || 0}</td>
                      <td data-label="Строк">{row.linesCount || 0}</td>
                      <td data-label="Отобрано">{row.qtyPicked || 0}</td>
                      <td data-label="Первый отбор">
                        {formatDateTime(row.firstEventAt)}
                      </td>
                      <td data-label="Последний отбор">
                        {formatDateTime(row.lastEventAt)}
                      </td>
                      <td data-label="Детали">
                        <button
                          type="button"
                          className="admin-btn admin-btn--secondary"
                          onClick={() =>
                            setExpandedUserId((prev) =>
                              prev === row.userId ? null : row.userId
                            )
                          }
                        >
                          {isExpanded ? "Скрыть" : "Показать"}
                        </button>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr>
                        <td colSpan={8} style={{ background: "#f8fafc" }}>
                          <div className="admin-table-wrapper">
                            <table className="admin-table">
                              <thead>
                                <tr>
                                  <th>ID</th>
                                  <th>Номер заявки</th>
                                  <th>Клиент</th>
                                  <th>Статус</th>
                                  <th>К отбору</th>
                                  <th>Отобрано</th>
                                  <th>Время</th>
                                </tr>
                              </thead>
                              <tbody>
                                {(row.orders || []).map((order) => (
                                  <tr key={order.id}>
                                    <td data-label="ID">{order.id}</td>
                                    <td data-label="Номер заявки">
                                      {order.orderNumber || "-"}
                                    </td>
                                    <td data-label="Клиент">
                                      {order.customerName || "-"}
                                    </td>
                                    <td data-label="Статус">
                                      {formatOrderStatus(order.status)}
                                    </td>
                                    <td data-label="К отбору">
                                      {order.qtyOrdered || 0}
                                    </td>
                                    <td data-label="Отобрано">
                                      {order.qtyPicked || 0}
                                    </td>
                                    <td data-label="Время">
                                      {formatDateTime(order.eventAt)}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
