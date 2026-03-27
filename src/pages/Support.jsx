import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { apiFetch, normalizeErrorMessage } from "../apiConfig";

const CATEGORY_OPTIONS = [
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

function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("ru-RU");
}

function getCategoryLabel(value) {
  const option = CATEGORY_OPTIONS.find((item) => item.value === String(value || ""));
  return option?.label || "Другое";
}

function getStatusLabel(value) {
  return STATUS_LABELS[String(value || "").trim()] || "Открыта";
}

function messageAuthorLabel(message) {
  if (message?.isStaff) return "Поддержка";
  const authorName = String(message?.author?.name || "").trim();
  return authorName || "Вы";
}

export default function Support() {
  const navigate = useNavigate();
  const location = useLocation();
  const [subject, setSubject] = useState("");
  const [category, setCategory] = useState("TECHNICAL");
  const [message, setMessage] = useState("");

  const [tickets, setTickets] = useState([]);
  const [ticketsLoading, setTicketsLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [threadLoading, setThreadLoading] = useState(false);
  const [sendingReply, setSendingReply] = useState(false);

  const [selectedTicketId, setSelectedTicketId] = useState(null);
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [messages, setMessages] = useState([]);
  const [replyText, setReplyText] = useState("");

  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const authHeaders = useMemo(
    () => ({
      Authorization: `Bearer ${localStorage.getItem("token") || ""}`,
    }),
    []
  );

  const loadTickets = useCallback(async () => {
    try {
      setTicketsLoading(true);
      setError("");
      const res = await apiFetch("/support/tickets/my", {
        headers: authHeaders,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.message || "SUPPORT_TICKETS_LIST_ERROR");
      }
      const nextItems = Array.isArray(data?.items) ? data.items : [];
      setTickets(nextItems);
      setSelectedTicketId((prev) => {
        if (!nextItems.length) return null;
        if (!prev || !nextItems.some((item) => item.id === prev)) {
          return nextItems[0].id;
        }
        return prev;
      });
    } catch (err) {
      setError(normalizeErrorMessage(err, "Не удалось загрузить обращения."));
    } finally {
      setTicketsLoading(false);
    }
  }, [authHeaders]);

  const loadThread = useCallback(
    async (ticketId) => {
      const normalizedId = Number(ticketId || 0);
      if (!normalizedId) return;
      try {
        setThreadLoading(true);
        setError("");
        const res = await apiFetch(`/support/tickets/${normalizedId}/messages`, {
          headers: authHeaders,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data?.message || "SUPPORT_TICKET_MESSAGES_ERROR");
        }
        setSelectedTicket(data?.ticket || null);
        setMessages(Array.isArray(data?.messages) ? data.messages : []);
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

  const handleCreateTicket = async (event) => {
    event.preventDefault();
    const preparedSubject = String(subject || "").trim();
    const preparedMessage = String(message || "").trim();
    if (!preparedSubject) {
      setError("Укажите тему обращения.");
      return;
    }
    if (!preparedMessage) {
      setError("Опишите проблему в сообщении.");
      return;
    }

    try {
      setCreating(true);
      setError("");
      setSuccess("");
      const res = await apiFetch("/support/tickets", {
        method: "POST",
        headers: {
          ...authHeaders,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          subject: preparedSubject,
          category,
          message: preparedMessage,
          currentPath: `${location.pathname}${location.search || ""}`,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.message || "SUPPORT_TICKET_CREATE_ERROR");
      }
      const createdTicketId = Number(data?.ticket?.id || 0);
      setSubject("");
      setMessage("");
      setSuccess("Обращение отправлено. Мы ответим в этом чате.");
      await loadTickets();
      if (createdTicketId) {
        setSelectedTicketId(createdTicketId);
        await loadThread(createdTicketId);
      }
    } catch (err) {
      setError(normalizeErrorMessage(err, "Не удалось отправить обращение."));
    } finally {
      setCreating(false);
    }
  };

  const handleSendReply = async () => {
    const ticketId = Number(selectedTicketId || 0);
    const preparedReply = String(replyText || "").trim();
    if (!ticketId) return;
    if (!preparedReply) {
      setError("Введите сообщение для поддержки.");
      return;
    }

    try {
      setSendingReply(true);
      setError("");
      setSuccess("");
      const res = await apiFetch(`/support/tickets/${ticketId}/messages`, {
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
      await loadTickets();
      await loadThread(ticketId);
    } catch (err) {
      setError(normalizeErrorMessage(err, "Не удалось отправить сообщение."));
    } finally {
      setSendingReply(false);
    }
  };

  return (
    <div className="page support-page">
      <div className="page-header support-page__header">
        <div>
          <h1 className="page-title">Поддержка</h1>
          <p className="page-subtitle">
            Создайте обращение и ведите переписку с командой поддержки в одном месте.
          </p>
        </div>
        <button type="button" className="btn support-page__back-btn" onClick={() => navigate(-1)}>
          Назад
        </button>
      </div>

      <section className="card support-page__card">
        <div className="support-page__section-title">Новое обращение</div>
        <form className="support-page__form" onSubmit={handleCreateTicket}>
          <label className="support-page__field">
            <span>Тема</span>
            <input
              type="text"
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              maxLength={160}
              placeholder="Коротко опишите проблему"
            />
          </label>

          <label className="support-page__field">
            <span>Категория</span>
            <select value={category} onChange={(event) => setCategory(event.target.value)}>
              {CATEGORY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="support-page__field">
            <span>Сообщение</span>
            <textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              maxLength={4000}
              rows={4}
              placeholder="Опишите проблему, что ожидали и что произошло"
            />
          </label>

          <div className="support-page__actions">
            <button type="submit" className="btn primary" disabled={creating}>
              {creating ? "Отправляем..." : "Отправить обращение"}
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                setSubject("");
                setCategory("TECHNICAL");
                setMessage("");
                setError("");
                setSuccess("");
              }}
              disabled={creating}
            >
              Очистить
            </button>
          </div>
        </form>
      </section>

      {error ? <div className="alert alert--error support-page__alert">{error}</div> : null}
      {success ? <div className="alert support-page__alert">{success}</div> : null}

      <section className="card support-page__card">
        <div className="support-page__tickets-head">
          <div className="support-page__section-title">Мои обращения</div>
          <button type="button" className="btn" onClick={loadTickets} disabled={ticketsLoading}>
            {ticketsLoading ? "Обновляем..." : "Обновить список"}
          </button>
        </div>

        {!tickets.length ? (
          <div className="support-page__empty">Пока нет обращений. Создайте первое выше.</div>
        ) : (
          <div className="support-page__layout">
            <div className="support-page__tickets">
              {tickets.map((ticket) => {
                const isActive = Number(ticket.id) === Number(selectedTicketId);
                return (
                  <button
                    key={ticket.id}
                    type="button"
                    className={`support-page__ticket ${isActive ? "is-active" : ""}`}
                    onClick={() => setSelectedTicketId(ticket.id)}
                  >
                    <div className="support-page__ticket-title-row">
                      <div className="support-page__ticket-title">{ticket.subject || "Без темы"}</div>
                      <span className={`support-page__status support-page__status--${String(ticket.status || "").toLowerCase()}`}>
                        {getStatusLabel(ticket.status)}
                      </span>
                    </div>
                    <div className="support-page__ticket-meta">
                      <span>{getCategoryLabel(ticket.category)}</span>
                      <span>{formatDateTime(ticket.lastMessageAt || ticket.updatedAt)}</span>
                    </div>
                    {ticket.lastMessage?.body ? (
                      <div className="support-page__ticket-preview">{ticket.lastMessage.body}</div>
                    ) : null}
                  </button>
                );
              })}
            </div>

            <div className="support-page__thread">
              {!selectedTicketId ? (
                <div className="support-page__empty">Выберите обращение из списка.</div>
              ) : (
                <>
                  <div className="support-page__thread-head">
                    <div>
                      <div className="support-page__thread-title">
                        {selectedTicket?.subject || "Обращение"}
                      </div>
                      <div className="support-page__thread-meta">
                        Статус: {getStatusLabel(selectedTicket?.status)} • Сообщений:{" "}
                        {Number(selectedTicket?.messagesCount || messages.length || 0)}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => loadThread(selectedTicketId)}
                      disabled={threadLoading}
                    >
                      {threadLoading ? "Обновляем..." : "Обновить чат"}
                    </button>
                  </div>

                  <div className="support-page__messages">
                    {messages.map((item) => (
                      <div
                        key={item.id}
                        className={`support-page__message ${item.isStaff ? "support-page__message--staff" : ""}`}
                      >
                        <div className="support-page__message-head">
                          <span>{messageAuthorLabel(item)}</span>
                          <span>{formatDateTime(item.createdAt)}</span>
                        </div>
                        <div className="support-page__message-body">{item.body}</div>
                      </div>
                    ))}
                    {!messages.length ? (
                      <div className="support-page__empty">Сообщений пока нет.</div>
                    ) : null}
                  </div>

                  <div className="support-page__reply">
                    <textarea
                      value={replyText}
                      onChange={(event) => setReplyText(event.target.value)}
                      rows={3}
                      maxLength={4000}
                      placeholder="Ответьте в обращении"
                    />
                    <button
                      type="button"
                      className="btn primary"
                      onClick={handleSendReply}
                      disabled={sendingReply || !selectedTicketId}
                    >
                      {sendingReply ? "Отправляем..." : "Отправить"}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
