import { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { apiFetch } from "../apiConfig";
import ResponsiveDataView from "../components/ResponsiveDataView";
import useIsMobile from "../hooks/useIsMobile";

const ALL_ROLES = ["EMPLOYEE", "HR", "ACCOUNTING", "WAREHOUSE", "ADMIN"];

export default function UserManagement() {
  const { user } = useAuth();
  const isMobile = useIsMobile();
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
      const res = await apiFetch("/users", { headers });
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
      const res = await apiFetch("/admin/invites", { headers });
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
      const res = await apiFetch(`/users/${id}/role`, {
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
    if (mail.error === "MAIL_SEND_FAILED") {
      return { type: "error", text: "Не удалось отправить письмо." };
    }
    if (typeof mail.error === "string" && /^[A-Z0-9_]+$/.test(mail.error)) {
      return { type: "error", text: "Не удалось отправить письмо." };
    }
    return {
      type: "error",
      text: `Ошибка отправки: ${mail.error || "неизвестная ошибка"}`,
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
      const res = await apiFetch("/admin/invites", {
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
      const res = await apiFetch(`/admin/invites/${id}/resend`, {
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
      case "INVITES_LOAD_ERROR":
        return "Не удалось загрузить приглашения";
      case "INVITE_EMAIL_REQUIRED":
        return "Укажите адрес эл. почты";
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
      case "INVITE_SEND_ERROR":
        return "Не удалось отправить приглашение";
      case "INVITE_RESEND_ERROR":
        return "Не удалось отправить приглашение повторно";
      default:
        if (typeof code === "string" && /^[A-Z0-9_]+$/.test(code)) {
          return "Неизвестная ошибка";
        }
        return code;
    }
  };

  const inviteStatusLabel = (status) => {
    switch (status) {
      case "PENDING":
        return "Ожидает";
      case "SENT":
        return "Отправлено";
      case "ACCEPTED":
        return "Принято";
      case "EXPIRED":
        return "Просрочено";
      default:
        return status || "-";
    }
  };

  const roleLabel = (role) => {
    switch (role) {
      case "EMPLOYEE":
        return "Сотрудник";
      case "HR":
        return "Кадры";
      case "ACCOUNTING":
        return "Бухгалтерия";
      case "ADMIN":
        return "Администратор";
      case "WAREHOUSE":
        return "Склад";
      default:
        return role;
    }
  };

  const inviteStatusVariant =
    inviteStatus?.type === "success"
      ? "success"
      : inviteStatus?.type === "warning"
        ? "warning"
        : "error";

  if (user?.role !== "ADMIN") {
    return (
      <div className="admin-console__card admin-console__card--warn">
        <div className="admin-console__card-text">
          ??? ???????. ???? ?????? ???????? ?????? ??? ???? ??????????????.
        </div>
      </div>
    );
  }

  return (
    <div className="admin-console__card">
      <div className="admin-console__card-title">?????????? ??????????????</div>
      <div className="admin-console__card-text">
        ????? ????????????? ????? ????????????? ????????????? ? ?????? ?? ????.
      </div>

      <div className="admin-section">
        <div className="admin-section__title">?????????? ????????????</div>
        <div className="admin-invite-grid">
          <input
            className="admin-input"
            type="email"
            placeholder="??. ?????"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
          />
          <select
            className="admin-select"
            value={inviteRole}
            onChange={(e) => setInviteRole(e.target.value)}
          >
            {ALL_ROLES.map((r) => (
              <option key={r} value={r}>
                {roleLabel(r)}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="admin-btn admin-btn--primary"
            onClick={handleInviteSubmit}
            disabled={inviteSending}
          >
            {inviteSending ? "??????????..." : "?????????"}
          </button>
        </div>
        {invitesError && (
          <div className="admin-alert admin-alert--error">
            {mapInviteError(invitesError)}
          </div>
        )}
        {inviteStatus && (
          <div className={`admin-alert admin-alert--${inviteStatusVariant}`}>
            {inviteStatus.text}
          </div>
        )}
      </div>

      {error && <div className="admin-alert admin-alert--error">{error}</div>}

      <div className="admin-section">
        <div className="admin-section__title">???????????</div>
        {invitesLoading ? (
          <div className="admin-muted">????????...</div>
        ) : (
          <ResponsiveDataView
            isMobile={isMobile}
            cards={
              <div className="responsive-cards">
                {invites.map((inv) => (
                  <div key={inv.id} className="responsive-card">
                    <div className="responsive-card__title text-wrap">
                      {inv.email}
                    </div>
                    <div className="responsive-card__meta">
                      <span>{roleLabel(inv.role)}</span>
                      <span>{inviteStatusLabel(inv.status)}</span>
                    </div>
                    <div className="responsive-card__row">
                      <span className="responsive-card__label">Created</span>
                      <span>
                        {inv.createdAt
                          ? new Date(inv.createdAt).toLocaleString()
                          : "-"}
                      </span>
                    </div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button
                        type="button"
                        className="admin-btn admin-btn--secondary"
                        onClick={() => handleInviteResend(inv.id)}
                        disabled={inviteResendId === inv.id}
                      >
                        {inviteResendId === inv.id
                          ? "??????????..."
                          : "?????????"}
                      </button>
                    </div>
                  </div>
                ))}
                {!invites.length && (
                  <div className="responsive-card">
                    <div className="admin-muted">??????????? ???.</div>
                  </div>
                )}
              </div>
            }
            table={
              <div className="admin-table-wrapper">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>??. ?????</th>
                      <th>????</th>
                      <th>??????</th>
                      <th>??????</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {invites.map((inv) => (
                      <tr key={inv.id}>
                        <td>{inv.email}</td>
                        <td>{roleLabel(inv.role)}</td>
                        <td>{inviteStatusLabel(inv.status)}</td>
                        <td>
                          {inv.createdAt
                            ? new Date(inv.createdAt).toLocaleString()
                            : "-"}
                        </td>
                        <td className="admin-table__actions">
                          <button
                            type="button"
                            className="admin-btn admin-btn--secondary"
                            onClick={() => handleInviteResend(inv.id)}
                            disabled={inviteResendId === inv.id}
                          >
                            {inviteResendId === inv.id
                              ? "??????????..."
                              : "?????????"}
                          </button>
                        </td>
                      </tr>
                    ))}
                    {!invites.length && (
                      <tr>
                        <td colSpan="5" className="admin-muted">
                          ??????????? ???.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            }
          />
        )}
      </div>

      <div className="admin-section">
        <div className="admin-section__title">????????????</div>
        {loading ? (
          <div className="admin-muted">???????? ?????????????...</div>
        ) : (
          <ResponsiveDataView
            isMobile={isMobile}
            cards={
              <div className="responsive-cards">
                {users.map((u) => (
                  <div key={u.id} className="responsive-card">
                    <div className="responsive-card__title text-wrap">
                      {u.name || "-"}
                    </div>
                    <div className="responsive-card__meta">
                      <span>{u.email}</span>
                      <span>ID: {u.id}</span>
                    </div>
                    <div className="responsive-card__row">
                      <span className="responsive-card__label">Role</span>
                      <select
                        className="admin-select"
                        value={u.role}
                        onChange={(e) =>
                          handleRoleChangeLocal(u.id, e.target.value)
                        }
                        disabled={savingId === u.id}
                      >
                        {ALL_ROLES.map((r) => (
                          <option key={r} value={r}>
                            {roleLabel(r)}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="responsive-card__row">
                      <span className="responsive-card__label">Created</span>
                      <span>
                        {u.createdAt ? new Date(u.createdAt).toLocaleString() : "-"}
                      </span>
                    </div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button
                        type="button"
                        className="admin-btn admin-btn--primary"
                        onClick={() => handleSaveRole(u.id)}
                        disabled={savingId === u.id}
                      >
                        {savingId === u.id ? "?????????..." : "?????????"}
                      </button>
                    </div>
                  </div>
                ))}
                {!users.length && (
                  <div className="responsive-card">
                    <div className="admin-muted">????????????? ???.</div>
                  </div>
                )}
              </div>
            }
            table={
              <div className="admin-table-wrapper">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>???</th>
                      <th>??. ?????</th>
                      <th>????</th>
                      <th>??????</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((u) => (
                      <tr key={u.id}>
                        <td>{u.id}</td>
                        <td>{u.name}</td>
                        <td>{u.email}</td>
                        <td>
                          <select
                            className="admin-select"
                            value={u.role}
                            onChange={(e) =>
                              handleRoleChangeLocal(u.id, e.target.value)
                            }
                            disabled={savingId === u.id}
                          >
                            {ALL_ROLES.map((r) => (
                              <option key={r} value={r}>
                                {roleLabel(r)}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          {u.createdAt
                            ? new Date(u.createdAt).toLocaleString()
                            : "-"}
                        </td>
                        <td className="admin-table__actions">
                          <button
                            type="button"
                            className="admin-btn admin-btn--secondary"
                            onClick={() => handleSaveRole(u.id)}
                            disabled={savingId === u.id}
                          >
                            {savingId === u.id ? "?????????..." : "?????????"}
                          </button>
                        </td>
                      </tr>
                    ))}
                    {!users.length && (
                      <tr>
                        <td colSpan="6" className="admin-muted">
                          ????????????? ???.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            }
          />
        )}
      </div>
    </div>
  );
}
