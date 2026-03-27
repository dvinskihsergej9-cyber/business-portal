import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { apiFetch, normalizeErrorMessage } from "../apiConfig";
import { useAuth } from "../context/AuthContext";

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

function isMessageFromTicketCreator(message, ticket) {
  const messageAuthorId = Number(message?.author?.id || 0);
  const creatorId = Number(ticket?.createdBy?.id || 0);
  if (messageAuthorId && creatorId) {
    return messageAuthorId === creatorId;
  }
  return !Boolean(message?.isStaff);
}

export default function Support() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();

  const [subject, setSubject] = useState("");
  const [category, setCategory] = useState("TECHNICAL");
  const [message, setMessage] = useState("");
  const [isComposerOpen, setIsComposerOpen] = useState(false);
  const createInFlightRef = useRef(false);
  const [isMobile, setIsMobile] = useState(false);
  const [mobileView, setMobileView] = useState("list");

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

  const resetComposer = useCallback(() => {
    setSubject("");
    setCategory("TECHNICAL");
    setMessage("");
  }, []);

  const openComposer = useCallback(() => {
    setError("");
    setSuccess("");
    setIsComposerOpen(true);
  }, []);

  const closeComposer = useCallback(() => {
    if (creating) return;
    setIsComposerOpen(false);
  }, [creating]);

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

  const applyCreatedTicket = useCallback(
    (createdTicket, { deduped = false, recovered = false } = {}) => {
      const createdTicketId = Number(createdTicket?.id || 0);
      if (!createdTicketId) return;
      resetComposer();
      setSuccess(
        recovered
          ? "Обращение отправлено. Ответ сервера пришел с задержкой, открыли созданный чат."
          : deduped
            ? "Похожее обращение уже было создано ранее. Открыли существующий чат."
            : "Обращение отправлено. Мы ответим в этом чате."
      );
      setIsComposerOpen(false);
      setSelectedTicketId(createdTicketId);
      if (isMobile) setMobileView("thread");
      setSelectedTicket(createdTicket);
      setMessages(createdTicket?.lastMessage ? [createdTicket.lastMessage] : []);
      setTickets((prev) => {
        const next = prev.filter((item) => Number(item.id) !== createdTicketId);
        return [createdTicket, ...next];
      });
    },
    [isMobile, resetComposer]
  );

  const recoverCreatedTicketAfterError = useCallback(
    async ({ subject: requestedSubject, message: requestedMessage, category: requestedCategory, requestStartedAt }) => {
      try {
        const res = await apiFetch("/support/tickets/my", {
          headers: authHeaders,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) return null;
        const items = Array.isArray(data?.items) ? data.items : [];
        const windowStart = Number(requestStartedAt || Date.now()) - 120_000;
        const normalizedSubject = String(requestedSubject || "").trim().toLowerCase();
        const normalizedMessage = String(requestedMessage || "").trim().toLowerCase();
        const normalizedCategory = String(requestedCategory || "")
          .trim()
          .toUpperCase();
        return (
          items.find((item) => {
            const activityAt = new Date(item?.lastMessageAt || item?.updatedAt || item?.createdAt || 0).getTime();
            if (!Number.isFinite(activityAt) || activityAt < windowStart) return false;
            const itemSubject = String(item?.subject || "")
              .trim()
              .toLowerCase();
            const itemCategory = String(item?.category || "")
              .trim()
              .toUpperCase();
            const itemLastBody = String(item?.lastMessage?.body || "")
              .trim()
              .toLowerCase();
            return (
              itemSubject === normalizedSubject &&
              itemCategory === normalizedCategory &&
              itemLastBody === normalizedMessage
            );
          }) || null
        );
      } catch {
        return null;
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
    const media = window.matchMedia("(max-width: 980px)");
    const onChange = () => setIsMobile(media.matches);
    onChange();
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    if (!isMobile) setMobileView("list");
  }, [isMobile]);

  const handleCreateTicket = async (event) => {
    event.preventDefault();
    if (createInFlightRef.current || creating) {
      return;
    }
    const preparedSubject = String(subject || "").trim();
    const preparedMessage = String(message || "").trim();
    const preparedCategory = String(category || "OTHER")
      .trim()
      .toUpperCase();
    const requestStartedAt = Date.now();
    if (!preparedSubject) {
      setError("Укажите тему обращения.");
      return;
    }
    if (!preparedMessage) {
      setError("Опишите проблему в сообщении.");
      return;
    }

    try {
      createInFlightRef.current = true;
      setCreating(true);
      setError("");
      setSuccess("");
      const res = await apiFetch("/support/tickets", {
        method: "POST",
        timeoutMs: 45_000,
        suppressGlobalError: true,
        headers: {
          ...authHeaders,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          subject: preparedSubject,
          category: preparedCategory,
          message: preparedMessage,
          currentPath: `${location.pathname}${location.search || ""}`,
        }),
      });
      const data = await res.json().catch(() => ({}));
      const createdTicket = data?.ticket || null;
      if (!res.ok && !createdTicket) {
        throw new Error(data?.message || "SUPPORT_TICKET_CREATE_ERROR");
      }
      if (!createdTicket) {
        throw new Error("SUPPORT_TICKET_CREATE_ERROR");
      }
      applyCreatedTicket(createdTicket, { deduped: Boolean(data?.deduped) });
    } catch (err) {
      const recoveredTicket = await recoverCreatedTicketAfterError({
        subject: preparedSubject,
        message: preparedMessage,
        category: preparedCategory,
        requestStartedAt,
      });
      if (recoveredTicket) {
        applyCreatedTicket(recoveredTicket, { recovered: true });
        return;
      }
      setError(normalizeErrorMessage(err, "Не удалось отправить обращение."));
    } finally {
      createInFlightRef.current = false;
      setCreating(false);
    }
  };

  const handleSendReply = async () => {
    const ticketId = Number(selectedTicketId || 0);
    const preparedReply = String(replyText || "").trim();
    let optimisticId = "";
    if (!ticketId) return;
    if (selectedTicket?.status === "RESOLVED") {
      setError("Обращение уже закрыто. Создайте новое через кнопку + Новое.");
      return;
    }
    if (!preparedReply) {
      setError("Введите сообщение для поддержки.");
      return;
    }

    try {
      setSendingReply(true);
      setError("");
      setSuccess("");
      optimisticId = `tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const optimisticCreatedAt = new Date().toISOString();
      const optimisticMessage = {
        id: optimisticId,
        body: preparedReply,
        isStaff: false,
        createdAt: optimisticCreatedAt,
        updatedAt: optimisticCreatedAt,
        author: null,
        pending: true,
      };
      setReplyText("");
      setMessages((prev) => [...prev, optimisticMessage]);

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
      const createdMessage = data?.message || null;
      const ticketStatus = data?.ticketStatus || selectedTicket?.status || "OPEN";
      if (createdMessage) {
        setMessages((prev) =>
          prev.map((item) => (String(item.id) === optimisticId ? createdMessage : item))
        );
        setSelectedTicket((prev) =>
          prev
            ? {
                ...prev,
                status: ticketStatus,
                messagesCount: Number(prev.messagesCount || 0) + 1,
                lastMessageAt: createdMessage.createdAt || prev.lastMessageAt,
                lastMessage: createdMessage,
              }
            : prev
        );
        setTickets((prev) => {
          const current = prev.find((item) => Number(item.id) === ticketId);
          const updated = current
            ? {
                ...current,
                status: ticketStatus,
                messagesCount: Number(current.messagesCount || 0) + 1,
                lastMessageAt: createdMessage.createdAt || current.lastMessageAt,
                lastMessage: createdMessage,
              }
            : null;
          const rest = prev.filter((item) => Number(item.id) !== ticketId);
          return updated ? [updated, ...rest] : prev;
        });
      } else {
        setMessages((prev) => prev.filter((item) => String(item.id) !== optimisticId));
        await Promise.all([loadTickets(), loadThread(ticketId)]);
      }
    } catch (err) {
      setReplyText(preparedReply);
      setMessages((prev) =>
        prev.filter((item) => String(item.id) !== optimisticId)
      );
      setError(normalizeErrorMessage(err, "Не удалось отправить сообщение."));
    } finally {
      setSendingReply(false);
    }
  };

  const handleRefreshAll = async () => {
    await loadTickets();
    if (selectedTicketId) {
      await loadThread(selectedTicketId);
    }
  };

  const handleOpenTicket = (ticketId) => {
    setSelectedTicketId(ticketId);
    if (isMobile) {
      setMobileView("thread");
    }
  };

  const isSelectedTicketResolved = selectedTicket?.status === "RESOLVED";
  const canUseSupport = Boolean(
    user?.role === "ADMIN" && user?.isSystemOwner !== true
  );

  if (!canUseSupport) {
    return <Navigate to="/403" replace />;
  }

  return (
    <div className="page support-page">
      <div className="page-header support-page__header">
        <div>
          <h1 className="page-title">Поддержка</h1>
          <p className="page-subtitle">
            Слева список обращений, справа чат по выбранному обращению.
          </p>
        </div>
        <button type="button" className="btn support-page__back-btn" onClick={() => navigate(-1)}>
          Назад
        </button>
      </div>

      {error ? <div className="alert alert--error support-page__alert">{error}</div> : null}
      {success ? <div className="alert support-page__alert">{success}</div> : null}

      <section className="card support-page__card support-page__card--workspace">
        <div className="support-page__tickets-head">
          <div className="support-page__section-title">Чаты</div>
          <div className="support-page__head-actions">
            <button type="button" className="btn primary support-page__action-btn" onClick={openComposer}>
              + Новое
            </button>
            <button
              type="button"
              className="btn primary support-page__action-btn"
              onClick={handleRefreshAll}
              disabled={ticketsLoading || threadLoading}
            >
              {ticketsLoading || threadLoading ? "Обновляем..." : "Обновить"}
            </button>
          </div>
        </div>

        <div className="support-page__layout">
          <div className={`support-page__tickets ${isMobile && mobileView === "thread" ? "is-hidden" : ""}`}>
            {!tickets.length ? (
              <div className="support-page__empty">
                Чатов пока нет. Нажмите + Новое, чтобы создать первое обращение.
              </div>
            ) : (
              tickets.map((ticket) => {
                const isActive = Number(ticket.id) === Number(selectedTicketId);
                return (
                  <button
                    key={ticket.id}
                    type="button"
                    className={`support-page__ticket ${isActive ? "is-active" : ""}`}
                    onClick={() => handleOpenTicket(ticket.id)}
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
              })
            )}
          </div>

          <div className={`support-page__thread ${isMobile && mobileView === "list" ? "is-hidden" : ""}`}>
            {!selectedTicketId ? (
              <div className="support-page__empty">Выберите обращение из списка слева.</div>
            ) : (
              <>
                <div className="support-page__thread-head">
                  <div>
                    {isMobile ? (
                      <button
                        type="button"
                        className="btn support-page__mobile-back"
                        onClick={() => setMobileView("list")}
                      >
                        Назад к чатам
                      </button>
                    ) : null}
                    <div className="support-page__thread-title">
                      {selectedTicket?.subject || "Обращение"}
                    </div>
                    <div className="support-page__thread-meta">
                      Статус: {getStatusLabel(selectedTicket?.status)} • Сообщений:{" "}
                      {Number(selectedTicket?.messagesCount || messages.length || 0)}
                    </div>
                  </div>
                </div>

                <div className="support-page__messages">
                  {messages.map((item) => {
                    const isSelfMessage = isMessageFromTicketCreator(item, selectedTicket);
                    return (
                      <div
                        key={item.id}
                        className={`support-page__message ${
                          isSelfMessage ? "support-page__message--self" : "support-page__message--peer"
                        } ${item.pending ? "support-page__message--pending" : ""}`}
                      >
                        <div className="support-page__message-head">
                          <span>{isSelfMessage ? "(Вы)" : "(Поддержка)"}</span>
                          <span>{formatDateTime(item.createdAt)}</span>
                        </div>
                        <div className="support-page__message-body">{item.body}</div>
                      </div>
                    );
                  })}
                  {!messages.length ? (
                    <div className="support-page__empty">Сообщений пока нет.</div>
                  ) : null}
                </div>

                {isSelectedTicketResolved ? (
                  <div className="support-page__resolved-note">
                    Это обращение закрыто. Чтобы продолжить, создайте новое через кнопку + Новое.
                  </div>
                ) : null}

                <div className="support-page__reply">
                  <textarea
                    value={replyText}
                    onChange={(event) => setReplyText(event.target.value)}
                    rows={3}
                    maxLength={4000}
                    placeholder={
                      isSelectedTicketResolved
                        ? "Чат закрыт. Создайте новое обращение."
                        : "Напишите сообщение поддержке"
                    }
                    disabled={isSelectedTicketResolved}
                  />
                  <button
                    type="button"
                    className="btn primary"
                    onClick={handleSendReply}
                    disabled={sendingReply || !selectedTicketId || isSelectedTicketResolved}
                  >
                    {sendingReply ? "Отправляем..." : "Отправить"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </section>

      {isComposerOpen ? (
        <div className="support-page__modal-backdrop" onClick={closeComposer}>
          <div className="support-page__modal card" onClick={(event) => event.stopPropagation()}>
            <div className="support-page__modal-head">
              <div className="support-page__section-title">Новое обращение</div>
              <button type="button" className="btn support-page__modal-close" onClick={closeComposer} disabled={creating}>
                Закрыть
              </button>
            </div>

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
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
