import { useEffect, useMemo, useRef, useState } from "react";
import { apiFetch, normalizeErrorMessage } from "../apiConfig";
import { useAuth } from "../context/AuthContext";
const TENANT_CREDENTIALS_KEY = "bp.createdTenantCredentials.v1";
const sanitizeLoginInput = (value) =>
  String(value || "").replace(/\s+/g, "_");

const normalizeLoginForSubmit = (value) =>
  String(value || "")
    .trim()
    .replace(/\s+/g, "_")
    .toLowerCase();

const EMPTY_FORM = {
  name: "",
  ownerName: "",
  ownerLogin: "",
  ownerPassword: "",
};

function generatePassword(length = 12) {
  const lower = "abcdefghijkmnopqrstuvwxyz";
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const digits = "23456789";
  const all = `${lower}${upper}${digits}`;
  const pick = (src) => src[Math.floor(Math.random() * src.length)];

  const chars = [pick(lower), pick(upper), pick(digits)];
  while (chars.length < length) {
    chars.push(pick(all));
  }

  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }

  return chars.join("");
}

function readTenantCredentials() {
  try {
    const raw = localStorage.getItem(TENANT_CREDENTIALS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function copyText(value) {
  const text = String(value || "");
  if (!text) return;
  if (navigator?.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "readonly");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}

export default function TenantManagement() {
  const { user } = useAuth();
  const isSystemOwner = user?.isSystemOwner === true;
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [deletingTenantId, setDeletingTenantId] = useState(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [tenantSearch, setTenantSearch] = useState("");
  const [form, setForm] = useState(EMPTY_FORM);
  const [tenantCredentials, setTenantCredentials] = useState(() =>
    readTenantCredentials()
  );
  const [pendingScrollTenantId, setPendingScrollTenantId] = useState(null);
  const [copiedTenantId, setCopiedTenantId] = useState(null);
  const tenantRowRefs = useRef({});
  const copiedTenantTimerRef = useRef(null);

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
      setError(normalizeErrorMessage(err, "Не удалось загрузить список клиентов."));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isSystemOwner) return;
    loadTenants();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSystemOwner]);

  useEffect(() => {
    if (!pendingScrollTenantId) return;
    const node = tenantRowRefs.current[pendingScrollTenantId];
    if (!node) return;
    node.scrollIntoView({ behavior: "smooth", block: "center" });
    setPendingScrollTenantId(null);
  }, [items, pendingScrollTenantId]);

  useEffect(() => {
    try {
      localStorage.setItem(TENANT_CREDENTIALS_KEY, JSON.stringify(tenantCredentials));
    } catch {
      // ignore storage write errors
    }
  }, [tenantCredentials]);

  useEffect(
    () => () => {
      if (copiedTenantTimerRef.current) {
        clearTimeout(copiedTenantTimerRef.current);
      }
    },
    []
  );

  const updateField = (field) => (event) => {
    setForm((prev) => ({ ...prev, [field]: event.target.value }));
  };

  const handleGeneratePassword = () => {
    setForm((prev) => ({ ...prev, ownerPassword: generatePassword(12) }));
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
        ownerLogin: normalizeLoginForSubmit(form.ownerLogin),
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

      const createdTenantId = data?.tenant?.id || null;
      const createdLogin = data?.user?.login || payload.ownerLogin;
      const createdPassword = data?.user?.initialPassword || payload.ownerPassword;
      if (createdTenantId) {
        setTenantCredentials((prev) => ({
          ...prev,
          [createdTenantId]: {
            login: createdLogin,
            password: createdPassword,
          },
        }));
      }

      setForm(EMPTY_FORM);
      setSuccess(
        `Клиент "${data?.tenant?.name || payload.name}" создан. Логин: ${createdLogin}. Пароль: ${createdPassword}`
      );
      await loadTenants();
      if (createdTenantId) setPendingScrollTenantId(createdTenantId);
    } catch (err) {
      setError(normalizeErrorMessage(err, "Не удалось создать клиента."));
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteTenant = async (tenant) => {
    const tenantId = Number(tenant?.id || 0);
    if (!tenantId) return;
    const tenantName = String(tenant?.name || `ID ${tenantId}`);
    const confirmed = window.confirm(`Удалить клиента "${tenantName}"?`);
    if (!confirmed) return;

    setDeletingTenantId(tenantId);
    setError("");
    setSuccess("");
    try {
      const res = await apiFetch(`/admin/tenants/${tenantId}`, {
        method: "DELETE",
        headers,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.message || "TENANT_DELETE_ERROR");
      }

      setItems((prev) => prev.filter((row) => row.id !== tenantId));
      setTenantCredentials((prev) => {
        const next = { ...prev };
        delete next[tenantId];
        return next;
      });
      setSuccess(`Клиент "${tenantName}" удалён.`);
    } catch (err) {
      setError(normalizeErrorMessage(err, "Не удалось удалить клиента."));
    } finally {
      setDeletingTenantId(null);
    }
  };

  const handleCopyTenantCredentials = async (tenant) => {
    const login = String(
      tenantCredentials[tenant.id]?.login || tenant.adminLogin || ""
    ).trim();
    const password = String(
      tenantCredentials[tenant.id]?.password || tenant.adminPassword || ""
    ).trim();

    if (!login || !password || password === "-") {
      setError("Не удалось скопировать: логин или пароль пустой.");
      return;
    }

    try {
      await copyText(`Логин: ${login}\nПароль: ${password}`);
      setError("");
      setCopiedTenantId(tenant.id);
      if (copiedTenantTimerRef.current) clearTimeout(copiedTenantTimerRef.current);
      copiedTenantTimerRef.current = setTimeout(() => setCopiedTenantId(null), 1800);
      setSuccess(`Данные клиента \"${tenant.name || login}\" скопированы.`);
    } catch {
      setError("Не удалось скопировать логин и пароль.");
    }
  };

  const filteredItems = useMemo(() => {
    const query = String(tenantSearch || "").trim().toLowerCase();
    if (!query) return items;
    return items.filter((item) => {
      const login = tenantCredentials[item.id]?.login || item.adminLogin || "";
      const haystack = [item.id, item.name, item.code, item.adminName, login]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [items, tenantCredentials, tenantSearch]);

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
              <label className="admin-label">ФИО администратора</label>
              <input
                className="admin-input"
                type="text"
                placeholder="Иванов Иван Иванович"
                value={form.ownerName}
                onChange={updateField("ownerName")}
              />
            </div>
          </div>
          <div className="admin-form__row">
            <div>
              <label className="admin-label">Логин администратора</label>
              <input
                className="admin-input"
                type="text"
                placeholder="Например: клиент_админ"
                value={form.ownerLogin}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    ownerLogin: sanitizeLoginInput(event.target.value),
                  }))
                }
                required
              />
            </div>
            <div>
              <label className="admin-label">Пароль администратора</label>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  className="admin-input"
                  type="text"
                  placeholder="Минимум 8 символов"
                  value={form.ownerPassword}
                  onChange={updateField("ownerPassword")}
                  minLength={8}
                  required
                />
                <button
                  type="button"
                  className="admin-btn admin-btn--secondary"
                  onClick={handleGeneratePassword}
                  disabled={submitting}
                >
                  Сгенерировать
                </button>
              </div>
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
        <div style={{ marginTop: 10, marginBottom: 10 }}>
          <input
            className="admin-input"
            type="text"
            placeholder="Поиск клиента: компания, код, логин, ID"
            value={tenantSearch}
            onChange={(event) => setTenantSearch(event.target.value)}
          />
        </div>
        {loading ? (
          <div className="admin-muted">Загрузка...</div>
        ) : items.length === 0 ? (
          <div className="admin-muted">Клиентов пока нет.</div>
        ) : filteredItems.length === 0 ? (
          <div className="admin-muted">Ничего не найдено по фильтру.</div>
        ) : (
          <div className="admin-table-wrapper">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Компания</th>
                  <th>Код клиента</th>
                  <th>Логин администратора</th>
                  <th>Пароль</th>
                  <th>Пользователей</th>
                  <th>Инвайтов</th>
                  <th>Создано</th>
                  <th>Действия</th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.map((item) => {
                  const adminLogin =
                    tenantCredentials[item.id]?.login || item.adminLogin || "-";
                  const adminPassword =
                    tenantCredentials[item.id]?.password || item.adminPassword || "-";
                  return (
                  <tr
                    key={item.id}
                    ref={(node) => {
                      if (node) tenantRowRefs.current[item.id] = node;
                    }}
                  >
                    <td data-label="ID">{item.id}</td>
                    <td data-label="Компания">{item.name || "-"}</td>
                    <td data-label="Код клиента">{item.code || "-"}</td>
                    <td data-label="Логин администратора">
                      {adminLogin}
                    </td>
                    <td data-label="Пароль">
                      {adminPassword}
                    </td>
                    <td data-label="Пользователей">{item?._count?.users || 0}</td>
                    <td data-label="Инвайтов">{item?._count?.invites || 0}</td>
                    <td data-label="Создано">
                      {item.createdAt
                        ? new Date(item.createdAt).toLocaleString("ru-RU")
                        : "-"}
                    </td>
                    <td data-label="" className="admin-table__actions">
                      <button
                        type="button"
                        className={
                          "admin-btn admin-btn--ghost admin-copy-btn" +
                          (copiedTenantId === item.id ? " admin-copy-btn--copied" : "")
                        }
                        title="Скопировать логин и пароль"
                        aria-label="Скопировать логин и пароль"
                        onClick={() => handleCopyTenantCredentials(item)}
                        disabled={adminPassword === "-"}
                      >
                        {copiedTenantId === item.id ? "Скопировано" : "Скопировать"}
                      </button>
                      <button
                        type="button"
                        className="admin-btn admin-btn--secondary"
                        onClick={() => handleDeleteTenant(item)}
                        disabled={deletingTenantId === item.id}
                      >
                        {deletingTenantId === item.id ? "Удаление..." : "Удалить"}
                      </button>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
