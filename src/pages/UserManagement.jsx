import { Fragment, useEffect, useMemo, useState } from "react";
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

const mapInviteError = (code) => {
  switch (code) {
    case "INVITE_EMAIL_REQUIRED":
      return "Укажите почту";
    case "BAD_INVITE":
      return "Неверные данные";
    case "EMAIL_ALREADY_EXISTS":
      return "Почта уже занята";
    case "INVITE_RATE_LIMIT":
      return "Превышена частота отправки";
    case "INVITE_GLOBAL_LIMIT":
      return "Превышен общий лимит отправок";
    case "INVITE_NOT_FOUND":
      return "Приглашение не найдено";
    case "INVITE_SEND_ERROR":
      return "Не удалось отправить приглашение";
    case "INVITE_RESEND_ERROR":
      return "Не удалось переотправить приглашение";
    case "INVITES_LOAD_ERROR":
      return "Ошибка загрузки приглашений";
    default:
      return code;
  }
};

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

const buildPermissionDraft = (user) => ({
  template: user?.permissionTemplate || "ROLE_DEFAULT",
  permissions: Array.isArray(user?.permissions) ? [...new Set(user.permissions)] : [],
});

export default function UserManagement() {
  const { user } = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null);
  const [permissionSavingId, setPermissionSavingId] = useState(null);
  const [expandedUserId, setExpandedUserId] = useState(null);
  const [error, setError] = useState("");

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("EMPLOYEE");
  const [invites, setInvites] = useState([]);
  const [invitesLoading, setInvitesLoading] = useState(true);
  const [invitesError, setInvitesError] = useState("");
  const [inviteSending, setInviteSending] = useState(false);
  const [inviteResendId, setInviteResendId] = useState(null);

  const [permissionCatalog, setPermissionCatalog] = useState(
    FALLBACK_PERMISSION_CATALOG
  );
  const [permissionDrafts, setPermissionDrafts] = useState({});

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

  const loadPermissionsCatalog = async () => {
    try {
      const res = await fetch(`${API}/users/permissions/catalog`, { headers });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.message || "Ошибка загрузки прав доступа");
      }
      setPermissionCatalog({
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

  const loadInvites = async () => {
    try {
      setInvitesLoading(true);
      setInvitesError("");
      const res = await fetch(`${API}/admin/invites`, { headers });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || "INVITES_LOAD_ERROR");
      }
      setInvites(Array.isArray(data.items) ? data.items : []);
    } catch (e) {
      console.error(e);
      setInvitesError(normalizeErrorMessage(e, "INVITES_LOAD_ERROR"));
    } finally {
      setInvitesLoading(false);
    }
  };

  useEffect(() => {
    loadPermissionsCatalog();
    loadUsers();
    loadInvites();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const handleInviteSubmit = async () => {
    if (!inviteEmail) {
      setInvitesError("INVITE_EMAIL_REQUIRED");
      return;
    }
    setInvitesError("");
    setInviteSending(true);
    try {
      const res = await fetch(`${API}/admin/invites`, {
        method: "POST",
        headers,
        body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || "INVITE_SEND_ERROR");
      }
      setInviteEmail("");
      setInviteRole("EMPLOYEE");
      await loadInvites();
    } catch (e) {
      console.error(e);
      setInvitesError(normalizeErrorMessage(e, "INVITE_SEND_ERROR"));
    } finally {
      setInviteSending(false);
    }
  };

  const handleInviteResend = async (id) => {
    setInviteResendId(id);
    setInvitesError("");
    try {
      const res = await fetch(`${API}/admin/invites/${id}/resend`, {
        method: "POST",
        headers,
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || "INVITE_RESEND_ERROR");
      }
      await loadInvites();
    } catch (e) {
      console.error(e);
      setInvitesError(normalizeErrorMessage(e, "INVITE_RESEND_ERROR"));
    } finally {
      setInviteResendId(null);
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
        Здесь администратор может просматривать пользователей, менять их роли и
        настраивать индивидуальные права доступа.
      </p>

      <div
        className="admin-console__card"
        style={{ marginTop: 16, marginBottom: 16 }}
      >
        <div style={{ fontWeight: 600, marginBottom: 8 }}>
          Пригласить пользователя
        </div>
        <div className="admin-invite-grid">
          <input
            type="email"
            placeholder="Почта"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            className="admin-input"
          />
          <select
            value={inviteRole}
            onChange={(e) => setInviteRole(e.target.value)}
            className="admin-select"
          >
            {ALL_ROLES.map((r) => (
              <option key={r} value={r}>
                {roleLabel(r)} ({r})
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={handleInviteSubmit}
            disabled={inviteSending}
            className="admin-btn admin-btn--primary"
          >
            {inviteSending ? "Отправка..." : "Пригласить"}
          </button>
        </div>
        {invitesError && (
          <div
            style={{
              marginTop: 10,
              padding: 8,
              borderRadius: 4,
              background: "#ffe6e6",
              color: "#b00020",
            }}
          >
            {mapInviteError(invitesError)}
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

      <div style={{ marginBottom: 16 }}>
        <h3 style={{ marginBottom: 8 }}>Приглашения</h3>
        {invitesLoading ? (
          <p>Загрузка...</p>
        ) : invites.length === 0 ? (
          <p>Приглашений пока нет.</p>
        ) : (
          <div className="admin-table-wrapper">
            <table className="admin-table admin-table--invites">
              <thead>
                <tr>
                  <th style={thStyle}>Email</th>
                  <th style={thStyle}>Роль</th>
                  <th style={thStyle}>Статус</th>
                  <th style={thStyle}>Создан</th>
                  <th style={thStyle}></th>
                </tr>
              </thead>
              <tbody>
                {invites.map((inv) => (
                  <tr key={inv.id}>
                    <td data-label="Email" style={tdStyle}>
                      {inv.email}
                    </td>
                    <td data-label="Роль" style={tdStyle}>
                      {roleLabel(inv.role)} ({inv.role})
                    </td>
                    <td data-label="Статус" style={tdStyle}>
                      {inv.status}
                    </td>
                    <td data-label="Создан" style={tdStyle}>
                      {inv.createdAt ? new Date(inv.createdAt).toLocaleString() : "-"}
                    </td>
                    <td
                      data-label="Действия"
                      style={tdStyle}
                      className="admin-table__actions"
                    >
                      <button
                        type="button"
                        onClick={() => handleInviteResend(inv.id)}
                        disabled={inviteResendId === inv.id}
                        className="admin-btn admin-btn--secondary"
                      >
                        {inviteResendId === inv.id
                          ? "Отправка..."
                          : "Переотправить"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

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
                <th style={thStyle}>Email</th>
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
                      <td data-label="Email" style={tdStyle}>
                        {u.email}
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
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
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

