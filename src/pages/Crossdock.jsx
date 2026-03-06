import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch, normalizeErrorMessage } from "../apiConfig";
import { useAuth } from "../context/AuthContext";
import { hasPermission, PERMISSION_KEYS } from "../utils/permissions";

const TABS = {
  DOCKS: "DOCKS",
  OPERATIONS: "OPERATIONS",
};

const DIRECTION_OPTIONS = [
  { value: "INBOUND", label: "Входящий" },
  { value: "OUTBOUND", label: "Исходящий" },
];

const STATUS_OPTIONS = [
  { value: "PLANNED", label: "Запланировано" },
  { value: "ARRIVED", label: "Прибыло" },
  { value: "AT_DOCK", label: "У дока" },
  { value: "IN_PROGRESS", label: "В работе" },
  { value: "DONE", label: "Завершено" },
  { value: "CANCELLED", label: "Отменено" },
];

const STATUS_LABELS = Object.fromEntries(
  STATUS_OPTIONS.map((option) => [option.value, option.label])
);

const DIRECTION_LABELS = Object.fromEntries(
  DIRECTION_OPTIONS.map((option) => [option.value, option.label])
);

function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("ru-RU");
}

function getNextStatusActions(status) {
  if (status === "PLANNED") {
    return [{ status: "ARRIVED", label: "Прибыло" }, { status: "CANCELLED", label: "Отмена" }];
  }
  if (status === "ARRIVED") {
    return [{ status: "AT_DOCK", label: "К доку" }, { status: "CANCELLED", label: "Отмена" }];
  }
  if (status === "AT_DOCK") {
    return [{ status: "IN_PROGRESS", label: "Старт" }, { status: "CANCELLED", label: "Отмена" }];
  }
  if (status === "IN_PROGRESS") {
    return [{ status: "DONE", label: "Завершить" }, { status: "CANCELLED", label: "Отмена" }];
  }
  return [];
}

const EMPTY_DOCK_FORM = {
  code: "",
  name: "",
  note: "",
};

const EMPTY_OPERATION_FORM = {
  direction: "INBOUND",
  dockId: "",
  referenceNumber: "",
  partnerName: "",
  truckNumber: "",
  cargoSummary: "",
  plannedAt: "",
  note: "",
};

