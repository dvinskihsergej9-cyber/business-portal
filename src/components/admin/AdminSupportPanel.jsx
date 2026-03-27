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

const CATEGORY_LABELS = {
  ACCESS: "Доступ и права",
  BILLING: "Оплата и тарифы",
  TECHNICAL: "Техническая ошибка",
  INTEGRATION: "Интеграции",
  OTHER: "Другое",
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

function getCategoryLabel(value) {
  return CATEGORY_LABELS[String(value || "").trim()] || "Другое";
}

export default function AdminSupportPanel() {
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [searchInput, setSearchInput] = useState("");
  const [statusInput, setStatusInput] = useState("");
  const [priorityInput, setPriorityInput] = useState("");
  const [categoryInput, setCategoryInput] = useState("");

  const [filters, setFilters] = useState({
    search: "",
    status: "",
    priority: "",
    category: "",
  });
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

  const [isMobile, setIsMobile] = useState(false);
  const [mobileView, setMobileView] = useState("list");

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

  useEffect(() => {
    const media = window.matchMedia("(max-width: 900px)");
    const onChange = () => setIsMobile(media.matches);
    onChange();
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  const buildQuery = () => {
    const params = new URLSearchParams();
    params.set("page", String(page));
    params.set("limit", String(limit));
    if (filters.status) params.set("status", filters.status);
    if (filters.priority) params.set("priority", filters.priority);
    if (filters.category) params.set("category", filters.category);
    if (filters.search.trim()) params.set("search", filters.search.trim());
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
  }, [authHeaders, filters, page]);

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

  useEffect(() => {
    if (!isMobile) {
      setMobileView("list");
    }
  }, [isMobile]);

  const handleApplyFilters = () => {
    setFilters({
      search: searchInput,
      status: statusInput,
      priority: priorityInput,
      category: categoryInput,
    });
    setPage(1);
  };

  const handleResetFilters = () => {
    setSearchInput("");
    setStatusInput("");
    setPriorityInput("");
    setCategoryInput("");
    setFilters({
      search: "",
      status: "",
      priority: "",
      category: "",
    });
    setPage(1);
  };

  const handleOpenTicket = (ticketId) => {
    setSelectedTicketId(ticketId);
    if (isMobile) setMobileView("thread");
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

  const selectedMessagesCount = Number(selectedTicket?.messagesCount || messages.length || 0);

  return (
    <div className="admin-console__card admin-support-inbox">
      <div className="admin-console__card-title">Поддержка</div>
      <div className="admin-console__card-text">
        Очередь обращений сотрудников и единый чат по каждому тикету.
      </div>

      {error ? <div className="admin-alert admin-alert--error">{error}</div> : null}
      {success ? <div className="admin-muted">{success}</div> : null}

      <div className="admin-support-inbox__layout">
        <section
          className={`admin-support-inbox__list-col ${isMobile && mobileView === "thread" ? "is-hidden" : ""}`}
        >
          <div className="admin-support-inbox__filters">
            <div className="admin-support-inbox__search">
              <label className="admin-label">Поиск</label>
              <input
                className="admin-input"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="Тема, клиент, email"
              />
            </div>
            <div>
              <label className="admin-label">Статус</label>
              <select
                className="admin-select"
                value={statusInput}
                onChange={(event) => setStatusInput(event.target.value)}
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
                value={priorityInput}
                onChange={(event) => setPriorityInput(event.target.value)}
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
                value={categoryInput}
                onChange={(event) => setCategoryInput(event.target.value)}
              >
                {CATEGORY_OPTIONS.map((item) => (
                  <option key={item.value || "all-category"} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="admin-support-inbox__filter-actions">
              <button
                type="button"
                className="admin-btn admin-btn--primary"
                onClick={handleApplyFilters}
              >
                Применить
              </button>
              <button
                type="button"
                className="admin-btn admin-btn--ghost"
                onClick={handleResetFilters}
              >
                Сбросить
              </button>
            </div>
          </div>

          <div className="admin-support-inbox__list-head">
            <div className="admin-support-inbox__list-title">Обращения</div>
            <button
              type="button"
              className="admin-btn admin-btn--ghost"
              onClick={loadTickets}
              disabled={loading}
            >
              {loading ? "Обновляем..." : "Обновить"}
            </button>
          </div>

          <div className="admin-support-inbox__list">
            {tickets.map((ticket) => {
              const isActive = Number(ticket.id) === Number(selectedTicketId);
              return (
                <button
                  key={ticket.id}
                  type="button"
                  className={`admin-support-inbox__ticket ${isActive ? "is-active" : ""}`}
                  onClick={() => handleOpenTicket(ticket.id)}
                >
                  <div className="admin-support-inbox__ticket-head">
                    <div className="admin-support-inbox__ticket-id">#{ticket.id}</div>
                    <span className={`admin-support__status admin-support__status--${String(ticket.status || "").toLowerCase()}`}>
                      {getStatusLabel(ticket.status)}
                    </span>
                  </div>
                  <div className="admin-support-inbox__ticket-subject">{ticket.subject || "Без темы"}</div>
                  <div className="admin-support-inbox__ticket-meta">
                    <span>{ticket.organization?.name || "Организация"}</span>
                    <span>{ticket.createdBy?.name || "—"}</span>
                  </div>
                  <div className="admin-support-inbox__ticket-meta">
                    <span>{getCategoryLabel(ticket.category)}</span>
                    <span>{getPriorityLabel(ticket.priority)}</span>
                    <span>{formatDateTime(ticket.updatedAt)}</span>
                  </div>
                </button>
              );
            })}
            {!tickets.length ? (
              <div className="admin-muted">
                {loading ? "Загрузка..." : "Обращений пока нет."}
              </div>
            ) : null}
          </div>

          <div className="admin-support-inbox__pager">
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
              Вперёд
            </button>
          </div>
        </section>

        <section
          className={`admin-support-inbox__thread-col ${isMobile && mobileView === "list" ? "is-hidden" : ""}`}
        >
          {!selectedTicketId ? (
            <div className="admin-support-inbox__empty">
              Выберите обращение из списка слева.
            </div>
          ) : (
            <>
              <div className="admin-support-inbox__thread-head">
                <div className="admin-support-inbox__thread-title-wrap">
                  {isMobile && (
                    <button
                      type="button"
                      className="admin-btn admin-btn--ghost"
                      onClick={() => setMobileView("list")}
                    >
                      Назад к списку
                    </button>
                  )}
                  <div className="admin-support-inbox__thread-title">
                    {selectedTicket?.subject || "Обращение"}
                  </div>
                  <div className="admin-support-inbox__thread-subtitle">
                    {selectedTicket?.createdBy?.name || "—"} • {selectedTicket?.createdBy?.email || "—"} •{" "}
                    {selectedMessagesCount} сообщ.
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

              <div className="admin-support-inbox__thread-controls">
                <label className="admin-support-inbox__control">
                  <span className="admin-label">Статус</span>
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
                </label>
                <label className="admin-support-inbox__control">
                  <span className="admin-label">Приоритет</span>
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
                </label>
                <button
                  type="button"
                  className="admin-btn admin-btn--primary"
                  onClick={handleSaveMeta}
                  disabled={savingMeta || !selectedTicketId}
                >
                  {savingMeta ? "Сохраняем..." : "Сохранить"}
                </button>
              </div>

              <div className="admin-support-inbox__messages">
                {messages.map((item) => (
                  <div
                    key={item.id}
                    className={`admin-support-inbox__message ${item.isStaff ? "is-staff" : "is-user"}`}
                  >
                    <div className="admin-support-inbox__message-head">
                      <span>{item.isStaff ? "Поддержка" : item.author?.name || "Пользователь"}</span>
                      <span>{formatDateTime(item.createdAt)}</span>
                    </div>
                    <div className="admin-support-inbox__message-body">{item.body}</div>
                  </div>
                ))}
                {!messages.length ? <div className="admin-muted">Сообщений пока нет.</div> : null}
              </div>

              <div className="admin-support-inbox__reply">
                <textarea
                  className="admin-input"
                  rows={4}
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
        </section>
      </div>
    </div>
  );
}
