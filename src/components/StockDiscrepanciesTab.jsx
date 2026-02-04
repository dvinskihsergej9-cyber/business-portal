import { useEffect, useMemo, useState } from "react";
import { API_BASE } from "../apiConfig";
import { useAuth } from "../context/AuthContext";

const statusLabel = (value) =>
  value === "CLOSED" ? "\u0410\u0440\u0445\u0438\u0432" : "\u041e\u0442\u043a\u0440\u044b\u0442\u044b\u0435";

export default function StockDiscrepanciesTab() {
  const { user } = useAuth();
  const [status, setStatus] = useState("OPEN");
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [closeTarget, setCloseTarget] = useState(null);
  const [closeNote, setCloseNote] = useState("");
  const [closing, setClosing] = useState(false);

  const authHeaders = useMemo(() => {
    const token = localStorage.getItem("token");
    return {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
  }, []);

  const load = async () => {
    try {
      setLoading(true);
      setError("");
      const res = await fetch(
        `${API_BASE}/warehouse/discrepancies?status=${status.toLowerCase()}`,
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
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const handleClose = async () => {
    if (!closeTarget) return;
    try {
      setClosing(true);
      const res = await fetch(
        `${API_BASE}/warehouse/discrepancies/${closeTarget.id}/close`,
        {
          method: "PUT",
          headers: authHeaders,
          body: JSON.stringify({ closeNote }),
        }
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || "\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0437\u0430\u043a\u0440\u044b\u0442\u044c");
      }
      setCloseTarget(null);
      setCloseNote("");
      await load();
    } catch (err) {
      setError(err.message || "\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0437\u0430\u043a\u0440\u044b\u0442\u044c");
    } finally {
      setClosing(false);
    }
  };

  return (
    <div className="card discrepancies-card" style={{ padding: 16 }}>
      <div className="discrepancies-header">
        <h3 className="discrepancies-title" style={{ margin: 0 }}>
          {"\u041a\u043e\u0441\u044f\u043a\u0438"}
        </h3>
        <div className="discrepancies-tabs">
          {["OPEN", "CLOSED"].map((value) => (
            <button
              key={value}
              type="button"
              className={
                "btn btn--secondary" +
                (status === value ? " btn--primary" : "")
              }
              onClick={() => setStatus(value)}
            >
              {statusLabel(value)}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="alert alert--danger" style={{ marginTop: 12 }}>
          {error}
        </div>
      )}

      {loading ? (
        <div style={{ padding: 16 }}>{"\u0417\u0430\u0433\u0440\u0443\u0437\u043a\u0430..."}</div>
      ) : items.length === 0 ? (
        <div style={{ padding: 16 }}>{"\u041d\u0435\u0442 \u0440\u0430\u0441\u0445\u043e\u0436\u0434\u0435\u043d\u0438\u0439."}</div>
      ) : (
        <div className="discrepancies-table">
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={thStyle}>{"\u0414\u0430\u0442\u0430"}</th>
                <th style={thStyle}>{"\u042f\u0447\u0435\u0439\u043a\u0430"}</th>
                <th style={thStyle}>{"\u0422\u043e\u0432\u0430\u0440"}</th>
                <th style={thStyle}>{"\u0411\u044b\u043b\u043e"}</th>
                <th style={thStyle}>{"\u0424\u0430\u043a\u0442"}</th>
                <th style={thStyle}>{"\u0394"}</th>
                <th style={thStyle}>{"\u0421\u0435\u0441\u0441\u0438\u044f"}</th>
                <th style={thStyle}></th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => (
                <tr key={row.id} className="discrepancies-row">
                  <td data-label="date" style={tdStyle}>
                    {row.createdAt
                      ? new Date(row.createdAt).toLocaleString("ru-RU")
                      : "-"}
                  </td>
                  <td data-label="location" style={tdStyle}>
                    {row.location?.code || row.location?.name || "-"}
                  </td>
                  <td data-label="item" style={tdStyle}>
                    {row.item?.name || "-"}
                    {row.item?.sku ? ` (${row.item.sku})` : ""}
                    {Array.isArray(row.recentPickers) &&
                      row.recentPickers.length > 0 && (
                        <div style={{ marginTop: 6, fontSize: 12, color: "#64748b" }}>
                          {"\u041f\u043e\u0441\u043b\u0435\u0434\u043d\u0438\u0435 \u043e\u0442\u0431\u043e\u0440\u044b:"}
                          <div style={{ marginTop: 4, display: "grid", gap: 4 }}>
                            {row.recentPickers.map((pick) => (
                              <div key={pick.id}>
                                {pick.user?.name || "-"}{" "}
                                {pick.createdAt
                                  ? `? ${new Date(pick.createdAt).toLocaleString("ru-RU")}`
                                  : ""}
                                {pick.qty != null ? `, \u043a\u043e\u043b-\u0432\u043e ${pick.qty}` : ""}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
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
                  <td data-label="session" style={tdStyle}>
                    {row.sessionId || "-"}
                  </td>
                  <td data-label="actions" style={tdStyle}>
                    {status === "OPEN" && row.delta < 0 && user?.role === "ADMIN" && (
                      <button
                        type="button"
                        className="btn btn--primary"
                        onClick={() => setCloseTarget(row)}
                      >
                        {"\u041f\u043e\u0434\u0442\u0432\u0435\u0440\u0434\u0438\u0442\u044c \u0441\u043f\u0438\u0441\u0430\u043d\u0438\u0435"}
                      </button>
                    )}
                    {status === "OPEN" && row.delta < 0 && user?.role !== "ADMIN" && (
                      <div style={{ fontSize: 12, color: "#94a3b8" }}>
                        {"\u0422\u043e\u043b\u044c\u043a\u043e \u0430\u0434\u043c\u0438\u043d"}
                      </div>
                    )}
                    {status === "OPEN" &&
                      row.delta >= 0 &&
                      ["ADMIN", "EMPLOYEE"].includes(user?.role) && (
                        <button
                          type="button"
                          className="btn btn--secondary"
                          onClick={() => setCloseTarget(row)}
                        >
                          {"\u0417\u0430\u043a\u0440\u044b\u0442\u044c"}
                        </button>
                      )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {closeTarget && (
        <div style={modalOverlay}>
          <div style={modalPanel}>
            <h4 style={{ marginTop: 0 }}>
              {closeTarget?.delta < 0
                ? "\u041f\u043e\u0434\u0442\u0432\u0435\u0440\u0434\u0438\u0442\u044c \u0441\u043f\u0438\u0441\u0430\u043d\u0438\u0435"
                : "\u0417\u0430\u043a\u0440\u044b\u0442\u044c \u0440\u0430\u0441\u0445\u043e\u0436\u0434\u0435\u043d\u0438\u0435"}
            </h4>
            <p style={{ marginTop: 0 }}>
              {closeTarget?.delta < 0
                ? "\u041f\u043e\u0441\u043b\u0435 \u043f\u043e\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043d\u0438\u044f \u043e\u0441\u0442\u0430\u0442\u043a\u0438 \u0431\u0443\u0434\u0443\u0442 \u0441\u043f\u0438\u0441\u0430\u043d\u044b."
                : "\u0423\u043a\u0430\u0436\u0438\u0442\u0435 \u043f\u0440\u0438\u0447\u0438\u043d\u0443 \u0438\u043b\u0438 \u043a\u043e\u043c\u043c\u0435\u043d\u0442\u0430\u0440\u0438\u0439 \u043a \u0437\u0430\u043a\u0440\u044b\u0442\u0438\u044e."}
            </p>
            <textarea
              style={modalTextarea}
              rows={3}
              value={closeNote}
              onChange={(event) => setCloseNote(event.target.value)}
            />
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button
                type="button"
                className="btn btn--secondary"
                onClick={() => {
                  setCloseTarget(null);
                  setCloseNote("");
                }}
              >
                {"\u041e\u0442\u043c\u0435\u043d\u0430"}
              </button>
              <button
                type="button"
                className="btn btn--primary"
                onClick={handleClose}
                disabled={closing}
              >
                {closing ? "\u0421\u043e\u0445\u0440\u0430\u043d\u0435\u043d\u0438\u0435..." : "\u0417\u0430\u043a\u0440\u044b\u0442\u044c"}
              </button>
            </div>
          </div>
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

const modalOverlay = {
  position: "fixed",
  inset: 0,
  background: "rgba(15, 23, 42, 0.45)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 50,
};

const modalPanel = {
  background: "#fff",
  borderRadius: 12,
  padding: 16,
  width: "min(420px, 92vw)",
  boxShadow: "0 12px 30px rgba(15, 23, 42, 0.18)",
};

const modalTextarea = {
  width: "100%",
  borderRadius: 8,
  border: "1px solid #e5e7eb",
  padding: 8,
  fontFamily: "inherit",
};
