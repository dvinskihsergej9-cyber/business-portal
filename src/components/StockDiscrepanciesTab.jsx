import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../apiConfig";
import ResponsiveDataView from "./ResponsiveDataView";
import { useAuth } from "../context/AuthContext";

const statusLabel = (value) => (value === "CLOSED" ? "Архив" : "Открытые");

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
      const res = await apiFetch(
        `/warehouse/discrepancies?status=${status.toLowerCase()}`,
        { headers: authHeaders }
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || "Ошибка загрузки");
      }
      setItems(data.items || []);
    } catch (err) {
      setError(err.message || "Ошибка загрузки");
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
      const res = await apiFetch(
        `/warehouse/discrepancies/${closeTarget.id}/close`,
        {
          method: "PUT",
          headers: authHeaders,
          body: JSON.stringify({ closeNote }),
        }
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || "Не удалось закрыть");
      }
      setCloseTarget(null);
      setCloseNote("");
      await load();
    } catch (err) {
      setError(err.message || "Не удалось закрыть");
    } finally {
      setClosing(false);
    }
  };

  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <h3 style={{ margin: 0 }}>Косяки</h3>
        <div style={{ display: "inline-flex", gap: 8 }}>
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
        <div style={{ padding: 16 }}>Загрузка...</div>
      ) : items.length === 0 ? (
        <div style={{ padding: 16 }}>Нет расхождений.</div>
      ) : (
        <ResponsiveDataView
          rows={items}
          columns={[
            {
              key: "createdAt",
              label: "Date",
              render: (row) =>
                row.createdAt
                  ? new Date(row.createdAt).toLocaleString("ru-RU")
                  : "-",
            },
            {
              key: "location",
              label: "Location",
              render: (row) => row.location?.code || row.location?.name || "-",
            },
            {
              key: "item",
              label: "Item",
              render: (row) =>
                `${row.item?.name || "-"}${row.item?.sku ? ` (${row.item.sku})` : ""}`,
            },
            { key: "expectedQty", label: "Expected" },
            { key: "countedQty", label: "Counted" },
            { key: "delta", label: "Delta" },
            { key: "sessionId", label: "Session" },
            { key: "actions", label: "" },
          ]}
          renderRowDesktop={(row) => (
            <tr key={row.id}>
              <td style={tdStyle}>
                {row.createdAt
                  ? new Date(row.createdAt).toLocaleString("ru-RU")
                  : "-"}
              </td>
              <td style={tdStyle}>
                {row.location?.code || row.location?.name || "-"}
              </td>
              <td style={tdStyle}>
                {row.item?.name || "-"}
                {row.item?.sku ? ` (${row.item.sku})` : ""}
              </td>
              <td style={tdStyle}>{row.expectedQty}</td>
              <td style={tdStyle}>{row.countedQty}</td>
              <td style={tdStyle}>{row.delta}</td>
              <td style={tdStyle}>{row.sessionId || "-"}</td>
              <td style={tdStyle}>
                {status === "OPEN" && user?.role === "ADMIN" && (
                  <button
                    type="button"
                    className="btn btn--secondary"
                    onClick={() => setCloseTarget(row)}
                  >
                    ???????
                  </button>
                )}
              </td>
            </tr>
          )}
          tableClassName=""
          wrapperClassName=""
        />
      )}

      {closeTarget && (
        <div style={modalOverlay}>
          <div style={modalPanel}>
            <h4 style={{ marginTop: 0 }}>Закрыть расхождение</h4>
            <p style={{ marginTop: 0 }}>
              Укажите причину или комментарий к закрытию.
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
                Отмена
              </button>
              <button
                type="button"
                className="btn btn--primary"
                onClick={handleClose}
                disabled={closing}
              >
                {closing ? "Сохранение..." : "Закрыть"}
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
