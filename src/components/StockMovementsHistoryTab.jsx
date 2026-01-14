import { useEffect, useState } from "react";
import { apiFetch } from "../apiConfig";

const MOVEMENT_TYPE_LABELS = {
  INCOME: "Приход",
  ISSUE: "Расход",
  ADJUSTMENT: "Корректировка",
};

/**
 * История движений в стиле 1С
 */
export default function StockMovementsHistoryTab() {
  const token = localStorage.getItem("token");
  const authHeaders = { Authorization: `Bearer ${token}` };

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
          throw new Error("Ответ сервера не похож на JSON при загрузке движений");
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const trimmedSearch = search.trim().toLowerCase();

  const visibleRows = rows.filter((m) => {
    if (typeFilter !== "ALL" && m.type !== typeFilter) {
      return false;
    }

    if (!trimmedSearch) return true;

    const name = String(m.item?.name || "").toLowerCase();
    const comment = String(m.comment || "").toLowerCase();
    const author =
  String(m.createdBy?.name || m.createdBy?.email || "").toLowerCase();

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
        {/* Фильтры сверху */}
        <div
          style={{
            display: "flex",
            gap: 12,
            alignItems: "center",
            marginBottom: 8,
          }}
        >
          <span style={{ fontSize: 13 }}>Тип операции:</span>
          <select
            className="form__select"
            style={{ width: 160 }}
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
          >
            <option value="ALL">Все</option>
            <option value="INCOME">Приход</option>
            <option value="ISSUE">Расход</option>
            <option value="ADJUSTMENT">Корректировка</option>
          </select>

          <span style={{ fontSize: 13 }}>Поиск:</span>
          <input
            type="text"
            className="form__input"
            style={{ maxWidth: 260 }}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Товар, комментарий, автор..."
          />
        </div>

        {error && (
          <div className="alert alert--danger" style={{ marginBottom: 8 }}>
            {error}
          </div>
        )}

        {loading ? (
          <p>Загрузка истории...</p>
        ) : !visibleRows.length ? (
          <p className="text-muted">Движений не найдено.</p>
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
                  <th
                    style={{
                      border: "1px solid #d4d4d4",
                      padding: "4px 6px",
                    }}
                  >
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
                  <th
                    style={{
                      border: "1px solid #d4d4d4",
                      padding: "4px 6px",
                    }}
                  >
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
