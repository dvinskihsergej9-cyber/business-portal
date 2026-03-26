import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch, normalizeErrorMessage } from "../apiConfig";

const PRIORITY_LABELS = {
  LOW: "Низкий",
  NORMAL: "Обычный",
  HIGH: "Высокий",
};

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("ru-RU");
}

function getPriorityLabel(value) {
  const key = String(value || "").trim().toUpperCase();
  return PRIORITY_LABELS[key] || "Обычный";
}

export default function PlatformNews() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const limit = 20;

  const totalPages = useMemo(() => Math.max(1, Math.ceil((Number(total) || 0) / limit)), [total]);

  const loadNews = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const res = await apiFetch(`/platform-news?page=${page}&limit=${limit}`, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem("token") || ""}`,
        },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.message || "Не удалось загрузить новости.");
      }
      setItems(Array.isArray(data?.items) ? data.items : []);
      setTotal(Number(data?.total) || 0);
    } catch (err) {
      setItems([]);
      setTotal(0);
      setError(normalizeErrorMessage(err, "Не удалось загрузить новости."));
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    loadNews();
  }, [loadNews]);

  return (
    <div className="page">
      <div className="card card--1c">
        <div className="card1c__header">Новости платформы</div>
        <div className="card1c__body">
          <p style={{ marginTop: 0, marginBottom: 12, color: "#64748b" }}>
            Все опубликованные обновления и объявления по системе.
          </p>

          {error ? <div className="alert alert--danger">{error}</div> : null}
          {loading ? <div className="muted">Загрузка...</div> : null}

          {!loading && !items.length ? (
            <div className="muted">Новостей пока нет.</div>
          ) : null}

          <div style={{ display: "grid", gap: 10 }}>
            {items.map((item) => (
              <article key={item.id} className="card" style={{ margin: 0 }}>
                <div className="card1c__body" style={{ display: "grid", gap: 8 }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 8,
                      flexWrap: "wrap",
                    }}
                  >
                    <strong style={{ fontSize: 16 }}>{item.title || "-"}</strong>
                    <span className="badge badge--pending">{getPriorityLabel(item.priority)}</span>
                  </div>
                  <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.45 }}>
                    {item.message || "-"}
                  </div>
                  <div className="muted">{formatDateTime(item.createdAt)}</div>
                </div>
              </article>
            ))}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12 }}>
            <button
              type="button"
              className="btn btn--secondary"
              disabled={loading || page <= 1}
              onClick={() => setPage((prev) => Math.max(1, prev - 1))}
            >
              Назад
            </button>
            <div className="muted">
              Страница {page} из {totalPages} • Всего: {total}
            </div>
            <button
              type="button"
              className="btn btn--secondary"
              disabled={loading || page >= totalPages}
              onClick={() => setPage((prev) => prev + 1)}
            >
              Вперед
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
