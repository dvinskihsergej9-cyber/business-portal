import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch, normalizeErrorMessage } from "../../apiConfig";

const STATUS_LABELS = {
  OPEN: "Открыта",
  IN_PROGRESS: "В работе",
  WAITING_USER: "Ждёт ответа",
  RESOLVED: "Решена",
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

function getCategoryLabel(value) {
  return CATEGORY_LABELS[String(value || "").trim()] || "Другое";
}

export default function AdminSupportPanel() {
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [searchInput, setSearchInput] = useState("");
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
  const [updatingStatus, setUpdatingStatus] = useState(false);

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

  useEffect(() => {
    if (!isMobile) setMobileView("list");
  }, [isMobile]);

  const buildQuery = () => {
    const params = new URLSearchParams();
    params.set("page", String(page));
    params.set("limit", String(limit));
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
  }, [authHeaders, page, search]);

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

  const handleSearch = () => {
    setSearch(searchInput.trim());
    setPage(1);
  };

  const handleOpenTicket = (ticketId) => {
    setSelectedTicketId(ticketId);
    if (isMobile) setMobileView("thread");
  };

  const handleRefreshAll = async () => {
    await loadTickets();
    if (selectedTicketId) {
      await loadThread(selectedTicketId);
    }
  };

  const handleUpdateStatus = async (nextStatus, successText) => {
    const ticketId = Number(selectedTicketId || 0);
    if (!ticketId) return;
    if (selectedTicket?.status === "RESOLVED") {
      setError("Обращение закрыто. Изменения недоступны.");
      return;
    }
    try {
      setUpdatingStatus(true);
      setError("");
      setSuccess("");
      const res = await apiFetch(`/admin/support/tickets/${ticketId}`, {
        method: "PATCH",
        headers: {
          ...authHeaders,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ status: nextStatus }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.message || "SUPPORT_TICKET_UPDATE_ERROR");
      }
      setSuccess(successText);
      await loadTickets();
      await loadThread(ticketId);
    } catch (err) {
      setError(normalizeErrorMessage(err, "Не удалось обновить статус."));
    } finally {
      setUpdatingStatus(false);
    }
  };

  const handleSendReply = async () => {
    const ticketId = Number(selectedTicketId || 0);
    const preparedReply = String(replyText || "").trim();
    if (!ticketId) return;
    if (selectedTicket?.status === "RESOLVED") {
      setError("Обращение закрыто. Отправка ответа недоступна.");
      return;
    }
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

  const selectedMessagesCount = Number(selectedTicket?.messagesCount || messages.length || 0);
  const isSelectedTicketResolved = selectedTicket?.status === "RESOLVED";

  return (
    <div className="admin-console__card admin-support-inbox">
      <div className="admin-console__card-title">Поддержка</div>
      <div className="admin-console__card-text">
        Слева список чатов, справа переписка и управление статусом проблемы.
      </div>

      {error ? <div className="admin-alert admin-alert--error">{error}</div> : null}
      {success ? <div className="admin-muted">{success}</div> : null}

      <div className="admin-support-inbox__layout">
        <section
          className={`admin-support-inbox__list-col ${isMobile && mobileView === "thread" ? "is-hidden" : ""}`}
        >
          <div className="admin-support-inbox__searchbar">
            <label className="admin-label">Поиск чатов</label>
            <div className="admin-support-inbox__searchbar-row">
              <input
                className="admin-input"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="Тема, клиент, email"
              />
              <button type="button" className="admin-btn admin-btn--primary" onClick={handleSearch}>
                Найти
              </button>
            </div>
          </div>

          <div className="admin-support-inbox__list-head">
            <div className="admin-support-inbox__list-title">Чаты</div>
            <button
              type="button"
              className="admin-btn admin-btn--ghost"
              onClick={handleRefreshAll}
              disabled={loading || threadLoading}
            >
              {loading || threadLoading ? "Обновляем..." : "Обновить"}
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
                    <span>{formatDateTime(ticket.updatedAt)}</span>
                  </div>
                </button>
              );
            })}
            {!tickets.length ? (
              <div className="admin-muted">{loading ? "Загрузка..." : "Чатов пока нет."}</div>
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
              Страница {page} из {totalPages}
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
            <div className="admin-support-inbox__empty">Выберите чат из списка слева.</div>
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
                      Назад к чатам
                    </button>
                  )}
                  <div className="admin-support-inbox__thread-title">
                    {selectedTicket?.subject || "Чат поддержки"}
                  </div>
                  <div className="admin-support-inbox__thread-subtitle">
                    {selectedTicket?.createdBy?.name || "—"} • {selectedTicket?.createdBy?.email || "—"} •{" "}
                    {selectedMessagesCount} сообщ.
                  </div>
                </div>
              </div>

              <div className="admin-support-inbox__status-actions">
                <button
                  type="button"
                  className="admin-btn admin-btn--primary"
                  onClick={() => handleUpdateStatus("RESOLVED", "Проблема помечена как закрытая.")}
                  disabled={updatingStatus || isSelectedTicketResolved}
                >
                  Проблема закрыта
                </button>
                <button
                  type="button"
                  className="admin-btn admin-btn--ghost"
                  onClick={() => handleUpdateStatus("OPEN", "Проблема снова открыта.")}
                  disabled={updatingStatus || isSelectedTicketResolved}
                >
                  Проблема не решена
                </button>
                <span className={`admin-support__status admin-support__status--${String(selectedTicket?.status || "").toLowerCase()}`}>
                  {getStatusLabel(selectedTicket?.status)}
                </span>
              </div>

              {isSelectedTicketResolved ? (
                <div className="admin-support-inbox__resolved-note">
                  Обращение закрыто. Дальнейшие действия по нему недоступны.
                </div>
              ) : null}

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
                  placeholder={
                    isSelectedTicketResolved
                      ? "Обращение закрыто. Ответ отправить нельзя."
                      : "Ответ для пользователя"
                  }
                  disabled={isSelectedTicketResolved}
                />
                <button
                  type="button"
                  className="admin-btn admin-btn--primary"
                  onClick={handleSendReply}
                  disabled={sendingReply || !selectedTicketId || isSelectedTicketResolved}
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
