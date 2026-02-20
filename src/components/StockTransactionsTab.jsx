import { useEffect, useMemo, useState } from "react";
import { API_BASE } from "../apiConfig";
import { useAuth } from "../context/AuthContext";
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
  const { user } = useAuth();
  const canAdjust = user?.role === "ADMIN";

  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState([]);
  const [error, setError] = useState("");
  const [printing, setPrinting] = useState(false);

  const [stockItems, setStockItems] = useState([]);
  const [stockLoading, setStockLoading] = useState(false);
  const [adjustLoading, setAdjustLoading] = useState(false);
  const [adjustError, setAdjustError] = useState("");
  const [adjustSuccess, setAdjustSuccess] = useState("");
  const [adjustForm, setAdjustForm] = useState({
    itemId: "",
    mode: "PLUS",
    quantity: "",
    reason: "",
  });

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

  const loadStockItems = async () => {
    if (!canAdjust) return;
    try {
      setStockLoading(true);
      const res = await fetch(`${API_BASE}/warehouse/stock/summary`, {
        headers: authHeaders,
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.message || "Не удалось загрузить список товаров");
      }
      setStockItems(Array.isArray(data) ? data : []);
    } catch (err) {
      setAdjustError(err.message || "Ошибка загрузки списка товаров");
    } finally {
      setStockLoading(false);
    }
  };

  const handleAdjustStock = async (event) => {
    event.preventDefault();
    try {
      setAdjustError("");
      setAdjustSuccess("");

      const itemId = Number(adjustForm.itemId);
      const quantity = Math.trunc(Number(adjustForm.quantity));
      const reason = String(adjustForm.reason || "").trim();

      if (!itemId || Number.isNaN(itemId)) {
        throw new Error("Выберите товар.");
      }
      if (!Number.isFinite(quantity) || quantity <= 0) {
        throw new Error("Количество должно быть положительным целым числом.");
      }
      if (!reason) {
        throw new Error("Укажите причину корректировки.");
      }

      const delta = adjustForm.mode === "PLUS" ? quantity : -quantity;

      setAdjustLoading(true);
      const res = await fetch(`${API_BASE}/warehouse/stock/adjustment`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          itemId,
          delta,
          reason,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.message || "Не удалось выполнить корректировку.");
      }

      setAdjustSuccess(
        `Проведено: ${delta > 0 ? "+" : ""}${delta}. Текущий остаток: ${data.stockAfter}.`
      );
      setAdjustForm((prev) => ({
        ...prev,
        quantity: "",
        reason: "",
      }));

      await Promise.all([load(query.trim()), loadStockItems()]);
    } catch (err) {
      setAdjustError(err.message || "Ошибка корректировки.");
    } finally {
      setAdjustLoading(false);
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
    if (canAdjust) {
      loadStockItems();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canAdjust]);

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
            disabled={printing || !items.length}
          >
            {printing ? "Готовим PDF..." : "Скачать PDF"}
          </button>
        </div>
      </div>

      {canAdjust && (
        <div
          style={{
            border: "1px solid #e2e8f0",
            borderRadius: 14,
            padding: 12,
            marginBottom: 14,
            background: "#f8fbff",
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Служебная корректировка остатков</div>
          <div style={{ fontSize: 13, color: "#64748b", marginBottom: 10 }}>
            Корректировка выполняется администратором без выбора ячейки.
          </div>

          <form
            onSubmit={handleAdjustStock}
            style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}
          >
            <select
              className="form__select"
              value={adjustForm.itemId}
              onChange={(event) =>
                setAdjustForm((prev) => ({ ...prev, itemId: event.target.value }))
              }
              disabled={stockLoading || adjustLoading}
            >
              <option value="">{stockLoading ? "Загрузка..." : "Выберите товар"}</option>
              {stockItems.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} ({item.sku || "без SKU"}) — {item.currentStock} {item.unit || "шт"}
                </option>
              ))}
            </select>

            <select
              className="form__select"
              value={adjustForm.mode}
              onChange={(event) =>
                setAdjustForm((prev) => ({ ...prev, mode: event.target.value }))
              }
              disabled={adjustLoading}
            >
              <option value="PLUS">Плюс</option>
              <option value="MINUS">Минус</option>
            </select>

            <input
              className="form__input"
              type="number"
              min="1"
              step="1"
              placeholder="Кол-во"
              value={adjustForm.quantity}
              onChange={(event) =>
                setAdjustForm((prev) => ({ ...prev, quantity: event.target.value }))
              }
              disabled={adjustLoading}
            />

            <input
              className="form__input"
              placeholder="Причина (обязательно)"
              value={adjustForm.reason}
              onChange={(event) =>
                setAdjustForm((prev) => ({ ...prev, reason: event.target.value }))
              }
              disabled={adjustLoading}
            />

            <button type="submit" className="btn btn--primary" disabled={adjustLoading || stockLoading}>
              {adjustLoading ? "Проводим..." : "Провести"}
            </button>
          </form>

          {adjustError && <div className="alert alert--danger" style={{ marginTop: 8 }}>{adjustError}</div>}
          {adjustSuccess && <div className="alert alert--success" style={{ marginTop: 8 }}>{adjustSuccess}</div>}
        </div>
      )}

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

