import { useEffect, useState } from "react";
import { API_BASE, normalizeErrorMessage } from "../apiConfig";
import { useAuth } from "../context/AuthContext";

const API = API_BASE;

const ALL_ROLES = ["EMPLOYEE", "HR", "ACCOUNTING", "WAREHOUSE", "ADMIN"];

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
    case "ADMIN":
      return "Админ";
    default:
      return role;
  }
};

export default function UserManagement() {
  const { user } = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null);
  const [error, setError] = useState("");

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("EMPLOYEE");
  const [invites, setInvites] = useState([]);
  const [invitesLoading, setInvitesLoading] = useState(true);
  const [invitesError, setInvitesError] = useState("");
  const [inviteSending, setInviteSending] = useState(false);
  const [inviteResendId, setInviteResendId] = useState(null);

  const token = localStorage.getItem("token");
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
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
      setUsers(data);
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
    loadUsers();
    loadInvites();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRoleChangeLocal = (id, newRole) => {
    setUsers((prev) =>
      prev.map((u) => (u.id === id ? { ...u, role: newRole } : u))
    );
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

      setUsers((prev) =>
        prev.map((u) => (u.id === id ? { ...u, ...data.user } : u))
      );
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
        Здесь администратор может просматривать пользователей и менять их роли.
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
              {users.map((u) => (
                <tr key={u.id}>
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
                      disabled={savingId === u.id}
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
                      disabled={savingId === u.id}
                      className="admin-btn admin-btn--primary"
                    >
                      {savingId === u.id ? "Сохранение..." : "Сохранить"}
                    </button>
                  </td>
                </tr>
              ))}
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
