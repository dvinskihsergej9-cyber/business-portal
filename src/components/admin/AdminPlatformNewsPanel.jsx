import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch, normalizeErrorMessage } from "../../apiConfig";

const PRIORITY_OPTIONS = [
  { value: "LOW", label: "Низкий" },
  { value: "NORMAL", label: "Обычный" },
  { value: "HIGH", label: "Высокий" },
];

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("ru-RU");
}

function priorityLabel(value) {
  const found = PRIORITY_OPTIONS.find((item) => item.value === String(value || "").trim());
  return found?.label || "Обычный";
}

export default function AdminPlatformNewsPanel() {
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [priority, setPriority] = useState("NORMAL");
  const [editingId, setEditingId] = useState(null);

  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const limit = 20;

  const totalPages = useMemo(() => Math.max(1, Math.ceil((Number(total) || 0) / limit)), [total]);

  const resetForm = useCallback(() => {
    setTitle("");
    setMessage("");
    setPriority("NORMAL");
    setEditingId(null);
  }, []);

  const loadHistory = useCallback(async () => {
    try {
      setLoading(true);
      setError("");

      const res = await apiFetch(`/admin/platform-news/history?page=${page}&limit=${limit}`, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem("token") || ""}`,
        },
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.message || "Не удалось загрузить историю новостей.");
      }

      setItems(Array.isArray(data?.items) ? data.items : []);
      setTotal(Number(data?.total) || 0);
    } catch (err) {
      setError(normalizeErrorMessage(err, "Не удалось загрузить историю новостей."));
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const handleSave = async () => {
    try {
      const preparedTitle = String(title || "").trim();
      const preparedMessage = String(message || "").trim();
      if (!preparedTitle) {
        setError("Введите заголовок новости.");
        return;
      }
      if (!preparedMessage) {
        setError("Введите текст новости.");
        return;
      }

      setSending(true);
      setError("");
      setSuccess("");

      const endpoint = editingId ? `/admin/platform-news/${editingId}` : "/admin/platform-news/publish";
      const method = editingId ? "PUT" : "POST";

      const res = await apiFetch(endpoint, {
        method,
        headers: {
          Authorization: `Bearer ${localStorage.getItem("token") || ""}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: preparedTitle,
          message: preparedMessage,
          priority,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          data?.message || (editingId ? "Не удалось обновить новость." : "Не удалось отправить новость.")
        );
      }

      if (editingId) {
        setSuccess("Новость обновлена.");
      } else {
        const sentCount = Number(data?.sentCount || 0);
        const totalRecipients = Number(data?.totalRecipients || 0);
        const failedCount = Number(data?.failedCount || 0);
        const warningText = String(data?.warning || "").trim();

        setSuccess(
          warningText ||
            `Новость отправлена: ${sentCount} из ${totalRecipients}.` +
              (failedCount > 0 ? ` Ошибок: ${failedCount}.` : "")
        );
      }

      resetForm();
      setPage(1);
      await loadHistory();
    } catch (err) {
      setError(
        normalizeErrorMessage(
          err,
          editingId ? "Не удалось обновить новость." : "Не удалось отправить новость."
        )
      );
    } finally {
      setSending(false);
    }
  };

  const handleStartEdit = useCallback((item) => {
    const itemId = Number(item?.id || 0);
    if (!itemId) return;
    setEditingId(itemId);
    setTitle(String(item?.title || ""));
    setMessage(String(item?.message || ""));
    setPriority(String(item?.priority || "NORMAL"));
    setError("");
    setSuccess("");
  }, []);

  const handleDelete = useCallback(
    async (item) => {
      const itemId = Number(item?.id || 0);
      if (!itemId) return;
      const confirmed = window.confirm("Удалить опубликованную новость?");
      if (!confirmed) return;

      try {
        setDeletingId(itemId);
        setError("");
        setSuccess("");

        const res = await apiFetch(`/admin/platform-news/${itemId}`, {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${localStorage.getItem("token") || ""}`,
          },
        });

        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data?.message || "Не удалось удалить новость.");
        }

        if (editingId === itemId) {
          resetForm();
        }

        setSuccess("Новость удалена.");
        await loadHistory();
      } catch (err) {
        setError(normalizeErrorMessage(err, "Не удалось удалить новость."));
      } finally {
        setDeletingId(null);
      }
    },
    [editingId, loadHistory, resetForm]
  );

  return (
    <div className="admin-console__card admin-panel">
      <div className="admin-console__card-title">Новости платформы</div>
      <div className="admin-console__card-text">
        Рассылка общих уведомлений владельцам компаний через колокольчик и push.
      </div>

      <div className="admin-form" style={{ marginTop: 14 }}>
        <div>
          <label className="admin-label">Заголовок</label>
          <input
            className="admin-input"
            value={title}
            maxLength={140}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Например: Плановое обновление платформы"
          />
        </div>

        <div>
          <label className="admin-label">Текст новости</label>
          <textarea
            className="admin-input"
            value={message}
            maxLength={4000}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="Напишите текст уведомления для владельцев компаний"
            rows={5}
          />
        </div>

        <div className="admin-form__row">
          <div>
            <label className="admin-label">Приоритет</label>
            <select
              className="admin-input"
              value={priority}
              onChange={(event) => setPriority(event.target.value)}
            >
              {PRIORITY_OPTIONS.map((item) => (
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
            onClick={handleSave}
            disabled={sending}
          >
            {sending ? "Сохранение..." : editingId ? "Сохранить изменения" : "Опубликовать и отправить"}
          </button>
          <button
            type="button"
            className="admin-btn admin-btn--ghost"
            onClick={() => {
              resetForm();
              setError("");
              setSuccess("");
            }}
            disabled={sending}
          >
            {editingId ? "Отменить редактирование" : "Очистить"}
          </button>
        </div>
      </div>

      {error ? <div className="admin-alert admin-alert--error">{error}</div> : null}
      {success ? <div className="admin-muted">{success}</div> : null}

      <div className="admin-console__card-title admin-panel__section-title">История рассылок</div>
      {loading ? <div className="admin-muted">Загрузка...</div> : null}

      <div className="admin-table-wrapper" style={{ marginTop: 10 }}>
        <table className="admin-table">
          <thead>
            <tr>
              <th>Дата</th>
              <th>Заголовок</th>
              <th>Приоритет</th>
              <th>Получатели</th>
              <th>Действия</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td data-label="Дата">{formatDateTime(item.createdAt)}</td>
                <td data-label="Заголовок">
                  <div className="admin-table__title">{item.title || "-"}</div>
                  <div className="admin-table__meta">{item.message || "-"}</div>
                </td>
                <td data-label="Приоритет">{priorityLabel(item.priority)}</td>
                <td data-label="Получатели">
                  {Number(item.sentCount || 0)} / {Number(item.totalRecipients || 0)}
                  {Number(item.failedCount || 0) > 0 ? ` (ошибок: ${item.failedCount})` : ""}
                </td>
                <td data-label="Действия">
                  <div className="admin-table__actions" style={{ margin: 0 }}>
                    <button
                      type="button"
                      className="admin-btn admin-btn--ghost"
                      onClick={() => handleStartEdit(item)}
                      disabled={sending || deletingId === item.id}
                    >
                      Редактировать
                    </button>
                    <button
                      type="button"
                      className="admin-btn admin-btn--danger"
                      onClick={() => handleDelete(item)}
                      disabled={sending || deletingId === item.id}
                    >
                      {deletingId === item.id ? "Удаление..." : "Удалить"}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {!items.length ? (
              <tr>
                <td colSpan={5} className="admin-muted">
                  Рассылок пока нет.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="admin-panel__pager">
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
    </div>
  );
}
