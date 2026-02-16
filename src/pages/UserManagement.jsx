import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { API_BASE, normalizeErrorMessage } from "../apiConfig";
import { useAuth } from "../context/AuthContext";
import {
  PERMISSION_GROUPS,
  PERMISSION_LABELS,
  PERMISSION_TEMPLATES,
} from "../utils/permissions";

const API = API_BASE;
const ALL_ROLES = ["EMPLOYEE", "HR", "ACCOUNTING", "WAREHOUSE", "ADMIN"];

const FALLBACK_PERMISSION_CATALOG = {
  groups: PERMISSION_GROUPS,
  templates: PERMISSION_TEMPLATES.map((tpl) => ({
    id: tpl.id,
    label: tpl.label,
    permissions: [],
  })),
  roleDefaults: {},
};

const LOGIN_PATTERN = /^[a-z0-9._-]{3,32}$/;

const roleLabel = (role) => {
  switch (role) {
    case "EMPLOYEE":
      return "Сотрудник";
    case "HR":
      return "HR";
    case "ACCOUNTING":
      return "Бухгалтерия";
    case "WAREHOUSE":
      return "Склад";
    case "ADMIN":
      return "Админ";
    default:
      return role;
  }
};

const mapCreateUserError = (code) => {
  switch (code) {
    case "USERNAME_ALREADY_EXISTS":
      return "Такой логин уже занят.";
    case "ORG_REQUIRED":
      return "Организация не настроена.";
    case "ORG_NOT_FOUND":
      return "Организация не найдена.";
    default:
      return code;
  }
};

const buildPermissionDraft = (user) => ({
  template: user?.permissionTemplate || "ROLE_DEFAULT",
  permissions: Array.isArray(user?.permissions) ? [...new Set(user.permissions)] : [],
});

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

