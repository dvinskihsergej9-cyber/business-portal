import { useEffect, useMemo, useState } from "react";
import portalNews from "../data/portalNews";
import { apiFetch } from "../apiConfig";

const CATEGORY_LABELS = {
  business: "Бизнес",
  tax: "Налоги/ФНС",
  hr: "Кадры",
};

const PORTAL_TYPE_LABELS = {
  all: "Все",
  feature: "Функционал",
  improvement: "Улучшение",
  fix: "Исправление",
};

const PORTAL_TYPE_COLORS = {
  feature: "#2563eb",
  improvement: "#0f766e",
  fix: "#b91c1c",
};

const PORTAL_READ_KEY = "portal_news_read";

export default function Dashboard() {
  const [news, setNews] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [category, setCategory] = useState("business");
  const [search, setSearch] = useState("");
  const [newsTab, setNewsTab] = useState("portal");
  const [portalSearch, setPortalSearch] = useState("");
  const [portalType, setPortalType] = useState("all");
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

  const loadNews = async (activeCategory = category) => {
    try {
      setLoading(true);
      setError("");
      const res = await apiFetch(`/news?category=${activeCategory}&limit=20`, { headers });
      const contentType = res.headers.get("content-type") || "";
      let data;
      if (contentType.includes("application/json")) {
        try {
          data = await res.json();
        } catch (err) {
          throw new Error("Не удалось загрузить новости (не JSON)");
        }
      } else {
        const text = await res.text();
        throw new Error("Ответ не JSON: " + text.slice(0, 120));
      }

      if (!res.ok) throw new Error(data?.message || data?.error || "Не удалось загрузить новости");
      setNews(Array.isArray(data?.items) ? data.items : []);
    } catch (e) {
      console.error(e);
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadNews(category);
    const timer = setInterval(() => loadNews(category), 10 * 60 * 1000);
    return () => clearInterval(timer);
  }, [category]);

  const filteredNews = useMemo(() => {
    const term = search.trim().toLowerCase();
    return news.filter((n) => {
      if (!term) return true;
      const title = n.title?.toLowerCase() || "";
      const summary = n.summary?.toLowerCase() || "";
      return title.includes(term) || summary.includes(term);
    });
  }, [news, search]);

  const portalFiltered = useMemo(() => {
    const term = portalSearch.trim().toLowerCase();
    return portalNews.filter((item) => {
      const byType = portalType === "all" || item.type === portalType;
      const byText =
        !term ||
        item.title.toLowerCase().includes(term) ||
        item.summary.toLowerCase().includes(term);
      return byType && byText;
    });
  }, [portalSearch, portalType]);

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
        <h1 className="page-title">Новости для бизнеса</h1>
        <p className="page-subtitle">Бизнес, налоги, трудоустройство, логистика.</p>
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
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
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
          <div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>Новости</div>
            <div style={{ color: "#475569", fontSize: 13 }}>Обновления портала и бизнес‑сводка</div>
          </div>
        </div>

        <div style={{ display: "inline-flex", background: "#0f172a", borderRadius: 999, padding: 4, marginBottom: 16 }}>
          {[
            { id: "portal", label: "Новости портала" },
            { id: "business", label: "Новости для бизнеса" },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setNewsTab(tab.id)}
              style={{
                border: "none",
                padding: "8px 16px",
                borderRadius: 999,
                color: newsTab === tab.id ? "#0f172a" : "#e2e8f0",
                background: newsTab === tab.id ? "#f8fafc" : "transparent",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {newsTab === "portal" && (
          <div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
              <input
                placeholder="Поиск по обновлениям"
                value={portalSearch}
                onChange={(e) => setPortalSearch(e.target.value)}
                style={{ flex: "1 1 260px" }}
              />
              <select value={portalType} onChange={(e) => setPortalType(e.target.value)} style={{ width: 220 }}>
                {Object.entries(PORTAL_TYPE_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ display: "grid", gap: 14 }}>
              {portalFiltered.map((item) => (
                <div key={item.id} style={{ display: "grid", gridTemplateColumns: "110px 1fr", gap: 14 }}>
                  <div style={{ color: "#475569", fontWeight: 600, textAlign: "right", paddingTop: 8 }}>
                    {new Date(item.date).toLocaleDateString("ru-RU")}
                  </div>
                  <div
                    style={{
                      position: "relative",
                      padding: "14px 16px",
                      borderRadius: 16,
                      background: "linear-gradient(135deg, rgba(15,23,42,0.06), rgba(99,102,241,0.08))",
                      border: "1px solid rgba(148,163,184,0.35)",
                    }}
                  >
                    <div
                      style={{
                        position: "absolute",
                        left: 0,
                        top: 0,
                        bottom: 0,
                        width: 4,
                        borderRadius: "16px 0 0 16px",
                        background: PORTAL_TYPE_COLORS[item.type] || "#1d4ed8",
                      }}
                    />
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <span
                        style={{
                          fontSize: 12,
                          fontWeight: 700,
                          padding: "2px 8px",
                          borderRadius: 999,
                          background: `${PORTAL_TYPE_COLORS[item.type]}22`,
                          color: PORTAL_TYPE_COLORS[item.type],
                        }}
                      >
                        {PORTAL_TYPE_LABELS[item.type] || "Обновление"}
                      </span>
                      {item.tags.map((tag) => (
                        <span key={tag} style={{ fontSize: 12, color: "#475569" }}>
                          #{tag}
                        </span>
                      ))}
                      {isNewItem(item.date, item.id) && (
                        <span style={{ fontSize: 12, color: "#16a34a", fontWeight: 700 }}>Новое</span>
                      )}
                    </div>
                    <div style={{ fontSize: 16, fontWeight: 700, marginTop: 6 }}>{item.title}</div>
                    <div style={{ color: "#475569", marginTop: 6 }}>{item.summary}</div>
                    {expandedIds.has(item.id) && (
                      <ul style={{ marginTop: 8, paddingLeft: 16, color: "#475569" }}>
                        {item.details.map((d) => (
                          <li key={d}>{d}</li>
                        ))}
                      </ul>
                    )}
                    {item.links?.length ? (
                      <div style={{ display: "flex", gap: 10, marginTop: 8, flexWrap: "wrap" }}>
                        {item.links.map((link) => (
                          <a key={link.href} href={link.href} target="_blank" rel="noreferrer">
                            {link.label}
                          </a>
                        ))}
                      </div>
                    ) : null}
                    <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
                      <button
                        type="button"
                        className="btn btn--secondary btn--sm"
                        onClick={() => toggleExpanded(item.id)}
                      >
                        {expandedIds.has(item.id) ? "Скрыть" : "Подробнее"}
                      </button>
                      <button
                        type="button"
                        className="btn btn--primary btn--sm"
                        onClick={() => toggleRead(item.id)}
                      >
                        Отметить как прочитано
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {newsTab === "business" && (
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
              <div className="tabs tabs--sm">
                {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
                  <button
                    key={key}
                    className={"tabs__btn" + (category === key ? " tabs__btn--active" : "")}
                    type="button"
                    onClick={() => setCategory(key)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="btn btn--secondary btn--sm"
                onClick={loadNews}
                style={{ marginLeft: "auto" }}
              >
                Обновить
              </button>
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
              <input
                placeholder="Поиск по заголовку"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ flex: "1 1 240px" }}
              />
            </div>

            {loading && <p>Загружаем...</p>}
            {!loading && error && (
              <div className="alert alert--danger" style={{ marginBottom: 10 }}>
                {error}{" "}
                <button type="button" className="btn btn--secondary btn--sm" onClick={loadNews} style={{ marginLeft: 8 }}>
                  Повторить
                </button>
              </div>
            )}
            {!loading && !error && filteredNews.length === 0 && <p className="text-muted">Новостей нет.</p>}

            {!loading && !error && filteredNews.length > 0 && (
              <div style={{ display: "grid", gap: 10 }}>
                {filteredNews.slice(0, 20).map((n) => (
                  <div key={n.id} className="card" style={{ margin: 0 }}>
                    <div className="card__body" style={{ padding: 12 }}>
                      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 6 }}>
                        <span
                          style={{
                            display: "inline-block",
                            padding: "2px 8px",
                            borderRadius: 999,
                            fontSize: 12,
                            background: "#eef2ff",
                            color: "#4338ca",
                          }}
                        >
                          {CATEGORY_LABELS[n.category] || "Бизнес"}
                        </span>
                        <span style={{ color: "#6b7280", fontSize: 13 }}>{n.source}</span>
                        <span style={{ color: "#6b7280", fontSize: 13 }}>
                          {n.publishedAt ? new Date(n.publishedAt).toLocaleString("ru-RU") : "-"}
                        </span>
                        <a
                          className="btn btn--primary btn--sm"
                          href={n.link || n.url}
                          target="_blank"
                          rel="noreferrer"
                          style={{ marginLeft: "auto" }}
                        >
                          Открыть
                        </a>
                      </div>
                      <div style={{ fontWeight: 600, marginBottom: 4 }}>{n.title}</div>
                      {n.summary && <div style={{ color: "#4b5563", fontSize: 13 }}>{n.summary}</div>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