export default function Crossdock() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState(TABS.DOCKS);

  const [docks, setDocks] = useState([]);
  const [docksLoading, setDocksLoading] = useState(false);
  const [dockForm, setDockForm] = useState(EMPTY_DOCK_FORM);
  const [dockFormBusy, setDockFormBusy] = useState(false);

  const [operations, setOperations] = useState([]);
  const [operationsLoading, setOperationsLoading] = useState(false);
  const [operationForm, setOperationForm] = useState(EMPTY_OPERATION_FORM);
  const [operationFormBusy, setOperationFormBusy] = useState(false);

  const [filters, setFilters] = useState({
    direction: "",
    status: "",
    dockId: "",
    q: "",
    dateFrom: "",
    dateTo: "",
  });

  const [error, setError] = useState("");

  const headers = useMemo(() => {
    const token = localStorage.getItem("token");
    return {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
  }, []);

  const isManager = useMemo(
    () =>
      user?.role === "ADMIN" ||
      hasPermission(user, PERMISSION_KEYS.WAREHOUSE_MANAGE),
    [user]
  );

  const loadDocks = useCallback(async () => {
    try {
      setDocksLoading(true);
      const response = await apiFetch("/crossdock/docks", { headers });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.message || "Ошибка загрузки доков.");
      }
      setDocks(Array.isArray(data.items) ? data.items : []);
    } catch (err) {
      setError(normalizeErrorMessage(err, "Ошибка загрузки доков."));
    } finally {
      setDocksLoading(false);
    }
  }, [headers]);

  const loadOperations = useCallback(async () => {
    try {
      setOperationsLoading(true);
      const query = new URLSearchParams();
      if (filters.direction) query.set("direction", filters.direction);
      if (filters.status) query.set("status", filters.status);
      if (filters.dockId) query.set("dockId", filters.dockId);
      if (filters.q) query.set("q", filters.q);
      if (filters.dateFrom) query.set("dateFrom", filters.dateFrom);
      if (filters.dateTo) query.set("dateTo", filters.dateTo);
      query.set("limit", "100");

      const response = await apiFetch(`/crossdock/operations?${query.toString()}`, {
        headers,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.message || "Ошибка загрузки операций.");
      }
      setOperations(Array.isArray(data.items) ? data.items : []);
    } catch (err) {
      setError(normalizeErrorMessage(err, "Ошибка загрузки операций."));
    } finally {
      setOperationsLoading(false);
    }
  }, [filters, headers]);

  useEffect(() => {
    loadDocks();
  }, [loadDocks]);

  useEffect(() => {
    if (activeTab === TABS.OPERATIONS) {
      loadOperations();
    }
  }, [activeTab, loadOperations]);

  const handleCreateDock = async (event) => {
    event.preventDefault();
    try {
      setDockFormBusy(true);
      setError("");
      const response = await apiFetch("/crossdock/docks", {
        method: "POST",
        headers,
        body: JSON.stringify(dockForm),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.message || "Ошибка создания дока.");
      }
      setDockForm(EMPTY_DOCK_FORM);
      await loadDocks();
    } catch (err) {
      setError(normalizeErrorMessage(err, "Ошибка создания дока."));
    } finally {
      setDockFormBusy(false);
    }
  };

  const handleDockToggle = async (dock) => {
    try {
      setError("");
      const response = await apiFetch(`/crossdock/docks/${dock.id}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ isActive: !dock.isActive }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.message || "Ошибка обновления дока.");
      }
      await loadDocks();
    } catch (err) {
      setError(normalizeErrorMessage(err, "Ошибка обновления дока."));
    }
  };

  const handleCreateOperation = async (event) => {
    event.preventDefault();
    try {
      setOperationFormBusy(true);
      setError("");
      const payload = {
        ...operationForm,
        dockId: operationForm.dockId ? Number(operationForm.dockId) : null,
        plannedAt: operationForm.plannedAt || null,
      };
      const response = await apiFetch("/crossdock/operations", {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.message || "Ошибка создания операции.");
      }
      setOperationForm(EMPTY_OPERATION_FORM);
      setActiveTab(TABS.OPERATIONS);
      await loadOperations();
    } catch (err) {
      setError(normalizeErrorMessage(err, "Ошибка создания операции."));
    } finally {
      setOperationFormBusy(false);
    }
  };

  const handleChangeStatus = async (operationId, status) => {
    try {
      setError("");
      const response = await apiFetch(`/crossdock/operations/${operationId}/status`, {
        method: "POST",
        headers,
        body: JSON.stringify({ status }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.message || "Ошибка изменения статуса.");
      }
      await loadOperations();
    } catch (err) {
      setError(normalizeErrorMessage(err, "Ошибка изменения статуса."));
    }
  };

  return (
    <div className="crossdock-page">
      <div className="card">
        <h1 className="page-title" style={{ marginBottom: 4 }}>
          Кросс-докинг
        </h1>
        <p className="page-subtitle" style={{ marginBottom: 12 }}>
          Управление доками и быстрыми операциями перегруза без размещения в хранение.
        </p>

        <div className="tabs tabs--sm" style={{ marginBottom: 16 }}>
          <button
            type="button"
            className={`tabs__btn ${activeTab === TABS.DOCKS ? "tabs__btn--active" : ""}`}
            onClick={() => setActiveTab(TABS.DOCKS)}
          >
            Доки
          </button>
          <button
            type="button"
            className={`tabs__btn ${activeTab === TABS.OPERATIONS ? "tabs__btn--active" : ""}`}
            onClick={() => setActiveTab(TABS.OPERATIONS)}
          >
            Операции
          </button>
        </div>

        {error && <div className="crossdock-alert crossdock-alert--error">{error}</div>}

        {activeTab === TABS.DOCKS && (
          <div className="crossdock-grid">
            {isManager && (
              <form className="card crossdock-card" onSubmit={handleCreateDock}>
                <div className="crossdock-card__title">Новый док</div>
                <div className="crossdock-form">
                  <label>
                    Код дока
                    <input
                      type="text"
                      value={dockForm.code}
                      onChange={(event) =>
                        setDockForm((prev) => ({ ...prev, code: event.target.value }))
                      }
                      placeholder="Например: D-01"
                      required
                    />
                  </label>
                  <label>
                    Название
                    <input
                      type="text"
                      value={dockForm.name}
                      onChange={(event) =>
                        setDockForm((prev) => ({ ...prev, name: event.target.value }))
                      }
                      placeholder="Зона приемки"
                    />
                  </label>
                  <label>
                    Комментарий
                    <textarea
                      rows={3}
                      value={dockForm.note}
                      onChange={(event) =>
                        setDockForm((prev) => ({ ...prev, note: event.target.value }))
                      }
                      placeholder="Примечание по доку"
                    />
                  </label>
                  <button type="submit" className="btn btn--primary" disabled={dockFormBusy}>
                    {dockFormBusy ? "Сохранение..." : "Создать док"}
                  </button>
                </div>
              </form>
            )}

            <div className="card crossdock-card">
              <div className="crossdock-card__header">
                <div className="crossdock-card__title">Список доков</div>
                <button
                  type="button"
                  className="btn btn--secondary"
                  onClick={loadDocks}
                  disabled={docksLoading}
                >
                  Обновить
                </button>
              </div>

              <div className="table-wrapper">
                <table>
                  <thead>
                    <tr>
                      <th>Код</th>
                      <th>Название</th>
                      <th>Статус</th>
                      {isManager && <th>Действие</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {docks.map((dock) => (
                      <tr key={dock.id}>
                        <td>{dock.code}</td>
                        <td>{dock.name || "—"}</td>
                        <td>
                          <span
                            className={`crossdock-status ${
                              dock.isActive
                                ? "crossdock-status--active"
                                : "crossdock-status--inactive"
                            }`}
                          >
                            {dock.isActive ? "Активен" : "Отключен"}
                          </span>
                        </td>
                        {isManager && (
                          <td>
                            <button
                              type="button"
                              className="btn btn--secondary"
                              onClick={() => handleDockToggle(dock)}
                            >
                              {dock.isActive ? "Отключить" : "Включить"}
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                    {docks.length === 0 && (
                      <tr>
                        <td colSpan={isManager ? 4 : 3}>Записей пока нет.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {activeTab === TABS.OPERATIONS && (
          <div className="crossdock-stack">
            <div className="card crossdock-card">
              <div className="crossdock-card__title">Фильтры</div>
              <div className="crossdock-filters">
                <label>
                  Направление
                  <select
                    value={filters.direction}
                    onChange={(event) =>
                      setFilters((prev) => ({ ...prev, direction: event.target.value }))
                    }
                  >
                    <option value="">Все</option>
                    {DIRECTION_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  Статус
                  <select
                    value={filters.status}
                    onChange={(event) =>
                      setFilters((prev) => ({ ...prev, status: event.target.value }))
                    }
                  >
                    <option value="">Все</option>
                    {STATUS_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  Док
                  <select
                    value={filters.dockId}
                    onChange={(event) =>
                      setFilters((prev) => ({ ...prev, dockId: event.target.value }))
                    }
                  >
                    <option value="">Все</option>
                    {docks.map((dock) => (
                      <option key={dock.id} value={dock.id}>
                        {dock.code}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  Поиск
                  <input
                    type="text"
                    value={filters.q}
                    onChange={(event) =>
                      setFilters((prev) => ({ ...prev, q: event.target.value }))
                    }
                    placeholder="Номер, контрагент, авто"
                  />
                </label>

                <label>
                  План: с
                  <input
                    type="date"
                    value={filters.dateFrom}
                    onChange={(event) =>
                      setFilters((prev) => ({ ...prev, dateFrom: event.target.value }))
                    }
                  />
                </label>

                <label>
                  по
                  <input
                    type="date"
                    value={filters.dateTo}
                    onChange={(event) =>
                      setFilters((prev) => ({ ...prev, dateTo: event.target.value }))
                    }
                  />
                </label>
              </div>
              <div className="crossdock-actions">
                <button
                  type="button"
                  className="btn btn--secondary"
                  onClick={loadOperations}
                  disabled={operationsLoading}
                >
                  Обновить список
                </button>
              </div>
            </div>

            {isManager && (
              <form className="card crossdock-card" onSubmit={handleCreateOperation}>
                <div className="crossdock-card__title">Новая операция</div>
                <div className="crossdock-filters">
                  <label>
                    Направление
                    <select
                      value={operationForm.direction}
                      onChange={(event) =>
                        setOperationForm((prev) => ({ ...prev, direction: event.target.value }))
                      }
                    >
                      {DIRECTION_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label>
                    Док
                    <select
                      value={operationForm.dockId}
                      onChange={(event) =>
                        setOperationForm((prev) => ({ ...prev, dockId: event.target.value }))
                      }
                    >
                      <option value="">Не указан</option>
                      {docks
                        .filter((dock) => dock.isActive)
                        .map((dock) => (
                          <option key={dock.id} value={dock.id}>
                            {dock.code} {dock.name ? `• ${dock.name}` : ""}
                          </option>
                        ))}
                    </select>
                  </label>

                  <label>
                    Номер / ссылка
                    <input
                      type="text"
                      value={operationForm.referenceNumber}
                      onChange={(event) =>
                        setOperationForm((prev) => ({
                          ...prev,
                          referenceNumber: event.target.value,
                        }))
                      }
                      placeholder="ASN, заказ, документ"
                    />
                  </label>

                  <label>
                    Контрагент
                    <input
                      type="text"
                      value={operationForm.partnerName}
                      onChange={(event) =>
                        setOperationForm((prev) => ({ ...prev, partnerName: event.target.value }))
                      }
                      placeholder="Поставщик / клиент"
                    />
                  </label>

                  <label>
                    Машина
                    <input
                      type="text"
                      value={operationForm.truckNumber}
                      onChange={(event) =>
                        setOperationForm((prev) => ({ ...prev, truckNumber: event.target.value }))
                      }
                      placeholder="Номер авто"
                    />
                  </label>

                  <label>
                    Плановое время
                    <input
                      type="datetime-local"
                      value={operationForm.plannedAt}
                      onChange={(event) =>
                        setOperationForm((prev) => ({ ...prev, plannedAt: event.target.value }))
                      }
                    />
                  </label>

                  <label className="crossdock-span-2">
                    Груз
                    <textarea
                      rows={2}
                      value={operationForm.cargoSummary}
                      onChange={(event) =>
                        setOperationForm((prev) => ({
                          ...prev,
                          cargoSummary: event.target.value,
                        }))
                      }
                      placeholder="Краткое описание груза"
                    />
                  </label>

                  <label className="crossdock-span-2">
                    Примечание
                    <textarea
                      rows={2}
                      value={operationForm.note}
                      onChange={(event) =>
                        setOperationForm((prev) => ({ ...prev, note: event.target.value }))
                      }
                    />
                  </label>
                </div>
                <div className="crossdock-actions">
                  <button type="submit" className="btn btn--primary" disabled={operationFormBusy}>
                    {operationFormBusy ? "Сохранение..." : "Создать операцию"}
                  </button>
                </div>
              </form>
            )}

            <div className="card crossdock-card">
              <div className="crossdock-card__title">Журнал операций</div>
              <div className="table-wrapper">
                <table>
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>Направление</th>
                      <th>Статус</th>
                      <th>Док</th>
                      <th>Контрагент</th>
                      <th>Машина</th>
                      <th>План</th>
                      <th>Обновлено</th>
                      {isManager && <th>Действия</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {operations.map((operation) => (
                      <tr key={operation.id}>
                        <td>{operation.id}</td>
                        <td>{DIRECTION_LABELS[operation.direction] || operation.direction}</td>
                        <td>
                          <span
                            className={`crossdock-status crossdock-status--${String(
                              operation.status || ""
                            ).toLowerCase()}`}
                          >
                            {STATUS_LABELS[operation.status] || operation.status}
                          </span>
                        </td>
                        <td>{operation.dock?.code || "—"}</td>
                        <td>{operation.partnerName || "—"}</td>
                        <td>{operation.truckNumber || "—"}</td>
                        <td>{formatDateTime(operation.plannedAt)}</td>
                        <td>{formatDateTime(operation.updatedAt)}</td>
                        {isManager && (
                          <td>
                            <div className="crossdock-row-actions">
                              {getNextStatusActions(operation.status).map((action) => (
                                <button
                                  key={action.status}
                                  type="button"
                                  className={`btn ${
                                    action.status === "CANCELLED"
                                      ? "btn--ghost"
                                      : "btn--secondary"
                                  }`}
                                  onClick={() => handleChangeStatus(operation.id, action.status)}
                                >
                                  {action.label}
                                </button>
                              ))}
                            </div>
                          </td>
                        )}
                      </tr>
                    ))}
                    {operations.length === 0 && (
                      <tr>
                        <td colSpan={isManager ? 9 : 8}>Нет операций по текущему фильтру.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
