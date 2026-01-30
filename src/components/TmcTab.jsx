import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../apiConfig";
import { useAuth } from "../context/AuthContext";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { ARIAL_TTF_BASE64 } from "../utils/arialFontBase64";

const ensurePdfFont = async (pdf) => {
  pdf.addFileToVFS("Arial.ttf", ARIAL_TTF_BASE64);
  pdf.addFont("Arial.ttf", "Arial", "normal", "Identity-H");
  pdf.setFont("Arial", "normal");
};

const formatQty = (value) => (value == null ? "-" : String(value));

const typeLabel = (type) => {
  if (type === "INCOME") return "Приход";
  if (type === "ISSUE") return "Выдача";
  if (type === "ADJUSTMENT") return "Корректировка";
  return type || "-";
};

const mapErrorMessage = (message) => {
  if (!message) return "Ошибка";
  if (message === "INSUFFICIENT_QTY") return "Недостаточно остатка для выдачи.";
  if (message === "BAD_REQUEST") return "Проверьте заполнение формы.";
  if (message === "ITEM_NOT_FOUND") return "Позиция не найдена.";
  return message;
};

export default function TmcTab() {
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN";

  const [items, setItems] = useState([]);
  const [stock, setStock] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [printing, setPrinting] = useState(false);

  const [newItem, setNewItem] = useState({ name: "", unit: "шт" });
  const [receiveForm, setReceiveForm] = useState({ itemId: "", qty: "", docNo: "", comment: "" });
  const [issueForm, setIssueForm] = useState({ itemId: "", qty: "", department: "", employee: "", comment: "" });

  const authHeaders = useMemo(() => {
    const token = localStorage.getItem("token");
    return {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
  }, []);

  const loadAll = async () => {
    try {
      setLoading(true);
      setError("");
      const [itemsRes, stockRes, txRes] = await Promise.all([
        apiFetch("/tmc/items", { headers: authHeaders }),
        apiFetch("/tmc/stock", { headers: authHeaders }),
        apiFetch("/tmc/transactions?limit=200", { headers: authHeaders }),
      ]);
      const itemsData = await itemsRes.json();
      const stockData = await stockRes.json();
      const txData = await txRes.json();
      if (!itemsRes.ok) throw new Error(mapErrorMessage(itemsData.message) || "Ошибка загрузки ТМЦ");
      if (!stockRes.ok) throw new Error(mapErrorMessage(stockData.message) || "Ошибка загрузки остатков");
      if (!txRes.ok) throw new Error(mapErrorMessage(txData.message) || "Ошибка загрузки журнала");
      setItems(itemsData || []);
      setStock(stockData || []);
      setTransactions(txData.items || []);
    } catch (err) {
      setError(err.message || "Ошибка загрузки");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleAddItem = async () => {
    if (!newItem.name.trim()) return;
    try {
      setError("");
      const res = await apiFetch("/tmc/items", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ name: newItem.name.trim(), unit: newItem.unit || "шт" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(mapErrorMessage(data.message) || "Не удалось добавить");
      setNewItem({ name: "", unit: "шт" });
      await loadAll();
    } catch (err) {
      setError(err.message || "Не удалось добавить");
    }
  };

  const handleReceive = async () => {
    try {
      setError("");
      const res = await apiFetch("/tmc/receive", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          itemId: receiveForm.itemId,
          qty: receiveForm.qty,
          docNo: receiveForm.docNo,
          comment: receiveForm.comment,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(mapErrorMessage(data.message) || "Не удалось оприходовать");
      setReceiveForm({ itemId: "", qty: "", docNo: "", comment: "" });
      await loadAll();
    } catch (err) {
      setError(err.message || "Не удалось оприходовать");
    }
  };

  const handleIssue = async () => {
    try {
      setError("");
      const res = await apiFetch("/tmc/issue", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          itemId: issueForm.itemId,
          qty: issueForm.qty,
          department: issueForm.department,
          employee: issueForm.employee,
          comment: issueForm.comment,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(mapErrorMessage(data.message) || "Не удалось выдать");
      setIssueForm({ itemId: "", qty: "", department: "", employee: "", comment: "" });
      await loadAll();
    } catch (err) {
      setError(err.message || "Не удалось выдать");
    }
  };

  const handlePrint = async () => {
    if (printing) return;
    try {
      setPrinting(true);
      const pdf = new jsPDF("l", "pt", "a4");
      await ensurePdfFont(pdf);
      pdf.setFontSize(12);
      pdf.text("Ревизия ТМЦ", 40, 28);

      const rows = stock.map((row) => [
        row.name || "-",
        row.unit || "-",
        row.currentStock ?? "-",
      ]);

      autoTable(pdf, {
        startY: 38,
        head: [["Товар", "Ед.", "Остаток"]],
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
          0: { cellWidth: 340 },
          1: { cellWidth: 80 },
          2: { cellWidth: 80 },
        },
      });

      pdf.save("tmc-revision.pdf");
    } catch (err) {
      console.error("tmc print error:", err);
    } finally {
      setPrinting(false);
    }
  };

  const itemOptions = items.length ? items : stock;

  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ display: "grid", gap: 12, marginBottom: 16 }}>
        <div style={{ fontWeight: 700, fontSize: 18 }}>ТМЦ</div>
        <div style={{ fontSize: 13, color: "#64748b" }}>
          Общий запас расходных материалов. Приход и выдача списывают остатки ТМЦ.
        </div>
        {error && <div className="alert alert--danger">{error}</div>}
      </div>

      <div style={{ display: "grid", gap: 16 }}>
        <div className="card" style={{ padding: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Справочник ТМЦ</div>
          <div style={{ display: "grid", gap: 8 }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <input
                className="form__input"
                placeholder="Название ТМЦ"
                value={newItem.name}
                onChange={(e) => setNewItem((prev) => ({ ...prev, name: e.target.value }))}
              />
              <input
                className="form__input"
                style={{ maxWidth: 120 }}
                placeholder="Ед."
                value={newItem.unit}
                onChange={(e) => setNewItem((prev) => ({ ...prev, unit: e.target.value }))}
              />
              {isAdmin && (
                <button type="button" className="btn btn--primary" onClick={handleAddItem}>
                  Добавить
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="card" style={{ padding: 12 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <div style={{ fontWeight: 700 }}>Остатки ТМЦ</div>
            <button type="button" className="btn btn--secondary" onClick={handlePrint} disabled={printing}>
              {printing ? "Готовим акт..." : "Печать акта"}
            </button>
          </div>
          {loading ? (
            <div>Загрузка...</div>
          ) : (
            <div className="transactions-table">
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={thStyle}>Товар</th>
                    <th style={thStyle}>Ед.</th>
                    <th style={thStyle}>Остаток</th>
                  </tr>
                </thead>
                <tbody>
                  {stock.map((row) => (
                    <tr key={row.id} className="transactions-row">
                      <td data-label="item" style={tdStyle}>{row.name}</td>
                      <td data-label="unit" style={tdStyle}>{row.unit || "-"}</td>
                      <td data-label="qty" style={tdStyle}>{formatQty(row.currentStock)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="card" style={{ padding: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Приход ТМЦ</div>
          <div style={{ display: "grid", gap: 8 }}>
            <select
              className="form__input"
              value={receiveForm.itemId}
              onChange={(e) => setReceiveForm((prev) => ({ ...prev, itemId: e.target.value }))}
            >
              <option value="">Выберите ТМЦ</option>
              {itemOptions.map((it) => (
                <option key={it.id} value={it.id}>
                  {it.name}
                </option>
              ))}
            </select>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <input
                className="form__input"
                placeholder="Количество"
                value={receiveForm.qty}
                onChange={(e) => setReceiveForm((prev) => ({ ...prev, qty: e.target.value }))}
              />
              <input
                className="form__input"
                placeholder="Документ / накладная"
                value={receiveForm.docNo}
                onChange={(e) => setReceiveForm((prev) => ({ ...prev, docNo: e.target.value }))}
              />
            </div>
            <input
              className="form__input"
              placeholder="Комментарий"
              value={receiveForm.comment}
              onChange={(e) => setReceiveForm((prev) => ({ ...prev, comment: e.target.value }))}
            />
            {isAdmin && (
              <button type="button" className="btn btn--primary" onClick={handleReceive}>
                Оприходовать
              </button>
            )}
          </div>
        </div>

        <div className="card" style={{ padding: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Выдача ТМЦ</div>
          <div style={{ display: "grid", gap: 8 }}>
            <select
              className="form__input"
              value={issueForm.itemId}
              onChange={(e) => setIssueForm((prev) => ({ ...prev, itemId: e.target.value }))}
            >
              <option value="">Выберите ТМЦ</option>
              {itemOptions.map((it) => (
                <option key={it.id} value={it.id}>
                  {it.name}
                </option>
              ))}
            </select>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <input
                className="form__input"
                placeholder="Количество"
                value={issueForm.qty}
                onChange={(e) => setIssueForm((prev) => ({ ...prev, qty: e.target.value }))}
              />
              <input
                className="form__input"
                placeholder="Отдел"
                value={issueForm.department}
                onChange={(e) => setIssueForm((prev) => ({ ...prev, department: e.target.value }))}
              />
              <input
                className="form__input"
                placeholder="Сотрудник"
                value={issueForm.employee}
                onChange={(e) => setIssueForm((prev) => ({ ...prev, employee: e.target.value }))}
              />
            </div>
            <input
              className="form__input"
              placeholder="Комментарий"
              value={issueForm.comment}
              onChange={(e) => setIssueForm((prev) => ({ ...prev, comment: e.target.value }))}
            />
            <button type="button" className="btn btn--primary" onClick={handleIssue}>
              Выдать
            </button>
          </div>
        </div>

        <div className="card" style={{ padding: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Журнал ТМЦ</div>
          {loading ? (
            <div>Загрузка...</div>
          ) : (
            <div className="transactions-table">
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={thStyle}>Дата</th>
                    <th style={thStyle}>Тип</th>
                    <th style={thStyle}>Товар</th>
                    <th style={thStyle}>Кол-во</th>
                    <th style={thStyle}>Кто</th>
                    <th style={thStyle}>Комментарий</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((row) => (
                    <tr key={row.id} className="transactions-row">
                      <td data-label="date" style={tdStyle}>
                        {row.createdAt ? new Date(row.createdAt).toLocaleString("ru-RU") : "-"}
                      </td>
                      <td data-label="type" style={tdStyle}>{typeLabel(row.type)}</td>
                      <td data-label="item" style={tdStyle}>{row.item?.name || "-"}</td>
                      <td data-label="qty" style={tdStyle}>{formatQty(row.qty)}</td>
                      <td data-label="user" style={tdStyle}>{row.user?.name || "-"}</td>
                      <td data-label="comment" style={tdStyle}>{row.comment || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
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
