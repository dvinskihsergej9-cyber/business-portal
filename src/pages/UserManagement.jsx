import { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";

const API = "http://localhost:3001/api";

const ALL_ROLES = ["EMPLOYEE", "HR", "ACCOUNTING", "WAREHOUSE", "ADMIN"];

const inviteStatusStyles = {
  success: { background: "#e6ffed", color: "#146c2e" },
  warning: { background: "#fff4e5", color: "#8a5a00" },
  error: { background: "#ffe6e6", color: "#b00020" },
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
  const [inviteStatus, setInviteStatus] = useState(null);

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
        throw new Error(
          data.message || "Ошибка загрузки списка пользователей"
        );
      }
      setUsers(data);
    } catch (e) {
      console.error(e);
      setError(e.message);
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
      setInvitesError(e.message);
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
        throw new Error(data.message || "Ошибка сохранения роли");
      }

      setUsers((prev) =>
        prev.map((u) => (u.id === id ? { ...u, ...data.user } : u))
      );
    } catch (e) {
      console.error(e);
      setError(e.message);
    } finally {
      setSavingId(null);
    }
  };

  const formatInviteStatus = (mail) => {
    if (!mail) return null;
    if (mail.sent) {
      return { type: "success", text: "Письмо отправлено." };
    }
    if (mail.error === "MAIL_DISABLED") {
      return { type: "warning", text: "SMTP не настроен. Письмо не отправлено." };
    }
    return {
      type: "error",
      text: `Ошибка отправки: ${mail.error || "MAIL_SEND_FAILED"}`,
    };
  };

  const handleInviteSubmit = async () => {
    if (!inviteEmail) {
      setInvitesError("INVITE_EMAIL_REQUIRED");
      return;
    }
    setInvitesError("");
    setInviteStatus(null);
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
      setInviteStatus(formatInviteStatus(data.mail));
      await loadInvites();
    } catch (e) {
      console.error(e);
      setInvitesError(e.message);
    } finally {
      setInviteSending(false);
    }
  };

  const handleInviteResend = async (id) => {
    setInviteResendId(id);
    setInvitesError("");
    setInviteStatus(null);
    try {
      const res = await fetch(`${API}/admin/invites/${id}/resend`, {
        method: "POST",
        headers,
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || "INVITE_RESEND_ERROR");
      }
      setInviteStatus(formatInviteStatus(data.mail));
      await loadInvites();
    } catch (e) {
      console.error(e);
      setInvitesError(e.message);
    } finally {
      setInviteResendId(null);
    }
  };

  const mapInviteError = (code) => {
    switch (code) {
      case "INVITE_EMAIL_REQUIRED":
        return "Укажите email";
      case "BAD_INVITE":
        return "Некорректные данные";
      case "EMAIL_ALREADY_EXISTS":
        return "Аккаунт с этой почтой уже существует";
      case "INVITE_RATE_LIMIT":
        return "Слишком часто. Попробуйте позже";
      case "INVITE_GLOBAL_LIMIT":
        return "Превышен общий лимит отправки";
      case "INVITE_NOT_FOUND":
        return "Приглашение не найдено";
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
      case "WAREHOUSE":
        return "Склад";
      default:
        return role;
    }
  };

  if (user?.role !== "ADMIN") {
    return (
      <div style={{ padding: 24 }}>
        Нет доступа. Этот раздел доступен только для роли ADMIN.
      </div>
    );
  }

  return (
    <div style={{ padding: 24 }}>
      <h1>Управление пользователями</h1>
      <div style={{ marginBottom: 12, color: "#475569" }}>
        Здесь администратор может просматривать пользователей и менять их роли.
      </div>

      <div
        style={{
          marginTop: 16,
          marginBottom: 16,
          padding: 12,
          borderRadius: 8,
          background: "#fff",
          border: "1px solid #e5e7eb",
          boxShadow: "0 1px 2px rgba(15,23,42,0.06)",
        }}
      >
        <div style={{ fontWeight: 600, marginBottom: 8 }}>
          Пригласить пользователя
        </div>
        <div style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr 220px auto" }}>
          <input
            type="email"
            placeholder="Email"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            style={{ padding: 8 }}
          />
          <select
            value={inviteRole}
            onChange={(e) => setInviteRole(e.target.value)}
            style={{ padding: 8 }}
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
            style={{
              padding: "8px 14px",
              background: "#1976d2",
              color: "#fff",
              border: "none",
              cursor: "pointer",
            }}
          >
            {inviteSending ? "Отправляем..." : "Отправить"}
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
        {inviteStatus && (
          <div
            style={{
              marginTop: 10,
              padding: 8,
              borderRadius: 4,
              ...(inviteStatusStyles[inviteStatus.type] || inviteStatusStyles.error),
            }}
          >
            {inviteStatus.text}
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
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              background: "#fff",
              borderRadius: 8,
              overflow: "hidden",
              boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
            }}
          >
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
                  <td style={tdStyle}>{inv.email}</td>
                  <td style={tdStyle}>
                    {roleLabel(inv.role)} ({inv.role})
                  </td>
                  <td style={tdStyle}>{inv.status}</td>
                  <td style={tdStyle}>
                    {inv.createdAt
                      ? new Date(inv.createdAt).toLocaleString()
                      : "-"}
                  </td>
                  <td style={tdStyle}>
                    <button
                      type="button"
                      onClick={() => handleInviteResend(inv.id)}
                      disabled={inviteResendId === inv.id}
                    >
                      {inviteResendId === inv.id ? "Отправляем..." : "Повторить"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {loading ? (
        <p>Загрузка пользователей...</p>
      ) : users.length === 0 ? (
        <p>Пользователей пока нет.</p>
      ) : (
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            marginTop: 16,
            background: "#fff",
            borderRadius: 8,
            overflow: "hidden",
            boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
          }}
        >
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
                <td style={tdStyle}>{u.id}</td>
                <td style={tdStyle}>{u.name}</td>
                <td style={tdStyle}>{u.email}</td>
                <td style={tdStyle}>
                  <select
                    value={u.role}
                    onChange={(e) => handleRoleChangeLocal(u.id, e.target.value)}
                    style={{ padding: 4 }}
                    disabled={savingId === u.id}
                  >
                    {ALL_ROLES.map((r) => (
                      <option key={r} value={r}>
                        {roleLabel(r)} ({r})
                      </option>
                    ))}
                  </select>
                </td>
                <td style={tdStyle}>
                  {u.createdAt ? new Date(u.createdAt).toLocaleString() : "-"}
                </td>
                <td style={tdStyle}>
                  <button
                    onClick={() => handleSaveRole(u.id)}
                    disabled={savingId === u.id}
                  >
                    {savingId === u.id ? "Сохраняем..." : "Сохранить"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
