import { useEffect, useMemo, useState } from "react";
import { apiFetch, normalizeErrorMessage } from "../apiConfig";
import { useAuth } from "../context/AuthContext";

const EMPTY_FORM = {
  name: "",
  ownerName: "",
  ownerEmail: "",
  ownerPassword: "",
};

export default function TenantManagement() {
  const { user } = useAuth();
  const isSystemOwner = user?.isSystemOwner === true;
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [form, setForm] = useState(EMPTY_FORM);

  const token = localStorage.getItem("token");
  const headers = useMemo(
    () => ({
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    }),
    [token]
  );

  const loadTenants = async () => {
    try {
      setLoading(true);
      setError("");
      const res = await apiFetch("/admin/tenants", { headers });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.message || "TENANTS_LIST_ERROR");
      }
      setItems(Array.isArray(data.items) ? data.items : []);
    } catch (err) {
      setError(
        normalizeErrorMessage(err, "Не удалось загрузить список клиентов.")
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isSystemOwner) return;
    loadTenants();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSystemOwner]);

  const updateField = (field) => (event) => {
    setForm((prev) => ({ ...prev, [field]: event.target.value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    setSuccess("");
    try {
      const payload = {
        name: String(form.name || "").trim(),
        ownerName: String(form.ownerName || "").trim(),
        ownerEmail: String(form.ownerEmail || "").trim().toLowerCase(),
        ownerPassword: String(form.ownerPassword || ""),
      };

      const res = await apiFetch("/admin/tenants", {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.message || "TENANT_CREATE_ERROR");
      }

      setForm(EMPTY_FORM);
      setSuccess(
        `Клиент "${data?.tenant?.name || payload.name}" создан. Логин администратора: ${data?.user?.email || payload.ownerEmail}`
      );
      await loadTenants();
    } catch (err) {
      setError(normalizeErrorMessage(err, "Не удалось создать клиента."));
    } finally {
      setSubmitting(false);
    }
  };

  if (!isSystemOwner) {
    return (
      <div className="admin-console__card admin-console__card--warn">
        <div className="admin-console__card-title">Нет доступа</div>
        <div className="admin-console__card-text">
          Раздел управления клиентами доступен только владельцу платформы.
        </div>
      </div>
    );
  }

  return (
    <div className="admin-page" style={{ padding: 24 }}>
      <h1>Клиенты (SaaS)</h1>
      <p>
        Создание новых компаний и их администраторов. Данные клиентов изолированы
        друг от друга.
      </p>

      <div className="admin-console__card" style={{ marginTop: 16 }}>
        <div className="admin-console__card-title">Новый клиент</div>
        <form className="admin-form" onSubmit={handleSubmit}>
          <div className="admin-form__row">
            <div>
              <label className="admin-label">Название компании</label>
              <input
                className="admin-input"
                type="text"
                placeholder="Например: ООО Ромашка"
                value={form.name}
                onChange={updateField("name")}
                required
              />
            </div>
            <div>
              <label className="admin-label">Имя администратора</label>
              <input
                className="admin-input"
                type="text"
                placeholder="Иван Иванов"
                value={form.ownerName}
                onChange={updateField("ownerName")}
              />
            </div>
          </div>
          <div className="admin-form__row">
            <div>
              <label className="admin-label">Email администратора</label>
              <input
                className="admin-input"
                type="email"
                placeholder="admin@client.ru"
                value={form.ownerEmail}
                onChange={updateField("ownerEmail")}
                required
              />
            </div>
            <div>
              <label className="admin-label">Пароль администратора</label>
              <input
                className="admin-input"
                type="password"
                placeholder="Минимум 8 символов"
                value={form.ownerPassword}
                onChange={updateField("ownerPassword")}
                minLength={8}
                required
              />
            </div>
          </div>

          <div className="admin-table__actions">
            <button
              type="submit"
              className="admin-btn admin-btn--primary"
              disabled={submitting}
            >
              {submitting ? "Создание..." : "Создать клиента"}
            </button>
            <button
              type="button"
              className="admin-btn admin-btn--secondary"
              onClick={loadTenants}
              disabled={loading || submitting}
            >
              Обновить список
            </button>
          </div>
        </form>

        {error && <div className="admin-alert admin-alert--error">{error}</div>}
        {success && <div className="admin-muted">{success}</div>}
      </div>

      <div className="admin-console__card" style={{ marginTop: 16 }}>
        <div className="admin-console__card-title">Список клиентов</div>
        {loading ? (
          <div className="admin-muted">Загрузка...</div>
        ) : items.length === 0 ? (
          <div className="admin-muted">Клиентов пока нет.</div>
        ) : (
          <div className="admin-table-wrapper">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Компания</th>
                  <th>Код</th>
                  <th>Пользователей</th>
                  <th>Инвайтов</th>
                  <th>Создано</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td data-label="ID">{item.id}</td>
                    <td data-label="Компания">{item.name || "-"}</td>
                    <td data-label="Код">{item.code || "-"}</td>
                    <td data-label="Пользователей">{item?._count?.users || 0}</td>
                    <td data-label="Инвайтов">{item?._count?.invites || 0}</td>
                    <td data-label="Создано">
                      {item.createdAt
                        ? new Date(item.createdAt).toLocaleString("ru-RU")
                        : "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
