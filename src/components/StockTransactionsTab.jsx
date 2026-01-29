import { useEffect, useMemo, useState } from "react";
import { API_BASE } from "../apiConfig";

const typeLabel = (row) => {
  if (row.type === "BIN_AUDIT") {
    return row.result === "DISCREPANCY"
      ? "\u041a\u043e\u043d\u0442\u0440\u043e\u043b\u044c \u044f\u0447\u0435\u0439\u043a\u0438 (\u0440\u0430\u0441\u0445\u043e\u0436\u0434\u0435\u043d\u0438\u0435)"
      : "\u041a\u043e\u043d\u0442\u0440\u043e\u043b\u044c \u044f\u0447\u0435\u0439\u043a\u0438";
  }
  if (row.type === "INCOME") return "\u041f\u043e\u0441\u0442\u0443\u043f\u043b\u0435\u043d\u0438\u0435";
  if (row.type === "ISSUE") return "\u041e\u0442\u0431\u043e\u0440";
  if (row.type === "ADJUSTMENT") return "\u041a\u043e\u0440\u0440\u0435\u043a\u0442\u0438\u0440\u043e\u0432\u043a\u0430";
  if (row.type === "MOVE") return "\u041f\u0435\u0440\u0435\u043c\u0435\u0449\u0435\u043d\u0438\u0435";
  return row.type || "-";
};

export default function StockTransactionsTab() {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState([]);
  const [error, setError] = useState("");

  const authHeaders = useMemo(() => {
    const token = localStorage.getItem("token");
    return {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
  }, []);

  const load = async (searchValue) => {
    try {
      setLoading(true);
      setError("");
      const params = new URLSearchParams();
      if (searchValue) params.set("q", searchValue);
      params.set("limit", "300");
      const res = await fetch(
        `${API_BASE}/warehouse/transactions?${params.toString()}`,
        { headers: authHeaders }
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || "\u041e\u0448\u0438\u0431\u043a\u0430 \u0437\u0430\u0433\u0440\u0443\u0437\u043a\u0438");
      }
      setItems(data.items || []);
    } catch (err) {
      setError(err.message || "\u041e\u0448\u0438\u0431\u043a\u0430 \u0437\u0430\u0433\u0440\u0443\u0437\u043a\u0438");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ display: "grid", gap: 12, marginBottom: 12 }}>
        <div style={{ fontWeight: 700, fontSize: 18 }}>{"\u0422\u0440\u0430\u043d\u0437\u0430\u043a\u0446\u0438\u0438"}</div>
        <div style={{ fontSize: 13, color: "#64748b" }}>
          {"\u0412\u0441\u0435 \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u044f \u043f\u043e \u044f\u0447\u0435\u0439\u043a\u0430\u043c: \u043e\u0442\u0431\u043e\u0440, \u043f\u0435\u0440\u0435\u043c\u0435\u0449\u0435\u043d\u0438\u0435, \u0438\u043d\u0432\u0435\u043d\u0442\u0430\u0440\u0438\u0437\u0430\u0446\u0438\u044f, \u043a\u043e\u043d\u0442\u0440\u043e\u043b\u044c."}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input
            className="form__input"
            placeholder={"\u041f\u043e\u0438\u0441\u043a \u043f\u043e \u0442\u043e\u0432\u0430\u0440\u0443, SKU, \u0448\u0442\u0440\u0438\u0445-\u043a\u043e\u0434\u0443, \u044f\u0447\u0435\u0439\u043a\u0435"}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => load(query.trim())}
            disabled={loading}
          >
            {loading ? "\u0417\u0430\u0433\u0440\u0443\u0437\u043a\u0430..." : "\u041d\u0430\u0439\u0442\u0438"}
          </button>
          <button
            type="button"
            className="btn btn--secondary"
            onClick={() => window.print()}
          >
            {"\u041f\u0435\u0447\u0430\u0442\u044c"}
          </button>
        </div>
      </div>

      {error && <div className="alert alert--danger">{error}</div>}

      {loading ? (
        <div style={{ padding: 12 }}>{"\u0417\u0430\u0433\u0440\u0443\u0437\u043a\u0430..."}</div>
      ) : items.length === 0 ? (
        <div style={{ padding: 12 }}>{"\u041d\u0435\u0442 \u0442\u0440\u0430\u043d\u0437\u0430\u043a\u0446\u0438\u0439."}</div>
      ) : (
        <div className="transactions-table">
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={thStyle}>{"\u0414\u0430\u0442\u0430"}</th>
                <th style={thStyle}>{"\u041e\u043f\u0435\u0440\u0430\u0446\u0438\u044f"}</th>
                <th style={thStyle}>{"\u0422\u043e\u0432\u0430\u0440"}</th>
                <th style={thStyle}>{"\u042f\u0447\u0435\u0439\u043a\u0430"}</th>
                <th style={thStyle}>{"\u041a\u043e\u043b-\u0432\u043e"}</th>
                <th style={thStyle}>{"\u041a\u0442\u043e"}</th>
                <th style={thStyle}>{"\u041a\u043e\u043c\u043c\u0435\u043d\u0442\u0430\u0440\u0438\u0439"}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => (
                <tr key={row.id} className="transactions-row">
                  <td data-label="date" style={tdStyle}>
                    {row.createdAt
                      ? new Date(row.createdAt).toLocaleString("ru-RU")
                      : "-"}
                  </td>
                  <td data-label="type" style={tdStyle}>
                    {typeLabel(row)}
                  </td>
                  <td data-label="item" style={tdStyle}>
                    {row.item?.name || "-"}
                    {row.item?.sku ? ` (${row.item.sku})` : ""}
                  </td>
                  <td data-label="location" style={tdStyle}>
                    {row.location?.code || row.location?.name || "-"}
                  </td>
                  <td data-label="qty" style={tdStyle}>
                    {row.qty != null ? row.qty : "-"}
                  </td>
                  <td data-label="user" style={tdStyle}>
                    {row.user?.name || "-"}
                  </td>
                  <td data-label="comment" style={tdStyle}>
                    {row.comment || "-"}
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
  padding: "10px 8px",
  borderBottom: "1px solid #e5e7eb",
  background: "#f9fafb",
  fontSize: 13,
  whiteSpace: "nowrap",
};

const tdStyle = {
  padding: "10px 8px",
  borderBottom: "1px solid #f1f5f9",
  fontSize: 13,
};
