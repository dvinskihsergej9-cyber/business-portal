import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../../apiConfig";

const LEAVE_CATEGORIES = [
  { value: "STANDARD", label: "Стандартная" },
  { value: "FAR_NORTH", label: "Крайний Север" },
  {
    value: "EQUIVALENT_NORTH",
    label: "Приравненные районы Севера",
  },
  {
    value: "OTHER_NORTH_COEF",
    label: "Другие районы Севера",
  },
  { value: "CUSTOM", label: "Пользовательская" },
];

const STATUS_OPTIONS = [
  { value: "ACTIVE", label: "Активен" },
  { value: "FIRED", label: "Уволен" },
];

function getLeaveDays(category) {
  switch (category) {
    case "FAR_NORTH":
      return 52;
    case "EQUIVALENT_NORTH":
      return 44;
    case "OTHER_NORTH_COEF":
      return 36;
    case "STANDARD":
    default:
      return 28;
  }
}

function toDateInput(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

export default function AdminHrPanel() {
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [departmentFilter, setDepartmentFilter] = useState("ALL");
  const [editEmployee, setEditEmployee] = useState(null);
  const [deleteEmployee, setDeleteEmployee] = useState(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [form, setForm] = useState({
    fullName: "",
    position: "",
    department: "",
    status: "ACTIVE",
    telegramChatId: "",
    hiredAt: "",
    birthDate: "",
    leaveRegionCategory: "STANDARD",
    annualLeaveDays: 28,
    leaveOverrideDays: "",
  });

  const authHeaders = useMemo(() => {
    const token = localStorage.getItem("token");
    return {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
  }, []);

  const loadEmployees = async () => {
    try {
      setLoading(true);
      setError("");
      const res = await apiFetch("/admin/hr/employees", {
        headers: authHeaders,
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          data.message ||
            "Ошибка загрузки списка сотрудников"
        );
      }
      setEmployees(data);
    } catch (err) {
      setError(
        err.message ||
          "Ошибка загрузки списка сотрудников"
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadEmployees();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!editEmployee) return;
    setForm({
      fullName: editEmployee.fullName || "",
      position: editEmployee.position || "",
      department: editEmployee.department || "",
      status: editEmployee.status || "ACTIVE",
      telegramChatId: editEmployee.telegramChatId || "",
      hiredAt: toDateInput(editEmployee.hiredAt),
      birthDate: toDateInput(editEmployee.birthDate),
      leaveRegionCategory: editEmployee.leaveRegionCategory || "STANDARD",
      annualLeaveDays: editEmployee.annualLeaveDays || 28,
      leaveOverrideDays:
        editEmployee.leaveOverrideDays === null
          ? ""
          : editEmployee.leaveOverrideDays || "",
    });
  }, [editEmployee]);

  const departments = useMemo(() => {
    const values = new Set();
    employees.forEach((emp) => {
      if (emp.department) values.add(emp.department);
    });
    return Array.from(values).sort();
  }, [employees]);

  const filtered = useMemo(() => {
    return employees.filter((emp) => {
      const matchesQuery = query
        ? `${emp.fullName} ${emp.position} ${emp.department}`
            .toLowerCase()
            .includes(query.toLowerCase())
        : true;
      const matchesStatus =
        statusFilter === "ALL" ? true : emp.status === statusFilter;
      const matchesDepartment =
        departmentFilter === "ALL" ? true : emp.department === departmentFilter;
      return matchesQuery && matchesStatus && matchesDepartment;
    });
  }, [employees, query, statusFilter, departmentFilter]);

  const handleSave = async () => {
    if (!editEmployee) return;
    try {
      setSaving(true);
      setError("");
      const payload = {
        fullName: form.fullName,
        position: form.position,
        department: form.department,
        status: form.status,
        telegramChatId: form.telegramChatId || null,
        hiredAt: form.hiredAt ? new Date(form.hiredAt).toISOString() : null,
        birthDate: form.birthDate ? new Date(form.birthDate).toISOString() : null,
        leaveRegionCategory: form.leaveRegionCategory,
        annualLeaveDays: Number(form.annualLeaveDays),
        leaveOverrideDays:
          form.leaveOverrideDays === ""
            ? null
            : Number(form.leaveOverrideDays),
      };
      const res = await apiFetch(
        `/admin/hr/employees/${editEmployee.id}`,
        {
          method: "PUT",
          headers: authHeaders,
          body: JSON.stringify(payload),
        }
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          data.message || "Ошибка сохранения"
        );
      }
      setEditEmployee(null);
      await loadEmployees();
    } catch (err) {
      setError(
        err.message || "Ошибка сохранения"
      );
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteEmployee) return;
    try {
      setDeleting(true);
      setError("");
      const res = await apiFetch(
        `/admin/hr/employees/${deleteEmployee.id}`,
        {
          method: "DELETE",
          headers: authHeaders,
        }
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          data.message || "Ошибка удаления"
        );
      }
      setDeleteEmployee(null);
      await loadEmployees();
    } catch (err) {
      setError(
        err.message || "Ошибка удаления"
      );
    } finally {
      setDeleting(false);
    }
  };

  const handleCategoryChange = (value) => {
    const next = value;
    setForm((prev) => {
      const nextState = { ...prev, leaveRegionCategory: next };
      if (next !== "CUSTOM") {
        nextState.annualLeaveDays = getLeaveDays(next);
      }
      return nextState;
    });
  };

  return (
    <div className="admin-console__card">
      <div className="admin-console__card-title">
        Сотрудники
      </div>
      <div className="admin-console__card-text">
        Редактирование карточек сотрудников и их отпусков.
      </div>

      <div className="admin-filters">
        <input
          className="admin-input"
          placeholder="Поиск по имени, должности, подразделению"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <select
          className="admin-select"
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value)}
        >
          <option value="ALL">Все статусы</option>
          {STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <select
          className="admin-select"
          value={departmentFilter}
          onChange={(event) => setDepartmentFilter(event.target.value)}
        >
          <option value="ALL">Все подразделения</option>
          {departments.map((dep) => (
            <option key={dep} value={dep}>
              {dep}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="admin-btn admin-btn--ghost"
          onClick={loadEmployees}
        >
          Обновить
        </button>
      </div>

      {error && <div className="admin-alert admin-alert--error">{error}</div>}
      {loading && <div className="admin-muted">Загрузка...</div>}

      {!loading && (
        <div className="admin-table-wrapper">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Сотрудник</th>
                <th>Должность</th>
                <th>Подразделение</th>
                <th>Статус</th>
                <th>Отпуск</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((emp) => (
                <tr key={emp.id}>
                  <td>
                    <div className="admin-table__title">{emp.fullName}</div>
                    <div className="admin-table__meta">ID: {emp.id}</div>
                  </td>
                  <td>{emp.position}</td>
                  <td>{emp.department}</td>
                  <td>{emp.status}</td>
                  <td>{emp.annualLeaveDays ?? "-"} дн.</td>
                  <td className="admin-table__actions">
                    <button
                      type="button"
                      className="admin-btn admin-btn--secondary"
                      onClick={() => setEditEmployee(emp)}
                    >
                      Редактировать
                    </button>
                    <button
                      type="button"
                      className="admin-btn admin-btn--danger"
                      onClick={() => setDeleteEmployee(emp)}
                    >
                      Удалить
                    </button>
                  </td>
                </tr>
              ))}
              {!filtered.length && (
                <tr>
                  <td colSpan="6" className="admin-muted">
                    Нет данных по сотрудникам.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {editEmployee && (
        <div className="admin-modal">
          <div className="admin-modal__panel">
            <div className="admin-modal__header">
              <div>
                <div className="admin-modal__title">
                  Редактировать сотрудника
                </div>
                <div className="admin-modal__subtitle">
                  {editEmployee.fullName}
                </div>
              </div>
              <button
                type="button"
                className="admin-btn admin-btn--ghost"
                onClick={() => setEditEmployee(null)}
              >
                ✕
              </button>
            </div>

            <div className="admin-form">
              <div className="admin-form__row">
                <div>
                  <label className="admin-label">ФИО</label>
                  <input
                    className="admin-input"
                    value={form.fullName}
                    onChange={(event) =>
                      setForm((prev) => ({ ...prev, fullName: event.target.value }))
                    }
                  />
                </div>
                <div>
                  <label className="admin-label">Должность</label>
                  <input
                    className="admin-input"
                    value={form.position}
                    onChange={(event) =>
                      setForm((prev) => ({ ...prev, position: event.target.value }))
                    }
                  />
                </div>
              </div>

              <div className="admin-form__row">
                <div>
                  <label className="admin-label">Подразделение</label>
                  <input
                    className="admin-input"
                    value={form.department}
                    onChange={(event) =>
                      setForm((prev) => ({ ...prev, department: event.target.value }))
                    }
                  />
                </div>
                <div>
                  <label className="admin-label">Статус</label>
                  <select
                    className="admin-select"
                    value={form.status}
                    onChange={(event) =>
                      setForm((prev) => ({ ...prev, status: event.target.value }))
                    }
                  >
                    {STATUS_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="admin-form__row">
                <div>
                  <label className="admin-label">Дата приема</label>
                  <input
                    className="admin-input"
                    type="date"
                    value={form.hiredAt}
                    onChange={(event) =>
                      setForm((prev) => ({ ...prev, hiredAt: event.target.value }))
                    }
                  />
                </div>
                <div>
                  <label className="admin-label">Дата рождения</label>
                  <input
                    className="admin-input"
                    type="date"
                    value={form.birthDate}
                    onChange={(event) =>
                      setForm((prev) => ({ ...prev, birthDate: event.target.value }))
                    }
                  />
                </div>
              </div>

              <div className="admin-form__row">
                <div>
                  <label className="admin-label">Telegram chat ID</label>
                  <input
                    className="admin-input"
                    value={form.telegramChatId}
                    onChange={(event) =>
                      setForm((prev) => ({ ...prev, telegramChatId: event.target.value }))
                    }
                  />
                </div>
                <div>
                  <label className="admin-label">Категория региона</label>
                  <select
                    className="admin-select"
                    value={form.leaveRegionCategory}
                    onChange={(event) => handleCategoryChange(event.target.value)}
                  >
                    {LEAVE_CATEGORIES.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="admin-form__row">
                <div>
                  <label className="admin-label">Итого дней отпуска</label>
                  <input
                    className="admin-input"
                    type="number"
                    min="1"
                    value={form.annualLeaveDays}
                    disabled={form.leaveRegionCategory !== "CUSTOM"}
                    onChange={(event) =>
                      setForm((prev) => ({
                        ...prev,
                        annualLeaveDays: event.target.value,
                      }))
                    }
                  />
                  <div className="admin-hint">
                    Категории соответствуют северным гарантиям (КС/приравненные/др. районы Севера).
                  </div>
                </div>
                <div>
                  <label className="admin-label">
                    Ручной ввод дней (опц.)
                  </label>
                  <input
                    className="admin-input"
                    type="number"
                    min="1"
                    value={form.leaveOverrideDays}
                    onChange={(event) =>
                      setForm((prev) => ({
                        ...prev,
                        leaveOverrideDays: event.target.value,
                      }))
                    }
                  />
                </div>
              </div>
            </div>

            <div className="admin-modal__actions">
              <button
                type="button"
                className="admin-btn admin-btn--ghost"
                onClick={() => setEditEmployee(null)}
              >
                Отмена
              </button>
              <button
                type="button"
                className="admin-btn admin-btn--primary"
                onClick={handleSave}
                disabled={saving}
              >
                {saving
                  ? "Сохранение..."
                  : "Сохранить изменения"}
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteEmployee && (
        <div className="admin-modal">
          <div className="admin-modal__panel admin-modal__panel--danger">
            <div className="admin-modal__title">
              Удалить сотрудника?
            </div>
            <div className="admin-modal__subtitle">
              {deleteEmployee.fullName}
            </div>
            <div className="admin-modal__actions">
              <button
                type="button"
                className="admin-btn admin-btn--ghost"
                onClick={() => setDeleteEmployee(null)}
              >
                Отмена
              </button>
              <button
                type="button"
                className="admin-btn admin-btn--danger"
                onClick={handleDelete}
                disabled={deleting}
              >
                {deleting
                  ? "Удаление..."
                  : "Удалить"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
