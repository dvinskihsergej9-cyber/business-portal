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
const CREATED_USER_PASSWORDS_KEY = "bp.createdUserPasswords.v1";

const FALLBACK_PERMISSION_CATALOG = {
  groups: PERMISSION_GROUPS,
  templates: PERMISSION_TEMPLATES.map((tpl) => ({
    id: tpl.id,
    label: tpl.label,
    permissions: [],
  })),
  roleDefaults: {},
};

const LOGIN_PATTERN = /^[\p{L}\p{N}._-]{3,32}$/u;
const sanitizeLoginInput = (value) =>
  String(value || "").replace(/\s+/g, "_");

const normalizeLoginForSubmit = (value) =>
  String(value || "")
    .trim()
    .replace(/\s+/g, "_")
    .toLowerCase();

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

function readCreatedPasswords() {
  try {
    const raw = localStorage.getItem(CREATED_USER_PASSWORDS_KEY);
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

export default function UserManagement() {
  const { user } = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null);
  const [passwordSavingId, setPasswordSavingId] = useState(null);
  const [permissionSavingId, setPermissionSavingId] = useState(null);
  const [expandedUserId, setExpandedUserId] = useState(null);
  const [error, setError] = useState("");
  const [userSearch, setUserSearch] = useState("");

  const [permissionCatalog, setPermissionCatalog] = useState(
    FALLBACK_PERMISSION_CATALOG
  );
  const [permissionDrafts, setPermissionDrafts] = useState({});

  const [createSaving, setCreateSaving] = useState(false);
  const [createError, setCreateError] = useState("");
  const [createSuccess, setCreateSuccess] = useState("");
  const createErrorRef = useRef(null);
  const [createdPasswords, setCreatedPasswords] = useState(() => readCreatedPasswords());
  const [pendingScrollUserId, setPendingScrollUserId] = useState(null);
  const [copiedUserId, setCopiedUserId] = useState(null);
  const userRowRefs = useRef({});
  const copiedUserTimerRef = useRef(null);
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

  const cachePasswordForUser = (account, rawPassword) => {
    const value = String(rawPassword || "");
    if (!value) return;
    const keys = [account?.id, account?.login, account?.username, account?.email];
    setCreatedPasswords((prev) => {
      const next = { ...prev };
      for (const key of keys) {
        if (key === null || key === undefined || key === "") continue;
        next[key] = value;
      }
      return next;
    });
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

  useEffect(() => {
    if (!pendingScrollUserId) return;
    const node = userRowRefs.current[pendingScrollUserId];
    if (!node) return;
    node.scrollIntoView({ behavior: "smooth", block: "center" });
    setPendingScrollUserId(null);
  }, [users, pendingScrollUserId]);

  useEffect(() => {
    try {
      localStorage.setItem(CREATED_USER_PASSWORDS_KEY, JSON.stringify(createdPasswords));
    } catch {
      // ignore storage write errors
    }
  }, [createdPasswords]);

  useEffect(
    () => () => {
      if (copiedUserTimerRef.current) {
        clearTimeout(copiedUserTimerRef.current);
      }
    },
    []
  );

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
    const login = normalizeLoginForSubmit(newUser.login);
    const name = String(newUser.name || "").trim();
    const role = String(newUser.role || "EMPLOYEE");
    const password = String(newUser.password || "");

    if (!login) {
      setCreateError("Введите логин.");
      return;
    }

    if (!LOGIN_PATTERN.test(login)) {
      setCreateError(
        "Логин должен быть 3-32 символа: буквы, цифры, точка, дефис или подчёркивание."
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

      const createdUserId = data?.user?.id || null;
      const createdLogin = data?.user?.login || login;
      const createdPassword = data?.user?.initialPassword || password;
      cachePasswordForUser(
        {
          id: createdUserId,
          login: createdLogin,
          username: data?.user?.username || null,
          email: data?.user?.email || null,
        },
        createdPassword
      );

      setCreateSuccess(
        `Сотрудник "${createdLogin}" создан. Пароль: ${createdPassword}`
      );
      resetCreateForm();
      await loadUsers();
      if (createdUserId) setPendingScrollUserId(createdUserId);
    } catch (e) {
      console.error(e);
      const raw = normalizeErrorMessage(e, "Ошибка создания сотрудника.");
      setCreateError(mapCreateUserError(raw));
    } finally {
      setCreateSaving(false);
    }
  };

  const handleDeleteUser = async (targetUser) => {
    if (!targetUser?.id || targetUser?.isSystemOwner) return;
    if (targetUser.id === user?.id) {
      setError("\u041d\u0435\u043b\u044c\u0437\u044f \u0443\u0434\u0430\u043b\u0438\u0442\u044c \u0442\u0435\u043a\u0443\u0449\u0435\u0433\u043e \u043f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u0442\u0435\u043b\u044f.");
      return;
    }

    const loginLabel =
      targetUser.login || targetUser.username || targetUser.email || ("ID " + targetUser.id);
    const ok = window.confirm(
      "\u0423\u0434\u0430\u043b\u0438\u0442\u044c \u0441\u043e\u0442\u0440\u0443\u0434\u043d\u0438\u043a\u0430 \"" + loginLabel + "\"?"
    );
    if (!ok) return;

    setPasswordSavingId(targetUser.id);
    setError("");
    setCreateError("");
    setCreateSuccess("");

    try {
      const res = await fetch(API + "/users/" + targetUser.id, {
        method: "DELETE",
        headers,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          data?.message ||
            "\u041e\u0448\u0438\u0431\u043a\u0430 \u0443\u0434\u0430\u043b\u0435\u043d\u0438\u044f \u0441\u043e\u0442\u0440\u0443\u0434\u043d\u0438\u043a\u0430."
        );
      }

      setUsers((prev) => prev.filter((u) => u.id !== targetUser.id));
      setPermissionDrafts((prev) => {
        const next = { ...prev };
        delete next[targetUser.id];
        return next;
      });
      setCreatedPasswords((prev) => {
        const next = { ...prev };
        delete next[targetUser.id];
        if (targetUser.login) delete next[targetUser.login];
        if (targetUser.username) delete next[targetUser.username];
        if (targetUser.email) delete next[targetUser.email];
        return next;
      });
      setCreateSuccess(
        "\u0421\u043e\u0442\u0440\u0443\u0434\u043d\u0438\u043a \"" + loginLabel + "\" \u0443\u0434\u0430\u043b\u0451\u043d."
      );
    } catch (e) {
      console.error(e);
      setError(
        normalizeErrorMessage(
          e,
          "\u041e\u0448\u0438\u0431\u043a\u0430 \u0443\u0434\u0430\u043b\u0435\u043d\u0438\u044f \u0441\u043e\u0442\u0440\u0443\u0434\u043d\u0438\u043a\u0430."
        )
      );
    } finally {
      setPasswordSavingId(null);
    }
  };

  const handleCopyCredentials = async (targetUser, userId = null) => {
    const login = String(
      targetUser?.login || targetUser?.username || targetUser?.email || ""
    ).trim();
    const password = String(targetUser?.passwordVisible || "").trim();

    if (!login || !password || password === "-") {
      setError("Не удалось скопировать: логин или пароль пустой.");
      return;
    }

    try {
      await copyText(`Логин: ${login}\nПароль: ${password}`);
      setError("");
      if (userId) {
        setCopiedUserId(userId);
        if (copiedUserTimerRef.current) clearTimeout(copiedUserTimerRef.current);
        copiedUserTimerRef.current = setTimeout(() => setCopiedUserId(null), 1800);
      }
      setCreateSuccess(`Данные сотрудника "${login}" скопированы.`);
    } catch (err) {
      setError("Не удалось скопировать логин и пароль.");
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

  const filteredUsers = useMemo(() => {
    const query = String(userSearch || "").trim().toLowerCase();
    if (!query) return users;
    return users.filter((u) => {
      const haystack = [
        u.id,
        u.name,
        u.login,
        u.username,
        u.email,
        u.role,
        roleLabel(u.role),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [users, userSearch]);

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
            placeholder="Логин (например, склад_1)"
            value={newUser.login}
            onChange={(e) =>
              setNewUser((prev) => ({
                ...prev,
                login: sanitizeLoginInput(e.target.value),
              }))
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

      <div style={{ marginBottom: 12 }}>
        <input
          className="admin-input"
          type="text"
          placeholder="Поиск сотрудника: ФИО, логин, роль, ID"
          value={userSearch}
          onChange={(event) => setUserSearch(event.target.value)}
        />
      </div>

      {loading ? (
        <p>Загрузка пользователей...</p>
      ) : users.length === 0 ? (
        <p>Пользователей пока нет.</p>
      ) : filteredUsers.length === 0 ? (
        <p>Ничего не найдено по фильтру.</p>
      ) : (
        <div className="admin-table-wrapper">
          <table className="admin-table admin-table--users">
            <thead>
              <tr>
                <th style={thStyle}>ID</th>
                <th style={thStyle}>Имя</th>
                <th style={thStyle}>Логин</th>
                <th style={thStyle}>Пароль</th>
                <th style={thStyle}>Роль</th>
                <th style={thStyle}>Создан</th>
                <th style={thStyle}></th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.map((u) => {
                const draft = permissionDrafts[u.id] || buildPermissionDraft(u);
                const isExpanded = expandedUserId === u.id;
                const selectedPermissions = Array.isArray(draft.permissions)
                  ? draft.permissions
                  : [];
                const userLogin = u.login || u.username || u.email || "-";
                const userPassword =
                  u.passwordVisible ||
                  createdPasswords[u.id] ||
                  createdPasswords[u.login] ||
                  createdPasswords[u.username] ||
                  createdPasswords[u.email] ||
                  "-";

                return (
                  <Fragment key={u.id}>
                    <tr
                      ref={(node) => {
                        if (node) userRowRefs.current[u.id] = node;
                      }}
                    >
                      <td data-label="ID" style={tdStyle}>
                        {u.id}
                      </td>
                      <td data-label="Имя" style={tdStyle}>
                        {u.name}
                      </td>
                      <td data-label="Логин" style={tdStyle}>
                        {userLogin}
                      </td>
                      <td data-label="Пароль" style={tdStyle}>
                        {userPassword}
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
                          type="button"
                          className="admin-btn admin-btn--ghost admin-copy-btn"
                          title="Скопировать логин и пароль"
                          aria-label="Скопировать логин и пароль"
                          onClick={() =>
                            handleCopyCredentials({
                              login: userLogin === "-" ? "" : userLogin,
                              username: u.username,
                              email: u.email,
                              passwordVisible:
                                userPassword === "-" ? "" : userPassword,
                            }, u.id)
                          }
                          disabled={userPassword === "-"}
                        >
                          {copiedUserId === u.id ? "Скопировано" : "Скопировать"}
                        </button>
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
                          onClick={() => handleDeleteUser(u)}
                          disabled={u.isSystemOwner || u.id === user?.id || passwordSavingId === u.id}
                        >
                          {passwordSavingId === u.id
                            ? "Удаление..."
                            : "Удалить"}
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
                        <td style={{ ...tdStyle, background: "#fafcff" }} colSpan={7}>
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

