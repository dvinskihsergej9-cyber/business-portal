import { useEffect, useMemo, useState } from "react";
import { API_BASE } from "../apiConfig";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { ARIAL_TTF_BASE64 } from "../utils/arialFontBase64";

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
  return String(value)
    .replace(/PO RECEIVING/gi, "Приемка по заказу")
    .replace(/TSD RECEIVING/gi, "Приемка (ТСД)")
    .replace(/TSD COUNT/gi, "Контроль (ТСД)")
    .replace(/TSD PICK/gi, "Отбор (ТСД)")
    .replace(/TSD MOVE/gi, "Перемещение (ТСД)")
    .replace(/TSD PUTAWAY/gi, "Размещение (ТСД)")
    .replace(/TSD REPLENISH/gi, "Пополнение (ТСД)")
    .replace(/BIN AUDIT/gi, "Контроль ячейки")
    .replace(/REVISION/gi, "Ревизия")
    .replace(/RECEIVING/gi, "Приемка");
};

const ensurePdfFont = async (pdf) => {
  // jsPDF VFS is per-instance, so we must register the font every time.
  pdf.addFileToVFS("Arial.ttf", ARIAL_TTF_BASE64);
  pdf.addFont("Arial.ttf", "Arial", "normal", "Identity-H");
  pdf.setFont("Arial", "normal");
};

export default function StockTransactionsTab() {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState([]);
  const [error, setError] = useState("");
  const [printing, setPrinting] = useState(false);

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

  const handlePrint = async () => {
    if (!items.length || printing) return;
    try {
      setPrinting(true);
      const pdf = new jsPDF("l", "pt", "a4");
      await ensurePdfFont(pdf);
      pdf.setFontSize(12);
      pdf.text("Транзакции склада", 40, 28);

      const rows = items.map((row) => [
        row.createdAt ? new Date(row.createdAt).toLocaleString("ru-RU") : "-",
        typeLabel(row),
        row.item?.name
          ? `${row.item.name}${row.item?.sku ? ` (${row.item.sku})` : ""}`
          : "-",
        formatLocation(row.location),
        row.qty != null ? String(row.qty) : "-",
        row.user?.name || "-",
        formatComment(row.comment),
      ]);

      autoTable(pdf, {
        startY: 38,
        head: [["Дата", "Тип", "Товар", "Ячейка", "Кол-во", "Кто", "Комментарий"]],
        body: rows,
        theme: "grid",
        styles: {
          font: "Arial",
          fontSize: 8,
          cellPadding: 3,
          overflow: "linebreak",
          valign: "top",
        },
        headStyles: {
          fillColor: [245, 246, 248],
          textColor: [15, 23, 42],
          fontStyle: "bold",
          font: "Arial",
        },
        columnStyles: {
          0: { cellWidth: 90 },
          1: { cellWidth: 90 },
          2: { cellWidth: 260 },
          3: { cellWidth: 70 },
          4: { cellWidth: 55 },
          5: { cellWidth: 95 },
          6: { cellWidth: 190 },
        },
        rowPageBreak: "avoid",
      });

      pdf.save("transactions.pdf");
    } catch (err) {
      if (err?.message === "FONT_LOAD_FAILED") {
        alert("Не удалось загрузить шрифт для PDF. Попробуйте обновить страницу.");
      }
      console.error("transactions pdf error:", err);
    } finally {
      setPrinting(false);
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
            placeholder="Поиск по товару, артикулу, штрих-коду, ячейке"
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
            disabled={printing || !items.length}
          >
            {printing ? "Готовим PDF..." : "Скачать PDF"}
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

