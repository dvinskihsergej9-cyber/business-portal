import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch, normalizeErrorMessage } from "../../apiConfig";

const STATUS_OPTIONS = [
  { value: "", label: "Все статусы" },
  { value: "OPEN", label: "Открыта" },
  { value: "IN_PROGRESS", label: "В работе" },
  { value: "WAITING_USER", label: "Ждёт ответа" },
  { value: "RESOLVED", label: "Решена" },
];

const PRIORITY_OPTIONS = [
  { value: "", label: "Любой приоритет" },
  { value: "LOW", label: "Низкий" },
  { value: "NORMAL", label: "Обычный" },
  { value: "HIGH", label: "Высокий" },
  { value: "URGENT", label: "Критичный" },
];

const CATEGORY_OPTIONS = [
  { value: "", label: "Любая категория" },
  { value: "ACCESS", label: "Доступ и права" },
  { value: "BILLING", label: "Оплата и тарифы" },
  { value: "TECHNICAL", label: "Техническая ошибка" },
  { value: "INTEGRATION", label: "Интеграции" },
  { value: "OTHER", label: "Другое" },
];

const STATUS_LABELS = {
  OPEN: "Открыта",
  IN_PROGRESS: "В работе",
  WAITING_USER: "Ждёт ответа",
  RESOLVED: "Решена",
};

const PRIORITY_LABELS = {
  LOW: "Низкий",
  NORMAL: "Обычный",
  HIGH: "Высокий",
  URGENT: "Критичный",
};

function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("ru-RU");
}

function getStatusLabel(value) {
  return STATUS_LABELS[String(value || "").trim()] || "Открыта";
}

function getPriorityLabel(value) {
  return PRIORITY_LABELS[String(value || "").trim()] || "Обычный";
}

