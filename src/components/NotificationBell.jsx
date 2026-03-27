import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { API_BASE } from "../apiConfig";
import { ensurePushSubscription as ensurePushSubscriptionShared } from "../utils/pushSubscription";

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [isMobile, setIsMobile] = useState(false);
  const wrapperRef = useRef(null);
  const navigate = useNavigate();

  const token = localStorage.getItem("token") || "";
  const authHeaders = useMemo(
    () => ({ Authorization: `Bearer ${token}`, "Content-Type": "application/json" }),
    [token]
  );

  const loadUnreadCount = async () => {
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE}/notifications/unread-count`, {
        headers: { Authorization: authHeaders.Authorization },
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setUnreadCount(Number(data?.unreadCount || 0));
      }
    } catch {
      // no-op
    }
  };

  const loadNotifications = async () => {
    if (!token) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${API_BASE}/notifications?limit=25`, {
        headers: { Authorization: authHeaders.Authorization },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.message || "Ошибка загрузки уведомлений");
      }
      setItems(Array.isArray(data?.items) ? data.items : []);
      setUnreadCount(Number(data?.unreadCount || 0));
    } catch (err) {
      setError(err?.message || "Ошибка загрузки уведомлений");
    } finally {
      setLoading(false);
    }
  };

  const markRead = async (id) => {
    if (!id) return;
    try {
      await fetch(`${API_BASE}/notifications/${id}/read`, {
        method: "POST",
        headers: authHeaders,
      });
      setItems((prev) =>
        prev.map((item) =>
          item.id === id
            ? { ...item, isRead: true, readAt: new Date().toISOString() }
            : item
        )
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch {
      // no-op
    }
  };

  const markAllRead = async () => {
    try {
      await fetch(`${API_BASE}/notifications/read-all`, {
        method: "POST",
        headers: authHeaders,
      });
      setItems((prev) =>
        prev.map((item) => ({
          ...item,
          isRead: true,
          readAt: item.readAt || new Date().toISOString(),
        }))
      );
      setUnreadCount(0);
    } catch {
      // no-op
    }
  };

  const ensurePushSubscription = useCallback(
    async ({ interactive = false } = {}) => {
      const result = await ensurePushSubscriptionShared({ token, interactive });
      return Boolean(result?.subscribed);
    },
    [token]
  );

  const openNotificationLink = useCallback(
    (linkUrl) => {
      if (!linkUrl) return;
      try {
        const normalized = new URL(linkUrl, window.location.origin);
        if (normalized.origin === window.location.origin) {
          navigate(`${normalized.pathname}${normalized.search}${normalized.hash}`);
          return;
        }
      } catch {
        // fallback to full reload
      }
      window.location.href = linkUrl;
    },
    [navigate]
  );

  useEffect(() => {
    if (!token) return;
    loadUnreadCount();
    const intervalId = setInterval(loadUnreadCount, 30000);
    return () => clearInterval(intervalId);
  }, [token]);

  useEffect(() => {
    if (!open) return;
    loadNotifications();
  }, [open]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 860px)");
    const onChange = () => setIsMobile(media.matches);
    onChange();
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    const onDocClick = (event) => {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(event.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  useEffect(() => {
    ensurePushSubscription({ interactive: false }).catch(() => {
      // no-op: push может быть недоступен в браузере/окружении.
    });
  }, [ensurePushSubscription]);

  return (
    <div ref={wrapperRef} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        style={{
          width: 36,
          height: 36,
          borderRadius: 10,
          border: "1px solid #d1d5db",
          background: "#ffffff",
          color: "#0f172a",
          cursor: "pointer",
          position: "relative",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 0,
        }}
        aria-label="Уведомления"
      >
        <span
          style={{
            fontSize: 19,
            lineHeight: 1,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: "100%",
            height: "100%",
          }}
        >
          🔔
        </span>
        {unreadCount > 0 && (
          <span
            style={{
              position: "absolute",
              top: -6,
              right: -6,
              minWidth: 18,
              height: 18,
              borderRadius: 999,
              background: "#dc2626",
              color: "#fff",
              fontSize: 11,
              lineHeight: "18px",
              padding: "0 4px",
              fontWeight: 700,
            }}
          >
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          style={{
            position: isMobile ? "fixed" : "absolute",
            right: isMobile ? 8 : 0,
            left: isMobile ? 8 : "auto",
            top: isMobile ? 72 : 44,
            width: isMobile ? "auto" : "min(340px, calc(100vw - 20px))",
            maxHeight: "min(70vh, 420px)",
            overflow: "auto",
            border: "1px solid #dbeafe",
            borderRadius: 12,
            background: "#fff",
            boxShadow: "0 14px 30px rgba(15, 23, 42, 0.16)",
            zIndex: 120,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 8,
              padding: "10px 12px",
              borderBottom: "1px solid #e5e7eb",
            }}
          >
            <strong style={{ fontSize: 14 }}>Уведомления</strong>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button
                type="button"
                onClick={markAllRead}
                style={{
                  border: "none",
                  background: "transparent",
                  color: "#2563eb",
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                Прочитать все
              </button>
            </div>
          </div>

          {loading && <div style={{ padding: 12, fontSize: 13 }}>Загрузка...</div>}
          {error && !loading && (
            <div style={{ padding: 12, color: "#b91c1c", fontSize: 13 }}>
              {error}
            </div>
          )}

          {!loading && !error && items.length === 0 && (
            <div style={{ padding: 12, color: "#64748b", fontSize: 13 }}>
              Новых уведомлений нет.
            </div>
          )}

          {!loading &&
            !error &&
            items.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={async () => {
                  if (!item.isRead) {
                    await markRead(item.id);
                  }
                  if (item.linkUrl) {
                    openNotificationLink(item.linkUrl);
                  }
                  setOpen(false);
                }}
                style={{
                  width: "100%",
                  textAlign: "left",
                  border: "none",
                  borderBottom: "1px solid #f1f5f9",
                  background: item.isRead ? "#fff" : "#eff6ff",
                  padding: "10px 12px",
                  cursor: "pointer",
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 600, color: "#0f172a" }}>
                  {item.title}
                </div>
                <div
                  style={{
                    marginTop: 4,
                    fontSize: 12,
                    color: "#334155",
                    whiteSpace: "normal",
                  }}
                >
                  {item.message}
                </div>
                <div style={{ marginTop: 6, fontSize: 11, color: "#64748b" }}>
                  {item.createdAt
                    ? new Date(item.createdAt).toLocaleString("ru-RU")
                    : ""}
                </div>
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
