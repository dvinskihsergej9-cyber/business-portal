import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { apiFetch } from "../apiConfig";

const STATUS_LABELS = {
  NEW: "Новая",
  APPROVED: "Одобрено",
  PAID: "Оплачено",
  REJECTED: "Отклонено",
};

const TYPE_LABELS = {
  PAYMENT: "Оплата счета",
  PURCHASE: "Закупка",
  OTHER: "Прочее",
};

const STATUS_OPTIONS = [
  { value: "NEW", label: "Новая" },
  { value: "APPROVED", label: "Одобрено" },
  { value: "PAID", label: "Оплачено" },
  { value: "REJECTED", label: "Отклонено" },
];

export default function PaymentRequests() {
  const { user } = useAuth();
  const isAccounting = user?.role === "ACCOUNTING" || user?.role === "ADMIN";

  const [form, setForm] = useState({
    type: "PAYMENT",
    purpose: "",
    amount: "",
    currency: "RUB",
    expenseCode: "",
    desiredDate: "",
    counterparty: "",
    comment: "",
  });

  const [myList, setMyList] = useState([]);
  const [allList, setAllList] = useState([]);
  const [tab, setTab] = useState("mine");

  const [filterStatus, setFilterStatus] = useState("ALL");
  const [filterText, setFilterText] = useState("");

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

      // мои заявки
      const myRes = await apiFetch("/payment-requests/my", {
        headers: authHeaders,
      });
      const myData = await myRes.json();
      if (!myRes.ok) {
        throw new Error(myData.message || "Ошибка загрузки ваших заявок");
      }
      setMyList(myData);

      // все заявки (для бухгалтера / админа)
      if (isAccounting) {
        const allRes = await apiFetch("/payment-requests", {
          headers: { Authorization: authHeaders.Authorization },
        });
        const allData = await allRes.json();
        if (!allRes.ok) {
          throw new Error(
            allData.message || "Ошибка загрузки заявок по компании"
          );
        }
        setAllList(allData);
      } else {
        setAllList([]);
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
      const body = {
        purpose: `${TYPE_LABELS[form.type]}: ${form.purpose}`.trim(),
        amount: form.amount,
        currency: form.currency,
        expenseCode: form.expenseCode,
        desiredDate: form.desiredDate,
        counterparty: form.counterparty,
        comment: form.comment,
      };

      const res = await apiFetch("/payment-requests", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || "Ошибка создания заявки");
      }

      setForm({
        type: "PAYMENT",
        purpose: "",
        amount: "",
        currency: "RUB",
        expenseCode: "",
        desiredDate: "",
        counterparty: "",
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
    setAllList((prev) =>
      prev.map((r) => (r.id === id ? { ...r, status: newStatus } : r))
    );
  };

  const handleStatusSave = async (id) => {
    const row = allList.find((r) => r.id === id);
    if (!row) return;

    const accountingComment =
      prompt("Комментарий бухгалтерии (необязательно):") || undefined;

    setStatusSavingId(id);
    setError("");

    try {
      const res = await apiFetch(`/payment-requests/${id}/status`, {
        method: "PUT",
        headers: authHeaders,
        body: JSON.stringify({
          status: row.status,
          accountingComment,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || "Ошибка изменения статуса");
      }

      await loadData();
    } catch (e) {
      console.error(e);
      setError(e.message);
    } finally {
      setStatusSavingId(null);
    }
  };

  const statusBadgeClass = (status) => {
    if (status === "REJECTED") return "badge badge--rejected";
    if (status === "APPROVED" || status === "PAID")
      return "badge badge--approved";
    return "badge badge--pending"; // NEW
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

  // сводка по моим заявкам
  const myStats = useMemo(() => {
    const base = {
      NEW: { count: 0, sum: 0 },
      APPROVED: { count: 0, sum: 0 },
      PAID: { count: 0, sum: 0 },
      REJECTED: { count: 0, sum: 0 },
    };
    for (const r of myList) {
      if (!base[r.status]) continue;
      base[r.status].count += 1;
      base[r.status].sum += Number(r.amount) || 0;
    }
    return base;
  }, [myList]);

  const listForTab = tab === "mine" ? myList : allList;

  const filteredList = useMemo(() => {
    let res = listForTab;

    if (filterStatus !== "ALL") {
      res = res.filter((r) => r.status === filterStatus);
    }

    if (filterText.trim()) {
      const q = filterText.trim().toLowerCase();
      res = res.filter((r) => {
        const source = [
          r.purpose,
          r.expenseCode,
          r.counterparty,
          r.user?.name,
          r.user?.email,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return source.includes(q);
      });
    }

    return res;
  }, [listForTab, filterStatus, filterText]);

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Заявки на оплату</h1>
        <p className="page-subtitle">
          Сотрудники оформляют запросы на оплату счетов и закупок. Бухгалтерия
          фиксирует решения и факты оплаты.
        </p>
      </div>

      <div className="grid-2">
        {/* форма заявки */}
        <div className="card">
          <h2 style={{ marginTop: 0, marginBottom: 12, fontSize: 18 }}>
            Новая заявка
          </h2>
          <form onSubmit={handleCreate}>
            <div style={{ marginBottom: 8 }}>
              <label style={{ fontSize: 13 }}>
                Тип заявки
                <select
                  value={form.type}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, type: e.target.value }))
                  }
                  style={{ marginTop: 4 }}
                >
                  <option value="PAYMENT">Оплата счета</option>
                  <option value="PURCHASE">Закупка</option>
                  <option value="OTHER">Прочее</option>
                </select>
              </label>
            </div>

            <div style={{ marginBottom: 8 }}>
              <label style={{ fontSize: 13 }}>
                Назначение / описание
                <input
                  type="text"
                  value={form.purpose}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, purpose: e.target.value }))
                  }
                  required
                  style={{ marginTop: 4 }}
                />
              </label>
            </div>

            <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 13 }}>
                  Сумма
                  <input
                    type="number"
                    step="0.01"
                    value={form.amount}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, amount: e.target.value }))
                    }
                    required
                    style={{ marginTop: 4 }}
                  />
                </label>
              </div>
              <div style={{ width: 120 }}>
                <label style={{ fontSize: 13 }}>
                  Валюта
                  <input
                    type="text"
                    value={form.currency}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, currency: e.target.value }))
                    }
                    style={{ marginTop: 4 }}
                  />
                </label>
              </div>
            </div>

            <div style={{ marginBottom: 8 }}>
              <label style={{ fontSize: 13 }}>
                Статья расходов
                <input
                  type="text"
                  value={form.expenseCode}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, expenseCode: e.target.value }))
                  }
                  placeholder="Например: Маркетинг / Аренда / IT"
                  style={{ marginTop: 4 }}
                />
              </label>
            </div>

            <div style={{ marginBottom: 8 }}>
              <label style={{ fontSize: 13 }}>
                Желаемая дата оплаты
                <input
                  type="date"
                  value={form.desiredDate}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, desiredDate: e.target.value }))
                  }
                  style={{ marginTop: 4 }}
                />
              </label>
            </div>

            <div style={{ marginBottom: 8 }}>
              <label style={{ fontSize: 13 }}>
                Контрагент / счет №
                <input
                  type="text"
                  value={form.counterparty}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, counterparty: e.target.value }))
                  }
                  style={{ marginTop: 4 }}
                />
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

        {/* сводка по моим заявкам */}
        <div className="card">
          <h2 style={{ marginTop: 0, marginBottom: 12, fontSize: 18 }}>
            Ваша статистика
          </h2>
          <p style={{ fontSize: 14, color: "#6b7280", marginBottom: 12 }}>
            Сводка по вашим заявкам на оплату.
          </p>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
              gap: 10,
              fontSize: 13,
            }}
          >
            <StatCard
              label="Новые"
              count={myStats.NEW.count}
              sum={myStats.NEW.sum}
            />
            <StatCard
              label="Одобренные"
              count={myStats.APPROVED.count}
              sum={myStats.APPROVED.sum}
            />
            <StatCard
              label="Оплаченные"
              count={myStats.PAID.count}
              sum={myStats.PAID.sum}
            />
            <StatCard
              label="Отклонённые"
              count={myStats.REJECTED.count}
              sum={myStats.REJECTED.sum}
            />
          </div>
        </div>
      </div>

      {/* список заявок с табами и фильтрами */}
      <div className="card" style={{ marginTop: 16 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 12,
            marginBottom: 10,
            alignItems: "center",
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
              {isAccounting && (
                <button
                  type="button"
                  className={
                    "tabs__btn " + (tab === "all" ? "tabs__btn--active" : "")
                  }
                  onClick={() => setTab("all")}
                >
                  Все заявки (бухгалтерия)
                </button>
              )}
            </div>
          </div>

          <div
            style={{
              display: "flex",
              gap: 8,
              alignItems: "center",
              minWidth: 260,
            }}
          >
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
            >
              <option value="ALL">Все статусы</option>
              <option value="NEW">Новые</option>
              <option value="APPROVED">Одобренные</option>
              <option value="PAID">Оплаченные</option>
              <option value="REJECTED">Отклонённые</option>
            </select>
            <input
              type="text"
              placeholder="Поиск по назначению/контрагенту"
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
            />
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
        ) : filteredList.length === 0 ? (
          <p style={{ fontSize: 14, color: "#6b7280" }}>
            Заявок не найдено по текущим фильтрам.
          </p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead>
                <tr>
                  {tab === "all" && <th>Сотрудник</th>}
                  <th>Создано</th>
                  <th>Назначение</th>
                  <th>Сумма</th>
                  <th>Желаемая дата</th>
                  <th>Статья</th>
                  <th>Статус</th>
                  {tab === "all" && <th>Комментарий</th>}
                  {isAccounting && tab === "all" && <th></th>}
                </tr>
              </thead>
              <tbody>
                {filteredList.map((r) => (
                  <tr key={r.id}>
                    {tab === "all" && (
                      <td>
                        {r.user?.name || "-"}
                        <br />
                        <span
                          style={{ fontSize: 12, color: "#6b7280" }}
                        >
                          {r.user?.email}
                        </span>
                      </td>
                    )}
                    <td>{formatDateTime(r.createdAt)}</td>
                    <td>{r.purpose}</td>
                    <td>
                      {r.amount} {r.currency}
                    </td>
                    <td>{formatDate(r.desiredDate)}</td>
                    <td>{r.expenseCode || "-"}</td>
                    <td>
                      <span className={statusBadgeClass(r.status)}>
                        {STATUS_LABELS[r.status] || r.status}
                      </span>
                    </td>
                    {tab === "all" && (
                      <td>
                        <div style={{ fontSize: 13 }}>
                          {r.comment && (
                            <div style={{ marginBottom: 4 }}>
                              <span style={{ color: "#6b7280" }}>
                                От сотрудника:
                              </span>{" "}
                              {r.comment}
                            </div>
                          )}
                          {r.accountingComment && (
                            <div>
                              <span style={{ color: "#6b7280" }}>
                                Бухгалтерия:
                              </span>{" "}
                              {r.accountingComment}
                            </div>
                          )}
                          {!r.comment && !r.accountingComment && "-"}
                        </div>
                      </td>
                    )}
                    {isAccounting && tab === "all" && (
                      <td style={{ whiteSpace: "nowrap" }}>
                        <select
                          value={r.status}
                          onChange={(e) =>
                            handleStatusChangeLocal(r.id, e.target.value)
                          }
                          style={{ width: 150, marginRight: 6 }}
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
                          {statusSavingId === r.id
                            ? "Сохраняю..."
                            : "Сохранить"}
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

function StatCard({ label, count, sum }) {
  return (
    <div
      style={{
        padding: 10,
        borderRadius: 8,
        background: "#f9fafb",
        border: "1px solid #e5e7eb",
      }}
    >
      <div style={{ marginBottom: 4, fontSize: 13, color: "#6b7280" }}>
        {label}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <div style={{ fontSize: 18, fontWeight: 600 }}>{count}</div>
        <div style={{ textAlign: "right", fontSize: 12 }}>
          <div style={{ color: "#6b7280" }}>Сумма</div>
          <div style={{ fontWeight: 500 }}>
            {sum.toLocaleString("ru-RU", {
              minimumFractionDigits: 0,
              maximumFractionDigits: 2,
            })}{" "}
            ₽
          </div>
        </div>
      </div>
    </div>
  );
}
