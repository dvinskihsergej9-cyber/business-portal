import { useEffect, useMemo, useRef, useState } from "react";
import { API_BASE } from "../apiConfig";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";

const typeLabel = (row) => {
  if (row.type === "BIN_AUDIT") {
    return row.result === "DISCREPANCY"
      ? "???????? ?????? (???????????)"
      : "???????? ??????";
  }
  if (row.type === "INCOME") return "??????";
  if (row.type === "ISSUE") return "??????";
  if (row.type === "ADJUSTMENT") return "?????????????";
  if (row.type === "MOVE") return "???????????";
  return row.type || "-";
};

const formatLocation = (location) => {
  if (!location) return "-";
  const raw = location.code || location.name || "";
  if (!raw) return "-";
  return raw.toUpperCase() === "RECEIVING" ? "???????" : raw;
};

const formatComment = (value) => {
  if (!value) return "-";
  return String(value).replace(/RECEIVING/gi, "???????");
};

export default function StockTransactionsTab() {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState([]);
  const [error, setError] = useState("");
  const [printing, setPrinting] = useState(false);
  const printAreaRef = useRef(null);

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
        throw new Error((data.message || "?????? ????????") + detail);
      }
      setItems(data.items || []);
    } catch (err) {
      setError(err.message || "?????? ????????");
    } finally {
      setLoading(false);
    }
  };

  const handlePrint = async () => {
    if (!items.length || !printAreaRef.current || printing) return;
    try {
      setPrinting(true);
      const canvas = await html2canvas(printAreaRef.current, {
        scale: 2,
        backgroundColor: "#ffffff",
        useCORS: true,
      });
      const imgData = canvas.toDataURL("image/png");
      const pdf = new jsPDF("p", "pt", "a4");
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const imgWidth = pageWidth;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;

      let heightLeft = imgHeight;
      let position = 0;

      pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;

      while (heightLeft > 0) {
        position -= pageHeight;
        pdf.addPage();
        pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
        heightLeft -= pageHeight;
      }

      pdf.save("transactions.pdf");
    } catch (err) {
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
        <div style={{ fontWeight: 700, fontSize: 18 }}>??????????</div>
        <div style={{ fontSize: 13, color: "#64748b" }}>
          ??? ???????? ?? ???????: ?????, ???????????, ??????????????, ????????.
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input
            className="form__input"
            placeholder="????? ?? ??????, SKU, ?????-????, ??????"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => load(query.trim())}
            disabled={loading}
          >
            {loading ? "?????..." : "?????"}
          </button>
          <button
            type="button"
            className="btn btn--secondary"
            onClick={handlePrint}
            disabled={printing || !items.length}
          >
            {printing ? "??????? PDF..." : "??????? PDF"}
          </button>
        </div>
      </div>

      {error && <div className="alert alert--danger">{error}</div>}

      {loading ? (
        <div style={{ padding: 12 }}>????????...</div>
      ) : items.length === 0 ? (
        <div style={{ padding: 12 }}>??? ??????????.</div>
      ) : (
        <div className="transactions-table" ref={printAreaRef}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={thStyle}>????</th>
                <th style={thStyle}>???</th>
                <th style={thStyle}>?????</th>
                <th style={thStyle}>??????</th>
                <th style={thStyle}>???-??</th>
                <th style={thStyle}>???</th>
                <th style={thStyle}>???????????</th>
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
