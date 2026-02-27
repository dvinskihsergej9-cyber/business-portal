import { useEffect, useMemo, useState } from "react";
import { API_BASE, normalizeErrorMessage } from "../../apiConfig";

const STATUS_LABELS = {
  NEW: "Новый",
  IN_PICKING: "В отборе",
  PICKED: "Отобран",
  PACKED: "Упакован",
  READY_TO_SHIP: "Готов к отгрузке",
  SHIPPED: "Отгружен",
  CANCELLED: "Закрыт",
};

function statusLabel(status) {
  const key = String(status || "").trim();
  return STATUS_LABELS[key] || key || "-";
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("ru-RU");
}

function userLabel(user) {
  if (!user) return "-";
  return user.name || user.email || `#${user.id}`;
}

export default function AdminPickingShortagePanel() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [candidates, setCandidates] = useState([]);
  const [journal, setJournal] = useState([]);
  const [modalOrder, setModalOrder] = useState(null);
  const [closeReason, setCloseReason] = useState("");

  const authHeaders = useMemo(() => {
    const token = localStorage.getItem("token");
    return {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      setError("");
      const [candRes, journalRes] = await Promise.all([
        fetch(`${API_BASE}/orders/admin-shortage-candidates`, {
          headers: authHeaders,
        }),
        fetch(`${API_BASE}/orders/admin-shortage-journal`, {
          headers: authHeaders,
        }),
      ]);

      const candData = await candRes.json();
      const journalData = await journalRes.json();

      if (!candRes.ok) {
        throw new Error(candData?.message || "ORDER_SHORTAGE_CANDIDATES_ERROR");
      }
      if (!journalRes.ok) {
        throw new Error(journalData?.message || "ORDER_SHORTAGE_JOURNAL_ERROR");
      }

      setCandidates(Array.isArray(candData?.items) ? candData.items : []);
      setJournal(Array.isArray(journalData?.items) ? journalData.items : []);
    } catch (err) {
      setError(normalizeErrorMessage(err, "Не удалось загрузить данные по отбору."));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openCloseModal = (order) => {
    setModalOrder(order);
    setCloseReason("");
    setSuccess("");
    setError("");
  };

  const closeOrderByAdmin = async () => {
    if (!modalOrder) return;
    const reason = String(closeReason || "").trim();
    if (!reason) {
      setError("Укажите причину закрытия.");
      return;
    }

    try {
      setSaving(true);
      setError("");
      setSuccess("");
      const res = await fetch(
        `${API_BASE}/orders/${modalOrder.id}/admin-close-shortage`,
        {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({ reason }),
        }
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.message || "ORDER_ADMIN_CLOSE_ERROR");
      }

      setSuccess(`Заказ ${modalOrder.orderNumber} закрыт администратором.`);
      setModalOrder(null);
      setCloseReason("");
      await loadData();
    } catch (err) {
      setError(normalizeErrorMessage(err, "Не удалось закрыть заказ с недостачей."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="admin-console__card">
      <div className="admin-console__card-title">Отбор: недостачи</div>
      <div className="admin-console__card-text">
        Админ может закрыть задание с недостачей, если у заказа есть пропущенные позиции и замен нет.
      </div>

      {loading ? <div className="admin-muted">Загрузка...</div> : null}
      {error ? <div className="admin-alert admin-alert--error">{error}</div> : null}
      {success ? <div className="admin-muted">{success}</div> : null}

      {!loading && (
        <>
          <div style={{ marginTop: 16, fontWeight: 700 }}>Активные задания с пропусками</div>
          <div className="admin-table-wrapper">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Заказ</th>
                  <th>Статус</th>
                  <th>Исполнитель</th>
                  <th>Пропуски</th>
                  <th>Осталось шт.</th>
                  <th>Действие</th>
                </tr>
              </thead>
              <tbody>
                {candidates.map((order) => (
                  <tr key={order.id}>
                    <td data-label="id">{order.id}</td>
                    <td data-label="order">
                      <div className="admin-table__title">{order.orderNumber || "-"}</div>
                      <div className="admin-table__meta">{order.customerName || "-"}</div>
                    </td>
                    <td data-label="status">{statusLabel(order.status)}</td>
                    <td data-label="assignee">{userLabel(order.assignedToUser)}</td>
                    <td data-label="skips">{order.activeSkipCount || 0}</td>
                    <td data-label="remaining">{order.remainingQty || 0}</td>
                    <td data-label="action" className="admin-table__actions">
                      <button
                        type="button"
                        className="admin-btn admin-btn--danger"
                        onClick={() => openCloseModal(order)}
                        disabled={saving}
                      >
                        Закрыть с недостачей
                      </button>
                    </td>
                  </tr>
                ))}
                {candidates.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="admin-muted">
                      Нет активных заданий с пропущенными позициями.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          <div style={{ marginTop: 18, fontWeight: 700 }}>
            Журнал закрытий с недостачей
          </div>
          <div className="admin-table-wrapper">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Дата</th>
                  <th>Заказ</th>
                  <th>Причина</th>
                  <th>Кто закрыл</th>
                  <th>Пропуски</th>
                  <th>Осталось шт.</th>
                </tr>
              </thead>
              <tbody>
                {journal.map((row) => (
                  <tr key={row.id}>
                    <td data-label="date">
                      {formatDate(row?.closeMeta?.closedAt || row?.completedAt)}
                    </td>
                    <td data-label="order">
                      <div className="admin-table__title">{row.orderNumber || "-"}</div>
                      <div className="admin-table__meta">{row.customerName || "-"}</div>
                    </td>
                    <td data-label="reason">{row?.closeMeta?.reason || "-"}</td>
                    <td data-label="closedBy">
                      {row?.closeMeta?.closedByName ||
                        row?.closeMeta?.closedByEmail ||
                        "-"}
                    </td>
                    <td data-label="skips">{row.activeSkipCount || 0}</td>
                    <td data-label="remaining">{row.remainingQty || 0}</td>
                  </tr>
                ))}
                {journal.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="admin-muted">
                      Записей пока нет.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </>
      )}

      {modalOrder ? (
        <div className="admin-modal">
          <div className="admin-modal__panel admin-modal__panel--danger">
            <div className="admin-modal__header">
              <div>
                <div className="admin-modal__title">Закрыть задание с недостачей</div>
                <div className="admin-modal__subtitle">
                  Заказ {modalOrder.orderNumber} ({modalOrder.customerName || "-"})
                </div>
              </div>
            </div>

            <div className="admin-form">
              <div>
                <label className="admin-label">Причина (обязательно)</label>
                <textarea
                  className="admin-input"
                  rows={4}
                  value={closeReason}
                  onChange={(event) => setCloseReason(event.target.value)}
                  placeholder="Например: нет остатков и нет замены у поставщика."
                />
              </div>
            </div>

            <div className="admin-modal__actions">
              <button
                type="button"
                className="admin-btn admin-btn--ghost"
                onClick={() => setModalOrder(null)}
                disabled={saving}
              >
                Отмена
              </button>
              <button
                type="button"
                className="admin-btn admin-btn--danger"
                onClick={closeOrderByAdmin}
                disabled={saving}
              >
                {saving ? "Закрытие..." : "Подтвердить закрытие"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

