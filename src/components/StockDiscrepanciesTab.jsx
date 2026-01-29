import { useEffect, useMemo, useState } from "react";
import { API_BASE } from "../apiConfig";
import { useAuth } from "../context/AuthContext";

const statusLabel = (value) => (value === "CLOSED" ? "РђСЂС…РёРІ" : "РћС‚РєСЂС‹С‚С‹Рµ");

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
        throw new Error(data.message || "РћС€РёР±РєР° Р·Р°РіСЂСѓР·РєРё");
      }
      setItems(data.items || []);
    } catch (err) {
      setError(err.message || "РћС€РёР±РєР° Р·Р°РіСЂСѓР·РєРё");
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
        throw new Error(data.message || "РќРµ СѓРґР°Р»РѕСЃСЊ Р·Р°РєСЂС‹С‚СЊ");
      }
      setCloseTarget(null);
      setCloseNote("");
      await load();
    } catch (err) {
      setError(err.message || "РќРµ СѓРґР°Р»РѕСЃСЊ Р·Р°РєСЂС‹С‚СЊ");
    } finally {
      setClosing(false);
    }
  };

  return (
    <div className="card discrepancies-card" style={{ padding: 16 }}>
      <div className="discrepancies-header">
        <h3 className="discrepancies-title" style={{ margin: 0 }}>
          РљРѕСЃСЏРєРё
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
        <div style={{ padding: 16 }}>Р—Р°РіСЂСѓР·РєР°...</div>
      ) : items.length === 0 ? (
        <div style={{ padding: 16 }}>РќРµС‚ СЂР°СЃС…РѕР¶РґРµРЅРёР№.</div>
      ) : (
        <div className="discrepancies-table">
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={thStyle}>Р”Р°С‚Р°</th>
                <th style={thStyle}>РЇС‡РµР№РєР°</th>
                <th style={thStyle}>РўРѕРІР°СЂ</th>
                <th style={thStyle}>Р‘С‹Р»Рѕ</th>
                <th style={thStyle}>Р¤Р°РєС‚</th>
                <th style={thStyle}>О”</th>
                <th style={thStyle}>РЎРµСЃСЃРёСЏ</th>
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
                    {status === "OPEN" && ["ADMIN", "EMPLOYEE"].includes(user?.role) && (
                      <button
                        type="button"
                        className="btn btn--secondary"
                        onClick={() => setCloseTarget(row)}
                      >
                        Р—Р°РєСЂС‹С‚СЊ
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
            <h4 style={{ marginTop: 0 }}>Р—Р°РєСЂС‹С‚СЊ СЂР°СЃС…РѕР¶РґРµРЅРёРµ</h4>
            <p style={{ marginTop: 0 }}>
              РЈРєР°Р¶РёС‚Рµ РїСЂРёС‡РёРЅСѓ РёР»Рё РєРѕРјРјРµРЅС‚Р°СЂРёР№ Рє Р·Р°РєСЂС‹С‚РёСЋ.
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
                РћС‚РјРµРЅР°
              </button>
              <button
                type="button"
                className="btn btn--primary"
                onClick={handleClose}
                disabled={closing}
              >
                {closing ? "РЎРѕС…СЂР°РЅРµРЅРёРµ..." : "Р—Р°РєСЂС‹С‚СЊ"}
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
