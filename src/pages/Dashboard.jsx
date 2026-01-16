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
        throw new Error(data?.message || data?.error || "?? ??????? ????????? ??????? ???????");
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
      const tags = Array.isArray(item.tags) ? item.tags.join(" ").toLowerCase() : "";
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
        <h1 className="page-title">??????? ???????</h1>
        <p className="page-subtitle">?????????? ???????, ???????, ???????? ? ?????????.</p>
      </div>

      <div
        style={{
          marginTop: 12,
          padding: 18,
          borderRadius: 18,
          background: "linear-gradient(140deg, rgba(255,255,255,0.75), rgba(255,255,255,0.55))",
          border: "1px solid rgba(255,255,255,0.6)",
          boxShadow: "0 20px 40px rgba(15, 23, 42, 0.12)",
          backdropFilter: "blur(10px)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
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
            <div style={{ fontSize: 22, fontWeight: 700 }}>???????</div>
            <div style={{ color: "#475569", fontSize: 13 }}>?????????? ??????? ? ?????? ?????????.</div>
          </div>
          {isAdmin && (
            <Link
              className="btn btn--secondary btn--sm"
              to="/admin/portal-news"
              style={{ marginLeft: "auto", width: "100%", maxWidth: 220, textAlign: "center" }}
            >
              ?????????? ?????????
            </Link>
          )}
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
          <input
            placeholder="????? ?? ????????? ??? ??????"
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
            ????????
          </button>
        </div>

        {loading && <p>????????...</p>}
        {!loading && error && (
          <div className="alert alert--danger" style={{ marginBottom: 10 }}>
            {error}{" "}
            <button type="button" className="btn btn--secondary btn--sm" onClick={loadPortalNews} style={{ marginLeft: 8 }}>
              ?????????
            </button>
          </div>
        )}
        {!loading && !error && filteredNews.length === 0 && <p className="text-muted">???????? ???.</p>}

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
                    <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                      <span style={{ color: "#6b7280", fontSize: 13 }}>
                        {item.createdAt ? new Date(item.createdAt).toLocaleDateString("ru-RU") : "-"}
                      </span>
                      {isNewItem(item.createdAt, item.id) && (
                        <span style={{ fontSize: 12, color: "#16a34a", fontWeight: 700 }}>?????</span>
                      )}
                      {tags.map((tag) => (
                        <span key={tag} style={{ fontSize: 12, color: "#475569" }}>
                          #{tag}
                        </span>
                      ))}
                    </div>
                    <div style={{ fontWeight: 700, fontSize: 16, marginTop: 8 }}>{item.title}</div>
                    <div className="portal-text" style={{ color: "#4b5563", fontSize: 14, marginTop: 6 }}>
                      {bodyText}
                    </div>
                    <div style={{ display: "flex", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
                      {isLong && (
                        <button
                          type="button"
                          className="btn btn--secondary btn--sm"
                          onClick={() => toggleExpanded(item.id)}
                        >
                          {isExpanded ? "??????" : "?????????"}
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn btn--primary btn--sm"
                        onClick={() => toggleRead(item.id)}
                      >
                        ???????? ??? ?????????
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
