import { useEffect, useMemo, useState } from "react";
import { apiFetch, API_CONFIG_ERROR } from "../apiConfig";
import { FALLBACK_PORTAL_NEWS } from "../data/portalNewsFallback";
import useIsMobile from "../hooks/useIsMobile";

const emptyForm = {
  title: "",
  body: "",
  tags: "",
  published: true,
};

const normalizeTagsInput = (value) =>
  value
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

export default function PortalNewsAdmin() {
  const isMobile = useIsMobile();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [usingFallback, setUsingFallback] = useState(false);

  const token = localStorage.getItem("token");
  const headers = useMemo(
    () => ({
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    }),
    [token]
  );

  const loadItems = async () => {
    try {
      setLoading(true);
      setError("");

      if (API_CONFIG_ERROR) {
        setUsingFallback(true);
        setItems([]);
        setError(API_CONFIG_ERROR);
        return;
      }

      const res = await apiFetch("/portal-news", { headers });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.message || "Не удалось загрузить новости портала");
      }
      const nextItems = Array.isArray(data?.items) ? data.items : [];
      setItems(nextItems);
      setUsingFallback(nextItems.length === 0);
    } catch (e) {
      console.error(e);
      setUsingFallback(true);
      setItems([]);
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadItems();
  }, []);

  const startEdit = (item) => {
    if (usingFallback) return;
    setEditingId(item.id);
    setForm({
      title: item.title || "",
      body: item.body || "",
      tags: Array.isArray(item.tags) ? item.tags.join(", ") : "",
      published: item.published !== false,
    });
  };

  const resetForm = () => {
    setEditingId(null);
    setForm(emptyForm);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!form.title.trim() || !form.body.trim()) {
      setError("Заполните заголовок и текст новости.");
      return;
    }

    if (API_CONFIG_ERROR) {
      setError(API_CONFIG_ERROR);
      return;
    }

    try {
      setSaving(true);
      setError("");
      const payload = {
        title: form.title.trim(),
        body: form.body.trim(),
        tags: normalizeTagsInput(form.tags),
        published: !!form.published,
      };
      const url = editingId ? `/portal-news/${editingId}` : "/portal-news";
      const method = editingId ? "PUT" : "POST";
      const res = await apiFetch(url, {
        method,
        headers,
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.message || "Не удалось сохранить новость");
      }
      resetForm();
      await loadItems();
    } catch (e) {
      console.error(e);
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (item) => {
    if (usingFallback) return;
    const ok = window.confirm("Удалить новость?");
    if (!ok) return;

    try {
      setSaving(true);
      setError("");
      const res = await apiFetch(`/portal-news/${item.id}`, {
        method: "DELETE",
        headers,
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.message || "Не удалось удалить новость");
      }
      if (editingId === item.id) resetForm();
      await loadItems();
    } catch (e) {
      console.error(e);
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const displayItems = usingFallback ? FALLBACK_PORTAL_NEWS : items;
  const formDisabled = Boolean(API_CONFIG_ERROR);

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Управление новостями портала</h1>
        <p className="page-subtitle">
          Добавляйте, редактируйте и публикуйте новости для сотрудников.
        </p>
      </div>

      <div className="card card--1c" style={{ marginTop: 8 }}>
        <div className="card1c__header">
          {editingId ? "Редактирование новости" : "Новая новость"}
        </div>
        <div className="card1c__body">
          {error && (
            <div className="alert alert--danger" style={{ marginBottom: 12 }}>
              {error}
            </div>
          )}
          {API_CONFIG_ERROR && (
            <div className="alert alert--warning" style={{ marginBottom: 12 }}>
              {API_CONFIG_ERROR}
            </div>
          )}
          <form onSubmit={handleSubmit} className="form request-form-1c">
            <div className="form__group">
              <label className="form__label">Заголовок</label>
              <input
                className="form__input"
                value={form.title}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, title: e.target.value }))
                }
                placeholder="Заголовок новости"
                disabled={formDisabled}
              />
            </div>
            <div className="form__group">
              <label className="form__label">Текст</label>
              <textarea
                className="form__textarea"
                rows={6}
                value={form.body}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, body: e.target.value }))
                }
                placeholder="Полный текст новости"
                disabled={formDisabled}
              />
            </div>
            <div className="form__group">
              <label className="form__label">Теги (через запятую)</label>
              <input
                className="form__input"
                value={form.tags}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, tags: e.target.value }))
                }
                placeholder="обновления, процессы, важно"
                disabled={formDisabled}
              />
            </div>
            <div className="form__group">
              <label className="form__label">Публикация</label>
              <label style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <input
                  type="checkbox"
                  checked={form.published}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      published: e.target.checked,
                    }))
                  }
                  disabled={formDisabled}
                />
                Показать в новостях портала
              </label>
            </div>
            <div
              className="request-form-1c__actions"
              style={{ display: "grid", gap: 10 }}
            >
              <button
                type="submit"
                className="btn btn--primary"
                disabled={saving || formDisabled}
                style={{ width: "100%" }}
              >
                {saving
                  ? "Сохранение..."
                  : editingId
                  ? "Сохранить изменения"
                  : "Добавить новость"}
              </button>
              {editingId && (
                <button
                  type="button"
                  className="btn btn--secondary"
                  onClick={resetForm}
                  disabled={saving || formDisabled}
                  style={{ width: "100%" }}
                >
                  Отмена
                </button>
              )}
            </div>
          </form>
        </div>
      </div>

      <div className="card card--1c" style={{ marginTop: 12 }}>
        <div className="card1c__header">Новости портала</div>
        <div className="card1c__body">
          {loading ? (
            <p>Загрузка...</p>
          ) : displayItems.length === 0 ? (
            <p className="text-muted">Новостей пока нет.</p>
          ) : (
            <>
              {usingFallback && (
                <div className="alert alert--warning" style={{ marginBottom: 12 }}>
                  Показаны локальные новости. Чтобы управлять ими, подключите API.
                </div>
              )}
              <div className="responsive-cards">
                {displayItems.map((item) => {
                  const tags = Array.isArray(item.tags) ? item.tags : [];
                  return (
                    <div key={item.id} className="responsive-card">
                      <div className="responsive-card__title text-wrap">
                        {item.title}
                      </div>
                      <div className="responsive-card__meta">
                        <span>
                          {item.createdAt
                            ? new Date(item.createdAt).toLocaleString("ru-RU")
                            : "-"}
                        </span>
                        <span>
                          {item.published ? "Опубликовано" : "Черновик"}
                        </span>
                      </div>
                      {tags.length > 0 && (
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          {tags.map((tag) => (
                            <span key={tag} style={{ fontSize: 12, color: "#64748b" }}>
                              #{tag}
                            </span>
                          ))}
                        </div>
                      )}
                      <div className="portal-text" style={{ color: "#4b5563", fontSize: 14 }}>
                        {item.body}
                      </div>
                      {!usingFallback && (
                        <div
                          style={{
                            display: "grid",
                            gap: 10,
                            gridTemplateColumns: isMobile
                              ? "1fr"
                              : "repeat(2, minmax(0, 1fr))",
                          }}
                        >
                          <button
                            type="button"
                            className="btn btn--secondary"
                            onClick={() => startEdit(item)}
                          >
                            Редактировать
                          </button>
                          <button
                            type="button"
                            className="btn btn--danger"
                            onClick={() => handleDelete(item)}
                          >
                            Удалить
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
