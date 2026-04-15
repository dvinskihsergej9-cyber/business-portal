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

const PICKING_MODE_SCAN_EACH = "SCAN_EACH";
const PICKING_MODE_MANUAL_QTY = "MANUAL_QTY";

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
  const [activeSubtab, setActiveSubtab] = useState("mode");

  const [loadingJournal, setLoadingJournal] = useState(true);
  const [savingJournal, setSavingJournal] = useState(false);
  const [journalError, setJournalError] = useState("");
  const [journalSuccess, setJournalSuccess] = useState("");
  const [candidates, setCandidates] = useState([]);
  const [allJournal, setAllJournal] = useState([]);
  const [modalOrder, setModalOrder] = useState(null);
  const [closeReason, setCloseReason] = useState("");

  const [loadingMode, setLoadingMode] = useState(true);
  const [savingMode, setSavingMode] = useState(false);
  const [modeError, setModeError] = useState("");
  const [modeSuccess, setModeSuccess] = useState("");
  const [pickingMode, setPickingMode] = useState(PICKING_MODE_SCAN_EACH);

  const authHeaders = useMemo(() => {
    const token = localStorage.getItem("token");
    return {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
  }, []);

  const loadJournalData = async () => {
    try {
      setLoadingJournal(true);
      setJournalError("");
      const [candRes, allJournalRes] = await Promise.all([
        fetch(`${API_BASE}/orders/admin-shortage-candidates`, {
          headers: authHeaders,
        }),
        fetch(`${API_BASE}/orders/admin-picking-journal`, {
          headers: authHeaders,
        }),
      ]);

      const candData = await candRes.json().catch(() => null);
      const allJournalData = await allJournalRes.json().catch(() => null);

      if (!candRes.ok) {
        throw new Error(candData?.message || "ORDER_SHORTAGE_CANDIDATES_ERROR");
      }
      if (!allJournalRes.ok) {
        throw new Error(allJournalData?.message || "ORDER_PICKING_JOURNAL_ERROR");
      }

      setCandidates(Array.isArray(candData?.items) ? candData.items : []);
      setAllJournal(Array.isArray(allJournalData?.items) ? allJournalData.items : []);
    } catch (err) {
      setJournalError(
        normalizeErrorMessage(err, "Не удалось загрузить данные по отбору.")
      );
    } finally {
      setLoadingJournal(false);
    }
  };

  const loadPickingMode = async () => {
    try {
      setLoadingMode(true);
      setModeError("");
      const res = await fetch(`${API_BASE}/settings/picking-mode`, {
        headers: authHeaders,
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.message || "PICKING_MODE_GET_ERROR");
      }
      const mode = String(data?.mode || "").trim().toUpperCase();
      setPickingMode(
        mode === PICKING_MODE_MANUAL_QTY
          ? PICKING_MODE_MANUAL_QTY
          : PICKING_MODE_SCAN_EACH
      );
    } catch (err) {
      setModeError(normalizeErrorMessage(err, "Не удалось загрузить режим отбора."));
    } finally {
      setLoadingMode(false);
    }
  };

  useEffect(() => {
    loadJournalData();
    loadPickingMode();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openCloseModal = (order) => {
    setModalOrder(order);
    setCloseReason("");
    setJournalSuccess("");
    setJournalError("");
  };

  const closeOrderByAdmin = async () => {
    if (!modalOrder) return;
    const reason = String(closeReason || "").trim();
    if (!reason) {
      setJournalError("Укажите причину закрытия.");
      return;
    }

    try {
      setSavingJournal(true);
      setJournalError("");
      setJournalSuccess("");
      const res = await fetch(
        `${API_BASE}/orders/${modalOrder.id}/admin-close-shortage`,
        {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({ reason }),
        }
      );
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.message || "ORDER_ADMIN_CLOSE_ERROR");
      }

      setJournalSuccess(`Заказ ${modalOrder.orderNumber} закрыт администратором.`);
      setModalOrder(null);
      setCloseReason("");
      await loadJournalData();
    } catch (err) {
      setJournalError(
        normalizeErrorMessage(err, "Не удалось закрыть заказ с недостачей.")
      );
    } finally {
      setSavingJournal(false);
    }
  };

  const savePickingMode = async () => {
    try {
      setSavingMode(true);
      setModeError("");
      setModeSuccess("");

      const res = await fetch(`${API_BASE}/settings/picking-mode`, {
        method: "PUT",
        headers: authHeaders,
        body: JSON.stringify({ mode: pickingMode }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.message || "PICKING_MODE_SAVE_ERROR");
      }

      const mode = String(data?.mode || "").trim().toUpperCase();
      setPickingMode(
        mode === PICKING_MODE_MANUAL_QTY
          ? PICKING_MODE_MANUAL_QTY
          : PICKING_MODE_SCAN_EACH
      );
      setModeSuccess("Режим отбора сохранен.");
    } catch (err) {
      setModeError(normalizeErrorMessage(err, "Не удалось сохранить режим отбора."));
    } finally {
      setSavingMode(false);
    }
  };

  return (
    <div className="admin-console__card admin-panel">
      <div className="admin-console__card-title">Отбор</div>
      <div className="admin-console__card-text">
        Настройки режима отбора и общий журнал работы с заданиями.
      </div>

      <div className="admin-console__tabs" style={{ marginTop: 12, marginBottom: 12 }}>
        <button
          type="button"
          className={
            "admin-console__tab" +
            (activeSubtab === "mode" ? " admin-console__tab--active" : "")
          }
          onClick={() => setActiveSubtab("mode")}
        >
          Режим отбора
        </button>
        <button
          type="button"
          className={
            "admin-console__tab" +
            (activeSubtab === "journal" ? " admin-console__tab--active" : "")
          }
          onClick={() => setActiveSubtab("journal")}
        >
          Журнал
        </button>
      </div>

      {activeSubtab === "mode" && (
        <div className="admin-form">
          {loadingMode ? <div className="admin-muted">Загрузка...</div> : null}
          {modeError ? <div className="admin-alert admin-alert--error">{modeError}</div> : null}
          {modeSuccess ? <div className="admin-muted">{modeSuccess}</div> : null}

          {!loadingMode ? (
            <>
              <div>
                <label className="admin-label">Режим отбора заказов (ТСД)</label>
                <select
                  className="admin-input"
                  value={pickingMode}
                  onChange={(event) => setPickingMode(event.target.value)}
                  disabled={savingMode}
                >
                  <option value={PICKING_MODE_SCAN_EACH}>Сканировать каждую штуку</option>
                  <option value={PICKING_MODE_MANUAL_QTY}>Вводить количество вручную</option>
                </select>
                <div className="admin-muted" style={{ marginTop: 6 }}>
                  В режиме ручного ввода после скана ячейки сотрудник подтверждает количество
                  одной операцией.
                </div>
              </div>

              <div className="admin-panel__toolbar">
                <button
                  type="button"
                  className="admin-btn admin-btn--primary"
                  onClick={savePickingMode}
                  disabled={savingMode}
                >
                  {savingMode ? "Сохранение..." : "Сохранить режим"}
                </button>
              </div>
            </>
          ) : null}
        </div>
      )}

      {activeSubtab === "journal" && (
        <>
          {loadingJournal ? <div className="admin-muted">Загрузка...</div> : null}
          {journalError ? <div className="admin-alert admin-alert--error">{journalError}</div> : null}
          {journalSuccess ? <div className="admin-muted">{journalSuccess}</div> : null}

          {!loadingJournal && (
            <>
              <div className="admin-panel__section-title">Активные задания с пропусками</div>
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
                            disabled={savingJournal}
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

              <div className="admin-panel__section-title">Общий журнал отбора</div>
              <div className="admin-table-wrapper">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Дата</th>
                      <th>Заказ</th>
                      <th>Статус</th>
                      <th>Исполнитель</th>
                      <th>Отобрано</th>
                      <th>Комментарий закрытия</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allJournal.map((row) => (
                      <tr key={row.id}>
                        <td data-label="date">
                          {formatDate(
                            row.completedAt ||
                              row.packedAt ||
                              row.pickedAt ||
                              row.updatedAt ||
                              row.createdAt
                          )}
                        </td>
                        <td data-label="order">
                          <div className="admin-table__title">{row.orderNumber || "-"}</div>
                          <div className="admin-table__meta">{row.customerName || "-"}</div>
                        </td>
                        <td data-label="status">{statusLabel(row.status)}</td>
                        <td data-label="assignee">{userLabel(row.assignedToUser)}</td>
                        <td data-label="picked">
                          {(row.pickedQty || 0)} / {(row.totalQty || 0)}
                        </td>
                        <td data-label="close">
                          {row?.closeMeta?.reason ? `Недостача: ${row.closeMeta.reason}` : "-"}
                        </td>
                      </tr>
                    ))}
                    {allJournal.length === 0 ? (
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
                disabled={savingJournal}
              >
                Отмена
              </button>
              <button
                type="button"
                className="admin-btn admin-btn--danger"
                onClick={closeOrderByAdmin}
                disabled={savingJournal}
              >
                {savingJournal ? "Закрытие..." : "Подтвердить закрытие"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
