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

const statusLabel = (value) => {
  if (value === "APPLIED") return "Применено";
  if (value === "SKIPPED") return "Пропущено";
  return "Открыто";
};

export default function StockRevisionTab() {
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN";
  const [revisions, setRevisions] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [applying, setApplying] = useState(false);
  const [printing, setPrinting] = useState(false);

  const authHeaders = useMemo(() => {
    const token = localStorage.getItem("token");
    return {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
  }, []);

  const loadRevisions = async (selectLatest = true) => {
    try {
      setLoading(true);
      setError("");
      const res = await apiFetch("/warehouse/revisions", {
        headers: authHeaders,
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || "Ошибка загрузки");
      }
      const list = data.items || [];
      setRevisions(list);
      if (selectLatest && list.length) {
        setSelectedId(list[0].id);
      }
    } catch (err) {
      setError(err.message || "Ошибка загрузки");
    } finally {
      setLoading(false);
    }
  };

  const loadItems = async (revisionId) => {
    if (!revisionId) return;
    try {
      setItemsLoading(true);
      setError("");
      const res = await apiFetch(`/warehouse/revisions/${revisionId}`, {
        headers: authHeaders,
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || "Ошибка загрузки");
      }
      setItems(data.items || []);
    } catch (err) {
      setError(err.message || "Ошибка загрузки");
    } finally {
      setItemsLoading(false);
    }
  };

  useEffect(() => {
    loadRevisions(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (selectedId) {
      loadItems(selectedId);
    } else {
      setItems([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  const handleCreate = async () => {
    if (creating) return;
    try {
      setCreating(true);
      setError("");
      const res = await apiFetch("/warehouse/revisions", {
        method: "POST",
        headers: authHeaders,
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || "Не удалось создать ревизию");
      }
      await loadRevisions(false);
      setSelectedId(data.id || null);
      if (data.id) {
        await loadItems(data.id);
      }
    } catch (err) {
      setError(err.message || "Не удалось создать ревизию");
    } finally {
      setCreating(false);
    }
  };

  const handleApply = async (ids, applyAll = false) => {
    if (!selectedId || applying) return;
    try {
      setApplying(true);
      setError("");
      const res = await apiFetch(`/warehouse/revisions/${selectedId}/apply`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ itemIds: ids, applyAll }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || "Не удалось применить корректировку");
      }
      await loadItems(selectedId);
      await loadRevisions(false);
    } catch (err) {
      setError(err.message || "Не удалось применить корректировку");
    } finally {
      setApplying(false);
    }
  };

  const handlePrint = async () => {
    if (!selectedId || printing) return;
    if (!items.length) return;
    try {
      setPrinting(true);
      const pdf = new jsPDF("l", "pt", "a4");
      await ensurePdfFont(pdf);
      pdf.setFontSize(12);
      pdf.text(`Ревизия склада №${selectedId}`, 40, 28);

      const rows = items.map((row) => [
        row.createdAt ? new Date(row.createdAt).toLocaleString("ru-RU") : "-",
        row.location?.code || row.location?.name || "-",
        row.item?.name ? `${row.item.name}${row.item?.sku ? ` (${row.item.sku})` : ""}` : "-",
        row.expectedQty ?? "-",
        row.countedQty ?? "-",
        row.delta ?? "-",
        row.checkedBy?.name || "-",
        statusLabel(row.status),
      ]);

      autoTable(pdf, {
        startY: 38,
        head: [["Дата", "Ячейка", "Товар", "Портал", "Факт", "Δ", "Кто", "Статус"]],
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
          0: { cellWidth: 100 },
          1: { cellWidth: 70 },
          2: { cellWidth: 260 },
          3: { cellWidth: 60 },
          4: { cellWidth: 60 },
          5: { cellWidth: 50 },
          6: { cellWidth: 90 },
          7: { cellWidth: 80 },
        },
        rowPageBreak: "avoid",
      });

      pdf.save(`revision-${selectedId}.pdf`);
    } catch (err) {
      console.error("revision pdf error:", err);
    } finally {
      setPrinting(false);
    }
  };

  const selectedRevision = revisions.find((rev) => rev.id === selectedId);

  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ display: "grid", gap: 12, marginBottom: 12 }}>
        <div style={{ fontWeight: 700, fontSize: 18 }}>Ревизия</div>
        <div style={{ fontSize: 13, color: "#64748b" }}>
          Снимок расхождений по контролю ячеек. Только расхождения, без закрытых позиций.
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <select
            className="form__input"
            style={{ minWidth: 220 }}
            value={selectedId || ""}
            onChange={(event) => setSelectedId(Number(event.target.value) || null)}
          >
            <option value="">Выберите ревизию</option>
            {revisions.map((rev) => (
              <option key={rev.id} value={rev.id}>
                {rev.createdAt
                  ? `#${rev.id} — ${new Date(rev.createdAt).toLocaleString("ru-RU")}`
                  : `#${rev.id}`}
              </option>
            ))}
          </select>
          {isAdmin && (
            <button type="button" className="btn btn--primary" onClick={handleCreate} disabled={creating}>
              {creating ? "Формирование..." : "Сформировать ревизию"}
            </button>
          )}
          <button type="button" className="btn btn--secondary" onClick={handlePrint} disabled={printing || !items.length}>
            {printing ? "Готовим PDF..." : "Печать"}
          </button>
          {isAdmin && selectedId && items.length > 0 && (
            <button
              type="button"
              className="btn btn--secondary"
              onClick={() => handleApply([], true)}
              disabled={applying}
            >
              {applying ? "Применяем..." : "Применить всё"}
            </button>
          )}
        </div>
        {selectedRevision && (
          <div style={{ fontSize: 12, color: "#64748b" }}>
            Всего: {selectedRevision.itemsCount || 0} · Открытые: {selectedRevision.openCount || 0} · Применено: {selectedRevision.appliedCount || 0}
          </div>
        )}
      </div>

      {error && <div className="alert alert--danger">{error}</div>}

      {loading || itemsLoading ? (
        <div style={{ padding: 12 }}>Загрузка...</div>
      ) : !selectedId ? (
        <div style={{ padding: 12 }}>Выберите ревизию.</div>
      ) : items.length === 0 ? (
        <div style={{ padding: 12 }}>Нет расхождений.</div>
      ) : (
        <div className="discrepancies-table">
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={thStyle}>Дата</th>
                <th style={thStyle}>Ячейка</th>
                <th style={thStyle}>Товар</th>
                <th style={thStyle}>Портал</th>
                <th style={thStyle}>Факт</th>
                <th style={thStyle}>Δ</th>
                <th style={thStyle}>Кто</th>
                <th style={thStyle}></th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => (
                <tr key={row.id} className="discrepancies-row">
                  <td data-label="date" style={tdStyle}>
                    {row.createdAt ? new Date(row.createdAt).toLocaleString("ru-RU") : "-"}
                  </td>
                  <td data-label="location" style={tdStyle}>
                    {row.location?.code || row.location?.name || "-"}
                </td>
                  <td data-label="item" style={tdStyle}>
                    {row.item?.name || "-"}
                    {row.item?.sku ? ` (${row.item.sku})` : ""}
                  </td>
                  <td data-label="expected" style={tdStyle}>
                    {row.expectedQty}
                  </td>
                  <td data-label="counted" style={tdStyle}>
                    {row.countedQty}
                  </td>
                  <td data-label="delta" style={tdStyle}>
                    {row.delta}
                  </td>
                  <td data-label="user" style={tdStyle}>
                    {row.checkedBy?.name || "-"}
                  </td>
                  <td data-label="actions" style={tdStyle}>
                    <div style={{ display: "grid", gap: 6 }}>
                      <span style={{ fontSize: 12, color: "#64748b" }}>{statusLabel(row.status)}</span>
                      {isAdmin && row.status === "OPEN" && (
                        <button
                          type="button"
                          className="btn btn--secondary"
                          onClick={() => handleApply([row.id], false)}
                          disabled={applying}
                        >
                          Применить
                        </button>
                      )}
                    </div>
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