export default function AdminSupportPanel() {
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [statusFilter, setStatusFilter] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const limit = 20;

  const [selectedTicketId, setSelectedTicketId] = useState(null);
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [messages, setMessages] = useState([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [sendingReply, setSendingReply] = useState(false);
  const [savingMeta, setSavingMeta] = useState(false);
  const [editStatus, setEditStatus] = useState("OPEN");
  const [editPriority, setEditPriority] = useState("NORMAL");

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil((Number(total) || 0) / limit)),
    [total]
  );

  const authHeaders = useMemo(
    () => ({
      Authorization: `Bearer ${localStorage.getItem("token") || ""}`,
    }),
    []
  );

  const buildQuery = () => {
    const params = new URLSearchParams();
    params.set("page", String(page));
    params.set("limit", String(limit));
    if (statusFilter) params.set("status", statusFilter);
    if (priorityFilter) params.set("priority", priorityFilter);
    if (categoryFilter) params.set("category", categoryFilter);
    if (search.trim()) params.set("search", search.trim());
    return params.toString();
  };

  const loadTickets = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const res = await apiFetch(`/admin/support/tickets?${buildQuery()}`, {
        headers: authHeaders,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.message || "SUPPORT_TICKETS_LIST_ERROR");
      }
      const items = Array.isArray(data?.items) ? data.items : [];
      setTickets(items);
      setTotal(Number(data?.total) || 0);
      setSelectedTicketId((prev) => {
        if (!items.length) return null;
        if (!prev || !items.some((item) => item.id === prev)) return items[0].id;
        return prev;
      });
    } catch (err) {
      setError(normalizeErrorMessage(err, "Не удалось загрузить обращения."));
      setTickets([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [authHeaders, categoryFilter, page, priorityFilter, search, statusFilter]);

  const loadThread = useCallback(
    async (ticketId) => {
      const normalizedId = Number(ticketId || 0);
      if (!normalizedId) return;
      try {
        setThreadLoading(true);
        setError("");
        const res = await apiFetch(`/admin/support/tickets/${normalizedId}/messages`, {
          headers: authHeaders,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data?.message || "SUPPORT_TICKET_MESSAGES_ERROR");
        }
        const ticket = data?.ticket || null;
        setSelectedTicket(ticket);
        setMessages(Array.isArray(data?.messages) ? data.messages : []);
        setEditStatus(String(ticket?.status || "OPEN"));
        setEditPriority(String(ticket?.priority || "NORMAL"));
      } catch (err) {
        setError(normalizeErrorMessage(err, "Не удалось загрузить переписку."));
      } finally {
        setThreadLoading(false);
      }
    },
    [authHeaders]
  );

  useEffect(() => {
    loadTickets();
  }, [loadTickets]);

  useEffect(() => {
    if (!selectedTicketId) {
      setSelectedTicket(null);
      setMessages([]);
      return;
    }
    loadThread(selectedTicketId);
  }, [loadThread, selectedTicketId]);

  const handleApplyFilters = () => {
    if (page === 1) {
      loadTickets();
      return;
    }
    setPage(1);
  };

  const handleSendReply = async () => {
    const ticketId = Number(selectedTicketId || 0);
    const preparedReply = String(replyText || "").trim();
    if (!ticketId) return;
    if (!preparedReply) {
      setError("Введите текст ответа.");
      return;
    }
    try {
      setSendingReply(true);
      setError("");
      setSuccess("");
      const res = await apiFetch(`/admin/support/tickets/${ticketId}/messages`, {
        method: "POST",
        headers: {
          ...authHeaders,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ message: preparedReply }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.message || "SUPPORT_TICKET_REPLY_ERROR");
      }
      setReplyText("");
      setSuccess("Ответ отправлен.");
      await loadTickets();
      await loadThread(ticketId);
    } catch (err) {
      setError(normalizeErrorMessage(err, "Не удалось отправить ответ."));
    } finally {
      setSendingReply(false);
    }
  };

  const handleSaveMeta = async () => {
    const ticketId = Number(selectedTicketId || 0);
    if (!ticketId) return;
    try {
      setSavingMeta(true);
      setError("");
      setSuccess("");
      const res = await apiFetch(`/admin/support/tickets/${ticketId}`, {
        method: "PATCH",
        headers: {
          ...authHeaders,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          status: editStatus,
          priority: editPriority,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.message || "SUPPORT_TICKET_UPDATE_ERROR");
      }
      setSuccess("Параметры обращения обновлены.");
      await loadTickets();
      await loadThread(ticketId);
    } catch (err) {
      setError(normalizeErrorMessage(err, "Не удалось обновить обращение."));
    } finally {
      setSavingMeta(false);
    }
  };

  return (
    <div className="admin-console__card">
      <div className="admin-console__card-title">Поддержка</div>
      <div className="admin-console__card-text">
        Обращения сотрудников вашей компании и переписка с ними.
      </div>

      <div className="admin-filters" style={{ gridTemplateColumns: "1.4fr 1fr 1fr 1fr auto" }}>
        <div>
          <label className="admin-label">Поиск</label>
          <input
            className="admin-input"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Тема, имя или email"
          />
        </div>
        <div>
          <label className="admin-label">Статус</label>
          <select
            className="admin-select"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
          >
            {STATUS_OPTIONS.map((item) => (
              <option key={item.value || "all-status"} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="admin-label">Приоритет</label>
          <select
            className="admin-select"
            value={priorityFilter}
            onChange={(event) => setPriorityFilter(event.target.value)}
          >
            {PRIORITY_OPTIONS.map((item) => (
              <option key={item.value || "all-priority"} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="admin-label">Категория</label>
          <select
            className="admin-select"
            value={categoryFilter}
            onChange={(event) => setCategoryFilter(event.target.value)}
          >
            {CATEGORY_OPTIONS.map((item) => (
              <option key={item.value || "all-category"} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </div>
        <button type="button" className="admin-btn admin-btn--ghost" onClick={handleApplyFilters}>
          Применить
        </button>
      </div>

      {error ? <div className="admin-alert admin-alert--error">{error}</div> : null}
      {success ? <div className="admin-muted">{success}</div> : null}

      <div className="admin-table-wrapper">
        <table className="admin-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Тема</th>
              <th>Пользователь</th>
              <th>Статус</th>
              <th>Приоритет</th>
              <th>Обновлено</th>
              <th>Действие</th>
            </tr>
          </thead>
          <tbody>
            {tickets.map((ticket) => (
              <tr key={ticket.id}>
                <td data-label="ID">{ticket.id}</td>
                <td data-label="Тема">
                  <div className="admin-table__title">{ticket.subject || "Без темы"}</div>
                  <div className="admin-table__meta">
                    {ticket.organization?.name || "Организация"} • {ticket.messagesCount || 0} сообщ.
                  </div>
                </td>
                <td data-label="Пользователь">
                  <div className="admin-table__title">{ticket.createdBy?.name || "—"}</div>
                  <div className="admin-table__meta">{ticket.createdBy?.email || "—"}</div>
                </td>
                <td data-label="Статус">
                  <span className={`admin-support__status admin-support__status--${String(ticket.status || "").toLowerCase()}`}>
                    {getStatusLabel(ticket.status)}
                  </span>
                </td>
                <td data-label="Приоритет">{getPriorityLabel(ticket.priority)}</td>
                <td data-label="Обновлено">{formatDateTime(ticket.updatedAt)}</td>
                <td data-label="Действие" className="admin-table__actions">
                  <button
                    type="button"
                    className="admin-btn admin-btn--ghost"
                    onClick={() => setSelectedTicketId(ticket.id)}
                  >
                    Открыть
                  </button>
                </td>
              </tr>
            ))}
            {!tickets.length ? (
              <tr>
                <td colSpan={7} className="admin-muted">
                  {loading ? "Загрузка..." : "Обращений пока нет."}
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

      <div className="admin-support__thread">
        {!selectedTicketId ? (
          <div className="admin-muted">Выберите обращение для просмотра переписки.</div>
        ) : (
          <>
            <div className="admin-support__thread-head">
              <div>
                <div className="admin-console__card-title" style={{ marginBottom: 4 }}>
                  {selectedTicket?.subject || "Обращение"}
                </div>
                <div className="admin-table__meta">
                  {selectedTicket?.createdBy?.name || "—"} •{" "}
                  {selectedTicket?.createdBy?.email || "—"}
                </div>
              </div>
              <button
                type="button"
                className="admin-btn admin-btn--ghost"
                onClick={() => loadThread(selectedTicketId)}
                disabled={threadLoading}
              >
                {threadLoading ? "Обновляем..." : "Обновить чат"}
              </button>
            </div>

            <div className="admin-form__row">
              <div>
                <label className="admin-label">Статус</label>
                <select
                  className="admin-select"
                  value={editStatus}
                  onChange={(event) => setEditStatus(event.target.value)}
                >
                  {STATUS_OPTIONS.filter((item) => item.value).map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="admin-label">Приоритет</label>
                <select
                  className="admin-select"
                  value={editPriority}
                  onChange={(event) => setEditPriority(event.target.value)}
                >
                  {PRIORITY_OPTIONS.filter((item) => item.value).map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="admin-table__actions">
              <button
                type="button"
                className="admin-btn admin-btn--primary"
                onClick={handleSaveMeta}
                disabled={savingMeta || !selectedTicketId}
              >
                {savingMeta ? "Сохраняем..." : "Сохранить статус и приоритет"}
              </button>
            </div>

            <div className="admin-support__messages">
              {messages.map((item) => (
                <div
                  key={item.id}
                  className={`admin-support__message ${item.isStaff ? "admin-support__message--staff" : ""}`}
                >
                  <div className="admin-support__message-head">
                    <span>{item.isStaff ? "Поддержка" : item.author?.name || "Пользователь"}</span>
                    <span>{formatDateTime(item.createdAt)}</span>
                  </div>
                  <div>{item.body}</div>
                </div>
              ))}
              {!messages.length ? (
                <div className="admin-muted">Сообщений пока нет.</div>
              ) : null}
            </div>

            <div className="admin-support__reply">
              <textarea
                className="admin-input"
                rows={3}
                maxLength={4000}
                value={replyText}
                onChange={(event) => setReplyText(event.target.value)}
                placeholder="Ответ для пользователя"
              />
              <button
                type="button"
                className="admin-btn admin-btn--primary"
                onClick={handleSendReply}
                disabled={sendingReply || !selectedTicketId}
              >
                {sendingReply ? "Отправляем..." : "Отправить ответ"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
