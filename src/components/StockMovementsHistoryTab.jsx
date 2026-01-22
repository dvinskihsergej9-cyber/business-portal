import { useEffect, useState } from "react";
import useIsMobile from "../hooks/useIsMobile";
import { apiFetch } from "../apiConfig";

const MOVEMENT_TYPE_LABELS = {
  INCOME: "Приход",
  ISSUE: "Расход",
  ADJUSTMENT: "Корректировка",
};

export default function StockMovementsHistoryTab() {
  const token = localStorage.getItem("token");
  const authHeaders = { Authorization: `Bearer ${token}` };
  const isMobile = useIsMobile();

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [typeFilter, setTypeFilter] = useState("ALL");
  const [search, setSearch] = useState("");

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        setError("");

        const res = await apiFetch("/inventory/movements?limit=200", {
          headers: authHeaders,
        });

        let data;
        try {
          data = await res.json();
        } catch {
          throw new Error("Не удалось прочитать ответ от сервера.");
        }

        if (!res.ok) {
          throw new Error(data?.message || "Ошибка загрузки истории движений");
        }

        setRows(Array.isArray(data) ? data : []);
      } catch (e) {
        console.error(e);
        setError(e.message);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, []);

  const trimmedSearch = search.trim().toLowerCase();

  const visibleRows = rows.filter((m) => {
    if (typeFilter !== "ALL" && m.type !== typeFilter) {
      return false;
    }

    if (!trimmedSearch) return true;

    const name = String(m.item?.name || "").toLowerCase();
    const comment = String(m.comment || "").toLowerCase();
    const author = String(m.createdBy?.name || m.createdBy?.email || "").toLowerCase();

    return (
      name.includes(trimmedSearch) ||
      comment.includes(trimmedSearch) ||
      author.includes(trimmedSearch)
    );
  });

  return (
    <div className="card card--1c">
      <div className="card1c__header">История движения товара</div>

      <div className="card1c__body">
        <div className="movements-filters">
          <div className="movements-filter">
            <label className="form__label">Тип операции</label>
            <select
              className="form__select"
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
            >
              <option value="ALL">Все типы</option>
              <option value="INCOME">Приход</option>
              <option value="ISSUE">Расход</option>
              <option value="ADJUSTMENT">Корректировка</option>
            </select>
          </div>
          <div className="movements-filter">
            <label className="form__label">Поиск</label>
            <input
              type="text"
              className="form__input"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Товар, комментарий, автор..."
            />
          </div>
        </div>

        {error && (
          <div className="alert alert--danger" style={{ marginBottom: 8 }}>
            {error}
          </div>
        )}

        {loading ? (
          <p>Загрузка истории движений...</p>
        ) : !visibleRows.length ? (
          <p className="text-muted">Записей не найдено.</p>
        ) : isMobile ? (
          <div className="movement-cards">
            {visibleRows.map((m) => {
              const dateStr = m.createdAt
                ? new Date(m.createdAt).toLocaleString("ru-RU", {
                    day: "2-digit",
                    month: "2-digit",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  })
                : "-";
              const typeLabel = MOVEMENT_TYPE_LABELS[m.type] || m.type;
              return (
                <div key={m.id} className="card movement-card">
                  <div className="card__body">
                    <div className="movement-card__title">
                      {m.item?.name || "-"}
                    </div>
                    <div className="movement-card__meta">
                      <span className="badge badge--muted">{typeLabel}</span>
                      <span>{dateStr}</span>
                    </div>
                    <div className="movement-card__details">
                      <div>
                        <div className="movement-card__label">Количество</div>
                        <div>{m.quantity}</div>
                      </div>
                      <div>
                        <div className="movement-card__label">Ед.</div>
                        <div>{m.item?.unit || "-"}</div>
                      </div>
                      <div>
                        <div className="movement-card__label">Цена</div>
                        <div>{m.pricePerUnit || "-"}</div>
                      </div>
                    </div>
                    <div className="movement-card__details">
                      <div>
                        <div className="movement-card__label">Автор</div>
                        <div className="movement-card__text">
                          {m.createdBy?.name || m.createdBy?.email || "-"}
                        </div>
                      </div>
                      {m.comment && (
                        <div>
                          <div className="movement-card__label">Комментарий</div>
                          <div className="movement-card__text">{m.comment}</div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="table-wrapper">
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: 13,
              }}
            >
              <thead>
                <tr>
                  <th
                    style={{
                      border: "1px solid #d4d4d4",
                      padding: "4px 6px",
                      width: 30,
                    }}
                  >
                    №
                  </th>
                  <th
                    style={{
                      border: "1px solid #d4d4d4",
                      padding: "4px 6px",
                      width: 130,
                    }}
                  >
                    Дата
                  </th>
                  <th
                    style={{
                      border: "1px solid #d4d4d4",
                      padding: "4px 6px",
                      width: 70,
                    }}
                  >
                    Тип
                  </th>
                  <th style={{ border: "1px solid #d4d4d4", padding: "4px 6px" }}>
                    Товар
                  </th>
                  <th
                    style={{
                      border: "1px solid #d4d4d4",
                      padding: "4px 6px",
                      width: 60,
                    }}
                  >
                    Кол-во
                  </th>
                  <th
                    style={{
                      border: "1px solid #d4d4d4",
                      padding: "4px 6px",
                      width: 50,
                    }}
                  >
                    Ед.
                  </th>
                  <th
                    style={{
                      border: "1px solid #d4d4d4",
                      padding: "4px 6px",
                      width: 70,
                    }}
                  >
                    Цена
                  </th>
                  <th
                    style={{
                      border: "1px solid #d4d4d4",
                      padding: "4px 6px",
                      width: 140,
                    }}
                  >
                    Автор
                  </th>
                  <th style={{ border: "1px solid #d4d4d4", padding: "4px 6px" }}>
                    Комментарий
                  </th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((m, index) => (
                  <tr key={m.id}>
                    <td
                      style={{
                        border: "1px solid #e0e0e0",
                        padding: "3px 4px",
                        textAlign: "center",
                      }}
                    >
                      {index + 1}
                    </td>
                    <td
                      style={{
                        border: "1px solid #e0e0e0",
                        padding: "3px 4px",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {new Date(m.createdAt).toLocaleString("ru-RU", {
                        day: "2-digit",
                        month: "2-digit",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                      })}
                    </td>
                    <td
                      style={{
                        border: "1px solid #e0e0e0",
                        padding: "3px 4px",
                        textAlign: "center",
                      }}
                    >
                      {MOVEMENT_TYPE_LABELS[m.type] || m.type}
                    </td>
                    <td
                      style={{
                        border: "1px solid #e0e0e0",
                        padding: "3px 4px",
                        textAlign: "left",
                      }}
                    >
                      {m.item?.name || "-"}
                    </td>
                    <td
                      style={{
                        border: "1px solid #e0e0e0",
                        padding: "3px 4px",
                        textAlign: "right",
                      }}
                    >
                      {m.quantity}
                    </td>
                    <td
                      style={{
                        border: "1px solid #e0e0e0",
                        padding: "3px 4px",
                        textAlign: "center",
                      }}
                    >
                      {m.item?.unit || ""}
                    </td>
                    <td
                      style={{
                        border: "1px solid #e0e0e0",
                        padding: "3px 4px",
                        textAlign: "right",
                      }}
                    >
                      {m.pricePerUnit || "-"}
                    </td>
                    <td
                      style={{
                        border: "1px solid #e0e0e0",
                        padding: "3px 4px",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {m.createdBy?.name || m.createdBy?.email || "-"}
                    </td>
                    <td
                      style={{
                        border: "1px solid #e0e0e0",
                        padding: "3px 4px",
                      }}
                    >
                      {m.comment}
                    </td>
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
