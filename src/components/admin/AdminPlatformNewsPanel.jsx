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

  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const limit = 20;

  const totalPages = useMemo(() => Math.max(1, Math.ceil((Number(total) || 0) / limit)), [total]);

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

  const handlePublish = async () => {
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

      const res = await apiFetch("/admin/platform-news/publish", {
        method: "POST",
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
        throw new Error(data?.message || "Не удалось отправить новость.");
      }

      const sentCount = Number(data?.sentCount || 0);
      const totalRecipients = Number(data?.totalRecipients || 0);
      const failedCount = Number(data?.failedCount || 0);
      const warningText = String(data?.warning || "").trim();

      setSuccess(
        warningText ||
          `Новость отправлена: ${sentCount} из ${totalRecipients}.` +
            (failedCount > 0 ? ` Ошибок: ${failedCount}.` : "")
      );

      setPage(1);
      await loadHistory();
    } catch (err) {
      setError(normalizeErrorMessage(err, "Не удалось отправить новость."));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="admin-console__card">
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
            onClick={handlePublish}
            disabled={sending}
          >
            {sending ? "Отправка..." : "Опубликовать и отправить"}
          </button>
          <button
            type="button"
            className="admin-btn admin-btn--ghost"
            onClick={() => {
              setTitle("");
              setMessage("");
              setPriority("NORMAL");
              setError("");
              setSuccess("");
            }}
            disabled={sending}
          >
            Очистить
          </button>
        </div>
      </div>

      {error ? <div className="admin-alert admin-alert--error">{error}</div> : null}
      {success ? <div className="admin-muted">{success}</div> : null}

      <div className="admin-console__card-title" style={{ marginTop: 18 }}>
        История рассылок
      </div>
      {loading ? <div className="admin-muted">Загрузка...</div> : null}

      <div className="admin-table-wrapper" style={{ marginTop: 10 }}>
        <table className="admin-table">
          <thead>
            <tr>
              <th>Дата</th>
              <th>Заголовок</th>
              <th>Приоритет</th>
              <th>Получатели</th>
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
              </tr>
            ))}
            {!items.length ? (
              <tr>
                <td colSpan={4} className="admin-muted">
                  Рассылок пока нет.
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
