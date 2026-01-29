import { useEffect, useMemo, useState } from "react";
import { API_BASE } from "../apiConfig";

const typeLabel = (row) => {
  if (row.type === "BIN_AUDIT") {
    return row.result === "DISCREPANCY"
      ? "Контроль ячейки (расхождение)"
      : "Контроль ячейки";
  }
  if (row.type === "INCOME") return "Приход";
  if (row.type === "ISSUE") return "Расход";
  if (row.type === "ADJUSTMENT") return "Корректировка";
  if (row.type === "MOVE") return "Перемещение";
  return row.type || "-";
};

const formatLocation = (location) => {
  if (!location) return "-";
  const raw = location.code || location.name || "";
  if (!raw) return "-";
  return raw.toUpperCase() === "RECEIVING" ? "Приемка" : raw;
};

const formatComment = (value) => {
  if (!value) return "-";
  return String(value).replace(/RECEIVING/gi, "Приемка");
};

const escapeHtml = (value) => {
  if (value == null) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
};

const buildPrintHtml = (rows) => {
  const head = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8" />
<title>Транзакции склада</title>
<style>
  body { font-family: Arial, sans-serif; padding: 16px; color: #111827; }
  h1 { font-size: 18px; margin: 0 0 12px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #e5e7eb; padding: 6px 8px; font-size: 12px; vertical-align: top; }
  th { background: #f9fafb; text-align: left; }
  .muted { color: #6b7280; font-size: 11px; }
</style>
</head>
<body>
<h1>Транзакции склада</h1>
<table>
<thead>
<tr>
  <th>Дата</th>
  <th>Тип</th>
  <th>Товар</th>
  <th>Ячейка</th>
  <th>Кол-во</th>
  <th>Кто</th>
  <th>Комментарий</th>
</tr>
</thead>
<tbody>`;

  const body = rows
    .map((row) => {
      const date = row.createdAt
        ? new Date(row.createdAt).toLocaleString("ru-RU")
        : "-";
      const type = typeLabel(row);
      const item = row.item?.name
        ? `${row.item.name}${row.item?.sku ? ` (${row.item.sku})` : ""}`
        : "-";
      const location = formatLocation(row.location);
      const qty = row.qty != null ? row.qty : "-";
      const user = row.user?.name || "-";
      const comment = formatComment(row.comment);

      return `
<tr>
  <td>${escapeHtml(date)}</td>
  <td>${escapeHtml(type)}</td>
  <td>${escapeHtml(item)}</td>
  <td>${escapeHtml(location)}</td>
  <td>${escapeHtml(qty)}</td>
  <td>${escapeHtml(user)}</td>
  <td>${escapeHtml(comment)}</td>
</tr>`;
    })
    .join("");

  const tail = `
</tbody>
</table>
<p class="muted">Печать сформирована автоматически</p>
<script>window.onload = () => setTimeout(() => window.print(), 200);</script>
</body>
</html>`;

  return head + body + tail;
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

  const handlePrint = () => {
    if (!items.length) return;
    const html = buildPrintHtml(items);
    const printWindow = window.open("", "_blank", "noopener,noreferrer");
    if (!printWindow) return;
    printWindow.document.write(html);
    printWindow.document.close();
  };

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
        const detail = data.detail ? `: ${data.detail}` : "";
        throw new Error((data.message || "Ошибка загрузки") + detail);
      }
      setItems(data.items || []);
    } catch (err) {
      setError(err.message || "Ошибка загрузки");
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
        <div style={{ fontWeight: 700, fontSize: 18 }}>Транзакции</div>
        <div style={{ fontSize: 13, color: "#64748b" }}>
          Все действия по ячейкам: отбор, перемещение, инвентаризация, контроль.
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input
            className="form__input"
            placeholder="Поиск по товару, SKU, штрих-коду, ячейке"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => load(query.trim())}
            disabled={loading}
          >
            {loading ? "Поиск..." : "Найти"}
          </button>
          <button
            type="button"
            className="btn btn--secondary"
            onClick={handlePrint}
          >
            Печать
          </button>
        </div>
      </div>

      {error && <div className="alert alert--danger">{error}</div>}

      {loading ? (
        <div style={{ padding: 12 }}>Загрузка...</div>
      ) : items.length === 0 ? (
        <div style={{ padding: 12 }}>Нет транзакций.</div>
      ) : (
        <div className="transactions-table">
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={thStyle}>Дата</th>
                <th style={thStyle}>Тип</th>
                <th style={thStyle}>Товар</th>
                <th style={thStyle}>Ячейка</th>
                <th style={thStyle}>Кол-во</th>
                <th style={thStyle}>Кто</th>
                <th style={thStyle}>Комментарий</th>
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
                    {formatLocation(row.location)}
                  </td>
                  <td data-label="qty" style={tdStyle}>
                    {row.qty != null ? row.qty : "-"}
                  </td>
                  <td data-label="user" style={tdStyle}>
                    {row.user?.name || "-"}
                  </td>
                  <td data-label="comment" style={tdStyle}>
                    {formatComment(row.comment)}
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