export default function UserManagement() {
  const { user } = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null);
  const [permissionSavingId, setPermissionSavingId] = useState(null);
  const [expandedUserId, setExpandedUserId] = useState(null);
  const [error, setError] = useState("");

  const [permissionCatalog, setPermissionCatalog] = useState(
    FALLBACK_PERMISSION_CATALOG
  );
  const [permissionDrafts, setPermissionDrafts] = useState({});

  const [createSaving, setCreateSaving] = useState(false);
  const [createError, setCreateError] = useState("");
  const [createSuccess, setCreateSuccess] = useState("");
  const createErrorRef = useRef(null);
  const [newUser, setNewUser] = useState({
    name: "",
    login: "",
    password: "",
    role: "EMPLOYEE",
    template: "ROLE_DEFAULT",
    permissions: [],
  });

  const token = localStorage.getItem("token");
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };

  const roleDefaults = useMemo(() => {
    const source = permissionCatalog?.roleDefaults || {};
    return source && typeof source === "object" ? source : {};
  }, [permissionCatalog]);

  const templatesMap = useMemo(() => {
    const map = new Map();
    const templates = Array.isArray(permissionCatalog?.templates)
      ? permissionCatalog.templates
      : [];
    for (const tpl of templates) {
      map.set(tpl.id, {
        id: tpl.id,
        label: tpl.label || tpl.id,
        permissions: Array.isArray(tpl.permissions)
          ? [...new Set(tpl.permissions)]
          : [],
      });
    }
    return map;
  }, [permissionCatalog]);

  const getTemplatePermissions = (templateId, role) => {
    if (templateId === "ROLE_DEFAULT") {
      return Array.isArray(roleDefaults?.[role])
        ? [...new Set(roleDefaults[role])]
        : [];
    }
    const tpl = templatesMap.get(templateId);
    return tpl ? [...tpl.permissions] : [];
  };

  const syncPermissionDrafts = (list) => {
    const next = {};
    for (const row of list) {
      next[row.id] = buildPermissionDraft(row);
    }
    setPermissionDrafts(next);
  };

  const resetCreateForm = () => {
    setNewUser({
      name: "",
      login: "",
      password: "",
      role: "EMPLOYEE",
      template: "ROLE_DEFAULT",
      permissions: getTemplatePermissions("ROLE_DEFAULT", "EMPLOYEE"),
    });
  };

  const loadPermissionsCatalog = async () => {
    try {
      const res = await fetch(`${API}/users/permissions/catalog`, { headers });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.message || "Ошибка загрузки прав доступа");
      }
      const nextCatalog = {
        groups: Array.isArray(data.groups)
          ? data.groups
          : FALLBACK_PERMISSION_CATALOG.groups,
        templates: Array.isArray(data.templates)
          ? data.templates
          : FALLBACK_PERMISSION_CATALOG.templates,
        roleDefaults:
          data.roleDefaults && typeof data.roleDefaults === "object"
            ? data.roleDefaults
            : FALLBACK_PERMISSION_CATALOG.roleDefaults,
      };
      setPermissionCatalog(nextCatalog);

      setNewUser((prev) => {
        if (Array.isArray(prev.permissions) && prev.permissions.length > 0) {
          return prev;
        }
        const defaults = prev.template === "ROLE_DEFAULT"
          ? Array.isArray(nextCatalog.roleDefaults?.[prev.role])
            ? [...new Set(nextCatalog.roleDefaults[prev.role])]
            : []
          : [];
        return { ...prev, permissions: defaults };
      });
    } catch (e) {
      console.error(e);
      setPermissionCatalog(FALLBACK_PERMISSION_CATALOG);
    }
  };

  const loadUsers = async () => {
    try {
      setLoading(true);
      setError("");
      const res = await fetch(`${API}/users`, { headers });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || "Ошибка загрузки пользователей");
      }
      const list = Array.isArray(data) ? data : [];
      setUsers(list);
      syncPermissionDrafts(list);
    } catch (e) {
      console.error(e);
      setError(normalizeErrorMessage(e, "Ошибка загрузки пользователей."));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPermissionsCatalog();
    loadUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!createError) return;
    const node = createErrorRef.current;
    if (!node) return;
    node.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [createError]);

  const handleCreateRoleChange = (nextRole) => {
    setNewUser((prev) => ({
      ...prev,
      role: nextRole,
      permissions: getTemplatePermissions(prev.template, nextRole),
    }));
  };

  const handleCreateTemplateChange = (nextTemplate) => {
    setNewUser((prev) => ({
      ...prev,
      template: nextTemplate,
      permissions: getTemplatePermissions(nextTemplate, prev.role),
    }));
  };

  const handleCreateTogglePermission = (permissionKey) => {
    setNewUser((prev) => {
      const selected = new Set(prev.permissions || []);
      if (selected.has(permissionKey)) {
        selected.delete(permissionKey);
      } else {
        selected.add(permissionKey);
      }
      return {
        ...prev,
        permissions: Array.from(selected),
      };
    });
  };

  const handleGeneratePassword = () => {
    const generatedPassword = generatePassword(12);
    setNewUser((prev) => ({
      ...prev,
      password: generatedPassword,
    }));
  };

  const handleCreateUser = async () => {
    const login = String(newUser.login || "").trim().toLowerCase();
    const name = String(newUser.name || "").trim();
    const role = String(newUser.role || "EMPLOYEE");
    const password = String(newUser.password || "");

    if (!login) {
      setCreateError("Введите логин.");
      return;
    }

    if (!LOGIN_PATTERN.test(login)) {
      setCreateError(
        "Логин должен быть 3-32 символа: латиница, цифры, точка, дефис или подчёркивание."
      );
      return;
    }
    if (password.length < 8) {
      setCreateError("Пароль должен быть не короче 8 символов.");
      return;
    }

    const selected = Array.from(new Set(newUser.permissions || []));
    const basePermissions = getTemplatePermissions(newUser.template, role);
    const grants = selected.filter((key) => !basePermissions.includes(key));
    const revokes = basePermissions.filter((key) => !selected.includes(key));

    setCreateSaving(true);
    setCreateError("");
    setCreateSuccess("");

    try {
      const res = await fetch(`${API}/users`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          name,
          login,
          password,
          role,
          template: newUser.template,
          grants,
          revokes,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || "Ошибка создания сотрудника");
      }

      setCreateSuccess(`Сотрудник с логином "${login}" создан.`);
      resetCreateForm();
      await loadUsers();
    } catch (e) {
      console.error(e);
      const raw = normalizeErrorMessage(e, "Ошибка создания сотрудника.");
      setCreateError(mapCreateUserError(raw));
    } finally {
      setCreateSaving(false);
    }
  };

  const handleRoleChangeLocal = (id, newRole) => {
    setUsers((prev) =>
      prev.map((u) => (u.id === id ? { ...u, role: newRole } : u))
    );

    setPermissionDrafts((prev) => {
      const existing = prev[id] || { template: "ROLE_DEFAULT", permissions: [] };
      if (existing.template !== "ROLE_DEFAULT") {
        return prev;
      }
      return {
        ...prev,
        [id]: {
          template: "ROLE_DEFAULT",
          permissions: getTemplatePermissions("ROLE_DEFAULT", newRole),
        },
      };
    });
  };

  const handleSaveRole = async (id) => {
    const userToUpdate = users.find((u) => u.id === id);
    if (!userToUpdate) return;

    setSavingId(id);
    setError("");

    try {
      const res = await fetch(`${API}/users/${id}/role`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ role: userToUpdate.role }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || "Ошибка изменения роли");
      }

      const nextUser = data?.user;
      if (!nextUser) {
        throw new Error("Сервер вернул пустые данные пользователя");
      }

      setUsers((prev) => prev.map((u) => (u.id === id ? nextUser : u)));
      setPermissionDrafts((prev) => ({
        ...prev,
        [id]: buildPermissionDraft(nextUser),
      }));
    } catch (e) {
      console.error(e);
      setError(normalizeErrorMessage(e, "Ошибка изменения роли."));
    } finally {
      setSavingId(null);
    }
  };

  const handleTemplateChangeLocal = (userId, templateId) => {
    const userRow = users.find((row) => row.id === userId);
    if (!userRow) return;
    const basePermissions = getTemplatePermissions(templateId, userRow.role);
    setPermissionDrafts((prev) => ({
      ...prev,
      [userId]: {
        template: templateId,
        permissions: basePermissions,
      },
    }));
  };

  const handleTogglePermission = (userId, permissionKey) => {
    setPermissionDrafts((prev) => {
      const current = prev[userId] || {
        template: "ROLE_DEFAULT",
        permissions: [],
      };
      const selected = new Set(current.permissions || []);
      if (selected.has(permissionKey)) {
        selected.delete(permissionKey);
      } else {
        selected.add(permissionKey);
      }
      return {
        ...prev,
        [userId]: {
          ...current,
          permissions: Array.from(selected),
        },
      };
    });
  };

  const handleSavePermissions = async (userId) => {
    const userRow = users.find((row) => row.id === userId);
    const draft = permissionDrafts[userId];
    if (!userRow || !draft) return;

    const selected = Array.from(new Set(draft.permissions || []));
    const basePermissions = getTemplatePermissions(draft.template, userRow.role);
    const grants = selected.filter((key) => !basePermissions.includes(key));
    const revokes = basePermissions.filter((key) => !selected.includes(key));

    setPermissionSavingId(userId);
    setError("");

    try {
      const res = await fetch(`${API}/users/${userId}/permissions`, {
        method: "PUT",
        headers,
        body: JSON.stringify({
          template: draft.template,
          grants,
          revokes,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || "Ошибка изменения прав доступа");
      }
      const nextUser = data?.user;
      if (!nextUser) {
        throw new Error("Сервер вернул пустые данные пользователя");
      }

      setUsers((prev) => prev.map((row) => (row.id === userId ? nextUser : row)));
      setPermissionDrafts((prev) => ({
        ...prev,
        [userId]: buildPermissionDraft(nextUser),
      }));
    } catch (e) {
      console.error(e);
      setError(normalizeErrorMessage(e, "Ошибка изменения прав доступа."));
    } finally {
      setPermissionSavingId(null);
    }
  };

  if (user?.role !== "ADMIN") {
    return (
      <div style={{ padding: 24 }}>
        Нет доступа. Эта страница только для ADMIN.
      </div>
    );
  }

  return (
    <div className="admin-page" style={{ padding: 24 }}>
      <h1>Управление пользователями</h1>
      <p>
        Администратор создаёт сотрудников напрямую: задаёт логин, пароль, роль и права.
      </p>

      <div
        className="admin-console__card"
        style={{ marginTop: 16, marginBottom: 16 }}
      >
        <div style={{ fontWeight: 600, marginBottom: 8 }}>
          Создать сотрудника
        </div>
        <div className="admin-invite-grid">
          <input
            type="text"
            placeholder="ФИО"
            value={newUser.name}
            onChange={(e) =>
              setNewUser((prev) => ({ ...prev, name: e.target.value }))
            }
            className="admin-input"
          />
          <input
            type="text"
            placeholder="Логин (например, sklad_1)"
            value={newUser.login}
            onChange={(e) =>
              setNewUser((prev) => ({ ...prev, login: e.target.value }))
            }
            className="admin-input"
          />
          <div style={{ display: "flex", gap: 8 }}>
            <input
              type="text"
              placeholder="Пароль"
              value={newUser.password}
              onChange={(e) =>
                setNewUser((prev) => ({ ...prev, password: e.target.value }))
              }
              className="admin-input"
            />
            <button
              type="button"
              onClick={handleGeneratePassword}
              className="admin-btn admin-btn--secondary"
            >
              Сгенерировать
            </button>
          </div>
          <select
            value={newUser.role}
            onChange={(e) => handleCreateRoleChange(e.target.value)}
            className="admin-select"
          >
            {ALL_ROLES.map((r) => (
              <option key={r} value={r}>
                {roleLabel(r)} ({r})
              </option>
            ))}
          </select>
          <select
            className="admin-select"
            value={newUser.template}
            onChange={(e) => handleCreateTemplateChange(e.target.value)}
          >
            {(Array.isArray(permissionCatalog.templates)
              ? permissionCatalog.templates
              : FALLBACK_PERMISSION_CATALOG.templates
            ).map((tpl) => (
              <option key={tpl.id} value={tpl.id}>
                {tpl.label || tpl.id}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={handleCreateUser}
            disabled={createSaving}
            className="admin-btn admin-btn--primary"
          >
            {createSaving ? "Создание..." : "Создать сотрудника"}
          </button>
        </div>

        <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
          {(Array.isArray(permissionCatalog.groups)
            ? permissionCatalog.groups
            : FALLBACK_PERMISSION_CATALOG.groups
          ).map((group) => (
            <div key={group.id} style={{ display: "grid", gap: 6 }}>
              <div style={{ fontWeight: 600 }}>{group.label}</div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                  gap: 6,
                }}
              >
                {(Array.isArray(group.keys) ? group.keys : []).map((key) => (
                  <label
                    key={key}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      fontSize: 13,
                      color: "#334155",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={(newUser.permissions || []).includes(key)}
                      onChange={() => handleCreateTogglePermission(key)}
                    />
                    <span>{PERMISSION_LABELS[key] || key}</span>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>

        {createError && (
          <div
            ref={createErrorRef}
            style={{
              marginTop: 10,
              padding: 8,
              borderRadius: 4,
              background: "#ffe6e6",
              color: "#b00020",
            }}
          >
            {createError}
          </div>
        )}
        {createSuccess && (
          <div
            style={{
              marginTop: 10,
              padding: 8,
              borderRadius: 4,
              background: "#e8f7e8",
              color: "#1f7a1f",
            }}
          >
            {createSuccess}
          </div>
        )}
      </div>

      {error && (
        <div
          style={{
            marginTop: 12,
            marginBottom: 12,
            padding: 8,
            borderRadius: 4,
            background: "#ffe6e6",
            color: "#b00020",
          }}
        >
          {error}
        </div>
      )}

      {loading ? (
        <p>Загрузка пользователей...</p>
      ) : users.length === 0 ? (
        <p>Пользователей пока нет.</p>
      ) : (
        <div className="admin-table-wrapper">
          <table className="admin-table admin-table--users">
            <thead>
              <tr>
                <th style={thStyle}>ID</th>
                <th style={thStyle}>Имя</th>
                <th style={thStyle}>Логин</th>
                <th style={thStyle}>Роль</th>
                <th style={thStyle}>Создан</th>
                <th style={thStyle}></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const draft = permissionDrafts[u.id] || buildPermissionDraft(u);
                const isExpanded = expandedUserId === u.id;
                const selectedPermissions = Array.isArray(draft.permissions)
                  ? draft.permissions
                  : [];

                return (
                  <Fragment key={u.id}>
                    <tr>
                      <td data-label="ID" style={tdStyle}>
                        {u.id}
                      </td>
                      <td data-label="Имя" style={tdStyle}>
                        {u.name}
                      </td>
                      <td data-label="Логин" style={tdStyle}>
                        {u.login || u.username || u.email}
                      </td>
                      <td data-label="Роль" style={tdStyle}>
                        <select
                          value={u.role}
                          onChange={(e) => handleRoleChangeLocal(u.id, e.target.value)}
                          className="admin-select"
                          disabled={savingId === u.id || u.isSystemOwner}
                        >
                          {ALL_ROLES.map((r) => (
                            <option key={r} value={r}>
                              {roleLabel(r)} ({r})
                            </option>
                          ))}
                        </select>
                      </td>
                      <td data-label="Создан" style={tdStyle}>
                        {u.createdAt ? new Date(u.createdAt).toLocaleString() : "-"}
                      </td>
                      <td
                        data-label="Действия"
                        style={tdStyle}
                        className="admin-table__actions"
                      >
                        <button
                          onClick={() => handleSaveRole(u.id)}
                          disabled={savingId === u.id || u.isSystemOwner}
                          className="admin-btn admin-btn--primary"
                        >
                          {savingId === u.id ? "Сохранение..." : "Сохранить роль"}
                        </button>
                        <button
                          type="button"
                          className="admin-btn admin-btn--secondary"
                          onClick={() =>
                            setExpandedUserId((prev) => (prev === u.id ? null : u.id))
                          }
                          disabled={u.isSystemOwner}
                        >
                          {isExpanded ? "Скрыть права" : "Права"}
                        </button>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr>
                        <td style={{ ...tdStyle, background: "#fafcff" }} colSpan={6}>
                          <div style={{ display: "grid", gap: 12 }}>
                            <div
                              style={{
                                display: "flex",
                                flexWrap: "wrap",
                                gap: 8,
                                alignItems: "center",
                              }}
                            >
                              <select
                                className="admin-select"
                                value={draft.template || "ROLE_DEFAULT"}
                                onChange={(e) =>
                                  handleTemplateChangeLocal(u.id, e.target.value)
                                }
                              >
                                {(Array.isArray(permissionCatalog.templates)
                                  ? permissionCatalog.templates
                                  : FALLBACK_PERMISSION_CATALOG.templates
                                ).map((tpl) => (
                                  <option key={tpl.id} value={tpl.id}>
                                    {tpl.label || tpl.id}
                                  </option>
                                ))}
                              </select>
                              <button
                                type="button"
                                className="admin-btn admin-btn--primary"
                                onClick={() => handleSavePermissions(u.id)}
                                disabled={permissionSavingId === u.id}
                              >
                                {permissionSavingId === u.id
                                  ? "Сохранение..."
                                  : "Сохранить права"}
                              </button>
                              <span style={{ color: "#64748b", fontSize: 12 }}>
                                Активных прав: {selectedPermissions.length}
                              </span>
                            </div>

                            {(Array.isArray(permissionCatalog.groups)
                              ? permissionCatalog.groups
                              : FALLBACK_PERMISSION_CATALOG.groups
                            ).map((group) => (
                              <div key={group.id} style={{ display: "grid", gap: 6 }}>
                                <div style={{ fontWeight: 600 }}>{group.label}</div>
                                <div
                                  style={{
                                    display: "grid",
                                    gridTemplateColumns:
                                      "repeat(auto-fit, minmax(220px, 1fr))",
                                    gap: 6,
                                  }}
                                >
                                  {(Array.isArray(group.keys) ? group.keys : []).map((key) => (
                                    <label
                                      key={key}
                                      style={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: 8,
                                        fontSize: 13,
                                        color: "#334155",
                                      }}
                                    >
                                      <input
                                        type="checkbox"
                                        checked={selectedPermissions.includes(key)}
                                        onChange={() => handleTogglePermission(u.id, key)}
                                      />
                                      <span>{PERMISSION_LABELS[key] || key}</span>
                                    </label>
                                  ))}
                                </div>
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const thStyle = {
  textAlign: "left",
  padding: 8,
  borderBottom: "1px solid #e5e7eb",
  background: "#f9fafb",
};

const tdStyle = {
  padding: 8,
  borderTop: "1px solid #e5e7eb",
};

