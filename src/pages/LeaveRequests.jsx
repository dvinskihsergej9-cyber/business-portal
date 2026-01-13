import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../context/AuthContext";

const API = "http://localhost:3001/api";

const STATUS_LABELS = {
  PENDING: "На согласовании",
  APPROVED: "Одобрено",
  REJECTED: "Отклонено",
};

const TYPE_LABELS = {
  ANNUAL: "Основной отпуск",
  UNPAID: "Без содержания",
  SICK: "Больничный",
};

const STATUS_OPTIONS = [
  { value: "PENDING", label: "На согласовании" },
  { value: "APPROVED", label: "Одобрено" },
  { value: "REJECTED", label: "Отклонено" },
];

export default function LeaveRequests() {
  const { user } = useAuth();
  const isHrOrAdmin = user?.role === "HR" || user?.role === "ADMIN";

  const [form, setForm] = useState({
    startDate: "",
    endDate: "",
    type: "ANNUAL",
    comment: "",
  });

  const [myRequests, setMyRequests] = useState([]);
  const [allRequests, setAllRequests] = useState([]);
  const [tab, setTab] = useState("mine");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [statusSavingId, setStatusSavingId] = useState(null);
  const [error, setError] = useState("");

  const token = localStorage.getItem("token");

  const authHeaders = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  const loadData = async () => {
    try {
      setLoading(true);
      setError("");

      const myRes = await fetch(`${API}/leave-requests/my`, {
        headers: authHeaders,
      });
      const myData = await myRes.json();
      if (!myRes.ok) {
        throw new Error(myData.message || "Ошибка загрузки ваших заявок");
      }
      setMyRequests(myData);

      if (isHrOrAdmin) {
        const allRes = await fetch(`${API}/leave-requests`, {
          headers: { Authorization: authHeaders.Authorization },
        });
        const allData = await allRes.json();
        if (!allRes.ok) {
          throw new Error(
            allData.message || "Ошибка загрузки заявок по компании"
          );
        }
        setAllRequests(allData);
      } else {
        setAllRequests([]);
      }
    } catch (e) {
      console.error(e);
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCreate = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError("");

    try {
      const res = await fetch(`${API}/leave-requests`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify(form),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || "Ошибка создания заявки");
      }

      setForm({
        startDate: "",
        endDate: "",
        type: "ANNUAL",
        comment: "",
      });

      await loadData();
    } catch (e) {
      console.error(e);
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleStatusChangeLocal = (id, newStatus) => {
    setAllRequests((prev) =>
      prev.map((r) => (r.id === id ? { ...r, status: newStatus } : r))
    );
  };

  const handleStatusSave = async (id) => {
    const req = allRequests.find((r) => r.id === id);
    if (!req) return;

    setStatusSavingId(id);
    setError("");

    try {
      const res = await fetch(`${API}/leave-requests/${id}/status`, {
        method: "PUT",
        headers: authHeaders,
        body: JSON.stringify({ status: req.status }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || "Ошибка смены статуса");
      }

      await loadData();
    } catch (e) {
      console.error(e);
      setError(e.message);
    } finally {
      setStatusSavingId(null);
    }
  };

  const stats = useMemo(() => {
    const base = { PENDING: 0, APPROVED: 0, REJECTED: 0 };
    for (const r of myRequests) {
      base[r.status] = (base[r.status] || 0) + 1;
    }
    return base;
  }, [myRequests]);

  const renderStatusBadge = (status) => {
    const label = STATUS_LABELS[status] || status;
    let cls = "badge ";
    if (status === "APPROVED") cls += "badge--approved";
    else if (status === "REJECTED") cls += "badge--rejected";
    else cls += "badge--pending";

    return <span className={cls}>{label}</span>;
  };

  const formatDate = (d) => {
    if (!d) return "-";
    const date = new Date(d);
    if (Number.isNaN(date.getTime())) return "-";
    return date.toLocaleDateString();
  };

  const formatDateTime = (d) => {
    if (!d) return "-";
    const date = new Date(d);
    if (Number.isNaN(date.getTime())) return "-";
    return date.toLocaleString();
  };

  const currentList = tab === "mine" ? myRequests : allRequests;

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Отпуска</h1>
        <p className="page-subtitle">
          Оформление отпусков и контроль статусов. Сотрудники подают заявки, HR
          и руководители согласуют.
        </p>
      </div>

      <div className="grid-2">
        {/* форма создания заявки */}
        <div className="card">
          <h2 style={{ marginTop: 0, marginBottom: 12, fontSize: 18 }}>
            Новая заявка на отпуск
          </h2>

          <form onSubmit={handleCreate}>
            <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 13 }}>
                  Дата начала
                  <input
                    type="date"
                    value={form.startDate}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, startDate: e.target.value }))
                    }
                    required
                    style={{ marginTop: 4 }}
                  />
                </label>
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 13 }}>
                  Дата окончания
                  <input
                    type="date"
                    value={form.endDate}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, endDate: e.target.value }))
                    }
                    required
                    style={{ marginTop: 4 }}
                  />
                </label>
              </div>
            </div>

            <div style={{ marginBottom: 8 }}>
              <label style={{ fontSize: 13 }}>
                Тип отпуска
                <select
                  value={form.type}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, type: e.target.value }))
                  }
                  style={{ marginTop: 4 }}
                >
                  <option value="ANNUAL">Основной отпуск</option>
                  <option value="UNPAID">Без содержания</option>
                  <option value="SICK">Больничный</option>
                </select>
              </label>
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 13 }}>
                Комментарий (необязательно)
                <textarea
                  rows={3}
                  value={form.comment}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, comment: e.target.value }))
                  }
                  style={{ marginTop: 4, resize: "vertical" }}
                />
              </label>
            </div>

            <button type="submit" disabled={saving}>
              {saving ? "Отправляем..." : "Отправить заявку"}
            </button>
          </form>
        </div>

        {/* краткая статистика по своим отпускам */}
        <div className="card">
          <h2 style={{ marginTop: 0, marginBottom: 12, fontSize: 18 }}>
            Ваши заявки
          </h2>
          <p style={{ fontSize: 14, color: "#6b7280", marginBottom: 12 }}>
            Краткая статистика по вашим отпускам.
          </p>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
              gap: 10,
              fontSize: 13,
            }}
          >
            <div
              style={{
                padding: 10,
                borderRadius: 8,
                background: "#eff6ff",
                border: "1px solid #dbeafe",
              }}
            >
              <div style={{ color: "#1d4ed8", marginBottom: 4 }}>
                На согласовании
              </div>
              <div style={{ fontSize: 18, fontWeight: 600 }}>
                {stats.PENDING || 0}
              </div>
            </div>

            <div
              style={{
                padding: 10,
                borderRadius: 8,
                background: "#ecfdf3",
                border: "1px solid #bbf7d0",
              }}
            >
              <div style={{ color: "#15803d", marginBottom: 4 }}>Одобрено</div>
              <div style={{ fontSize: 18, fontWeight: 600 }}>
                {stats.APPROVED || 0}
              </div>
            </div>

            <div
              style={{
                padding: 10,
                borderRadius: 8,
                background: "#fef2f2",
                border: "1px solid #fecaca",
              }}
            >
              <div style={{ color: "#b91c1c", marginBottom: 4 }}>
                Отклонено
              </div>
              <div style={{ fontSize: 18, fontWeight: 600 }}>
                {stats.REJECTED || 0}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* список заявок */}
      <div className="card" style={{ marginTop: 16 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
            marginBottom: 8,
          }}
        >
          <div>
            <div className="tabs">
              <button
                type="button"
                className={
                  "tabs__btn " + (tab === "mine" ? "tabs__btn--active" : "")
                }
                onClick={() => setTab("mine")}
              >
                Мои заявки
              </button>
              {isHrOrAdmin && (
                <button
                  type="button"
                  className={
                    "tabs__btn " + (tab === "all" ? "tabs__btn--active" : "")
                  }
                  onClick={() => setTab("all")}
                >
                  Все заявки (HR)
                </button>
              )}
            </div>
          </div>
        </div>

        {error && (
          <div
            style={{
              marginBottom: 10,
              padding: 8,
              borderRadius: 6,
              background: "#fee2e2",
              color: "#b91c1c",
              fontSize: 13,
            }}
          >
            {error}
          </div>
        )}

        {loading ? (
          <p style={{ fontSize: 14 }}>Загружаем заявки...</p>
        ) : currentList.length === 0 ? (
          <p style={{ fontSize: 14, color: "#6b7280" }}>
            Заявок пока нет. Создайте первую заявку на отпуск.
          </p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead>
                <tr>
                  {tab === "all" && <th>Сотрудник</th>}
                  <th>Период</th>
                  <th>Тип отпуска</th>
                  <th>Создано</th>
                  <th>Статус</th>
                  {isHrOrAdmin && tab === "all" && <th></th>}
                </tr>
              </thead>
              <tbody>
                {currentList.map((r) => (
                  <tr key={r.id}>
                    {tab === "all" && (
                      <td>
                        {r.user
                          ? `${r.user.name || ""} (${r.user.email})`
                          : "-"}
                      </td>
                    )}
                    <td>
                      {formatDate(r.startDate)} — {formatDate(r.endDate)}
                    </td>
                    <td>{TYPE_LABELS[r.type] || r.type}</td>
                    <td>{formatDateTime(r.createdAt)}</td>
                    <td>{renderStatusBadge(r.status)}</td>
                    {isHrOrAdmin && tab === "all" && (
                      <td style={{ whiteSpace: "nowrap" }}>
                        <select
                          value={r.status}
                          onChange={(e) =>
                            handleStatusChangeLocal(r.id, e.target.value)
                          }
                          style={{ width: 170, marginRight: 6 }}
                          disabled={statusSavingId === r.id}
                        >
                          {STATUS_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => handleStatusSave(r.id)}
                          disabled={statusSavingId === r.id}
                        >
                          {statusSavingId === r.id ? "Сохраняю..." : "Сохранить"}
                        </button>
                      </td>
                    )}
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
