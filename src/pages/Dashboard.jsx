import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { apiFetch } from "../apiConfig";

const PORTAL_READ_KEY = "portal_news_read";

export default function Dashboard() {
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN";

  const [portalItems, setPortalItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [expandedIds, setExpandedIds] = useState(() => new Set());
  const [readIds, setReadIds] = useState(() => {
    try {
      const raw = localStorage.getItem(PORTAL_READ_KEY);
      return new Set(raw ? JSON.parse(raw) : []);
    } catch (e) {
      return new Set();
    }
  });

  const token = localStorage.getItem("token");
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);

  const loadPortalNews = async () => {
    try {
      setLoading(true);
      setError("");
      const res = await apiFetch("/portal-news", { headers });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          data?.message || data?.error || "\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044c \u043d\u043e\u0432\u043e\u0441\u0442\u0438 \u043f\u043e\u0440\u0442\u0430\u043b\u0430"
        );
      }
      setPortalItems(Array.isArray(data?.items) ? data.items : []);
    } catch (e) {
      console.error(e);
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPortalNews();
    const timer = setInterval(loadPortalNews, 10 * 60 * 1000);
    return () => clearInterval(timer);
  }, []);

  const filteredNews = useMemo(() => {
    const term = search.trim().toLowerCase();
    return portalItems.filter((item) => {
      if (!term) return true;
      const title = item.title?.toLowerCase() || "";
      const body = item.body?.toLowerCase() || "";
      const tags = Array.isArray(item.tags)
        ? item.tags.join(" ").toLowerCase()
        : "";
      return title.includes(term) || body.includes(term) || tags.includes(term);
    });
  }, [portalItems, search]);

  const toggleRead = (id) => {
    setReadIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      localStorage.setItem(PORTAL_READ_KEY, JSON.stringify(Array.from(next)));
      return next;
    });
  };

  const toggleExpanded = (id) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const isNewItem = (dateStr, id) => {
    if (readIds.has(id)) return false;
    const date = new Date(dateStr);
    if (Number.isNaN(date.getTime())) return false;
    const diffDays = (Date.now() - date.getTime()) / (1000 * 60 * 60 * 24);
    return diffDays <= 7;
  };

  return (
    <div className="page" style={{ position: "relative", zIndex: 1 }}>
      <div className="page-header">
        <h1 className="page-title">\u041d\u043e\u0432\u043e\u0441\u0442\u0438 \u043f\u043e\u0440\u0442\u0430\u043b\u0430</h1>
        <p className="page-subtitle">
          \u041e\u0431\u043d\u043e\u0432\u043b\u0435\u043d\u0438\u044f \u043f\u043e\u0440\u0442\u0430\u043b\u0430, \u043f\u0440\u0430\u0432\u0438\u043b\u0430, \u043f\u0440\u043e\u0446\u0435\u0441\u0441\u044b \u0438 \u0438\u0437\u043c\u0435\u043d\u0435\u043d\u0438\u044f.
        </p>
      </div>

      <div
        style={{
          marginTop: 12,
          padding: 18,
          borderRadius: 18,
          background:
            "linear-gradient(140deg, rgba(255,255,255,0.75), rgba(255,255,255,0.55))",
          border: "1px solid rgba(255,255,255,0.6)",
          boxShadow: "0 20px 40px rgba(15, 23, 42, 0.12)",
          backdropFilter: "blur(10px)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            marginBottom: 14,
            flexWrap: "wrap",
          }}
        >
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 12,
              background: "linear-gradient(160deg, #1d4ed8, #60a5fa)",
              display: "grid",
              placeItems: "center",
              color: "#fff",
              fontWeight: 700,
            }}
          >
            N
          </div>
          <div style={{ flex: "1 1 auto" }}>
            <div style={{ fontSize: 22, fontWeight: 700 }}>\u041d\u043e\u0432\u043e\u0441\u0442\u0438</div>
            <div style={{ color: "#475569", fontSize: 13 }}>
              \u041e\u0431\u043d\u043e\u0432\u043b\u0435\u043d\u0438\u044f \u043f\u043e\u0440\u0442\u0430\u043b\u0430 \u0438 \u0432\u0430\u0436\u043d\u044b\u0435 \u0438\u0437\u043c\u0435\u043d\u0435\u043d\u0438\u044f.
            </div>
          </div>
          {isAdmin && (
            <Link
              className="btn btn--secondary btn--sm"
              to="/admin/portal-news"
              style={{
                marginLeft: "auto",
                width: "100%",
                maxWidth: 220,
                textAlign: "center",
              }}
            >
              \u0423\u043f\u0440\u0430\u0432\u043b\u0435\u043d\u0438\u0435 \u043d\u043e\u0432\u043e\u0441\u0442\u044f\u043c\u0438
            </Link>
          )}
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
          <input
            placeholder="\u041f\u043e\u0438\u0441\u043a \u043f\u043e \u0437\u0430\u0433\u043e\u043b\u043e\u0432\u043a\u0443 \u0438\u043b\u0438 \u0442\u0435\u043a\u0441\u0442\u0443"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ flex: "1 1 240px" }}
          />
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            onClick={loadPortalNews}
            style={{ width: "100%", maxWidth: 160 }}
          >
            \u041e\u0431\u043d\u043e\u0432\u0438\u0442\u044c
          </button>
        </div>

        {loading && <p>\u0417\u0430\u0433\u0440\u0443\u0437\u043a\u0430...</p>}
        {!loading && error && (
          <div className="alert alert--danger" style={{ marginBottom: 10 }}>
            {error}{" "}
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              onClick={loadPortalNews}
              style={{ marginLeft: 8 }}
            >
              \u041e\u0431\u043d\u043e\u0432\u0438\u0442\u044c?
            </button>
          </div>
        )}
        {!loading && !error && filteredNews.length === 0 && (
          <p className="text-muted">\u041d\u043e\u0432\u043e\u0441\u0442\u0435\u0439 \u043d\u0435\u0442.</p>
        )}

        {!loading && !error && filteredNews.length > 0 && (
          <div style={{ display: "grid", gap: 12 }}>
            {filteredNews.map((item) => {
              const tags = Array.isArray(item.tags) ? item.tags : [];
              const body = item.body || "";
              const isLong = body.length > 280;
              const isExpanded = expandedIds.has(item.id);
              const bodyText = isLong && !isExpanded ? `${body.slice(0, 280)}...` : body;

              return (
                <div key={item.id} className="card" style={{ margin: 0 }}>
                  <div className="card__body" style={{ padding: 14 }}>
                    <div
                      style={{
                        display: "flex",
                        gap: 10,
                        alignItems: "center",
                        flexWrap: "wrap",
                      }}
                    >
                      <span style={{ color: "#6b7280", fontSize: 13 }}>
                        {item.createdAt
                          ? new Date(item.createdAt).toLocaleDateString("ru-RU")
                          : "-"}
                      </span>
                      {isNewItem(item.createdAt, item.id) && (
                        <span
                          style={{
                            fontSize: 12,
                            color: "#16a34a",
                            fontWeight: 700,
                          }}
                        >
                          \u041d\u043e\u0432\u043e\u0435
                        </span>
                      )}
                      {tags.map((tag) => (
                        <span key={tag} style={{ fontSize: 12, color: "#475569" }}>
                          #{tag}
                        </span>
                      ))}
                    </div>
                    <div style={{ fontWeight: 700, fontSize: 16, marginTop: 8 }}>
                      {item.title}
                    </div>
                    <div
                      className="portal-text"
                      style={{ color: "#4b5563", fontSize: 14, marginTop: 6 }}
                    >
                      {bodyText}
                    </div>
                    <div style={{ display: "flex", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
                      {isLong && (
                        <button
                          type="button"
                          className="btn btn--secondary btn--sm"
                          onClick={() => toggleExpanded(item.id)}
                        >
                          {isExpanded ? "\u0421\u043a\u0440\u044b\u0442\u044c" : "\u041f\u043e\u0434\u0440\u043e\u0431\u043d\u0435\u0435"}
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn btn--primary btn--sm"
                        onClick={() => toggleRead(item.id)}
                      >
                        \u041e\u0442\u043c\u0435\u0442\u0438\u0442\u044c \u043a\u0430\u043a \u043f\u0440\u043e\u0447\u0438\u0442\u0430\u043d\u043e
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
