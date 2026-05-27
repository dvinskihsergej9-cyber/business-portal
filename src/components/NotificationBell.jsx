import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { API_BASE, normalizeErrorMessage } from "../apiConfig";
import { ensurePushSubscription as ensurePushSubscriptionShared } from "../utils/pushSubscription";

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [toasts, setToasts] = useState([]);
  const [isMobile, setIsMobile] = useState(false);
  const wrapperRef = useRef(null);
  const toastIdRef = useRef(0);
  const toastTimersRef = useRef(new Map());
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
      const result = await ensurePushSubscriptionShared({
        token,
        interactive,
        forceRebind: Boolean(interactive),
      });
      return Boolean(result?.subscribed);
    },
    [token]
  );

  const handleBellToggle = useCallback(() => {
    setOpen((prev) => !prev);
    // Клик по колокольчику — подходящий пользовательский жест для запроса разрешения
    // и перепривязки push-подписки на текущий аккаунт/устройство.
    ensurePushSubscription({ interactive: true }).catch(() => null);
  }, [ensurePushSubscription]);

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

  const isLowStockNotification = useCallback((item) => {
    const type = String(item?.type || "").trim().toUpperCase();
    const scope = String(item?.payloadJson?.scope || "").trim().toLowerCase();
    return type === "LOW_STOCK_SUMMARY" || scope === "low_stock_summary";
  }, []);

  const createSupplierOrdersFromNotification = useCallback(
    async (id) => {
      const res = await fetch(`${API_BASE}/notifications/${id}/create-supplier-orders`, {
        method: "POST",
        headers: authHeaders,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const message = String(data?.message || "").trim();
        const detail = String(data?.detail || "").trim();
        const looksLikeCode = /^[A-Z0-9_]+$/.test(message);
        throw new Error(
          looksLikeCode && detail
            ? detail
            : message || "Не удалось сформировать заказы поставщикам."
        );
      }
      return data || {};
    },
    [authHeaders]
  );

  const pushToast = useCallback((message, type = "success") => {
    const text = String(message || "").trim();
    if (!text) return;
    const id = ++toastIdRef.current;
    setToasts((prev) => [...prev, { id, message: text, type }]);
    const timerId = window.setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== id));
      toastTimersRef.current.delete(id);
    }, 4200);
    toastTimersRef.current.set(id, timerId);
  }, []);

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

  useEffect(() => {
    return () => {
      for (const timerId of toastTimersRef.current.values()) {
        clearTimeout(timerId);
      }
      toastTimersRef.current.clear();
    };
  }, []);

  return (
    <div ref={wrapperRef} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={handleBellToggle}
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
                  const notificationId = Number(item?.id || 0);
                  if (!notificationId) return;

                  if (isLowStockNotification(item)) {
                    pushToast("Формируем заказы поставщикам...", "info");
                    try {
                      const result = await createSupplierOrdersFromNotification(notificationId);
                      const createdOrders = Array.isArray(result?.createdOrders)
                        ? result.createdOrders
                        : [];
                      const unresolvedItems = Array.isArray(result?.unresolvedItems)
                        ? result.unresolvedItems
                        : [];
                      const createdCount = createdOrders.length;

                      setItems((prev) =>
                        prev.map((entry) =>
                          entry.id === notificationId
                            ? {
                                ...entry,
                                isRead: true,
                                readAt: entry.readAt || new Date().toISOString(),
                              }
                            : entry
                        )
                      );
                      if (!item.isRead) {
                        setUnreadCount((prev) => Math.max(0, prev - 1));
                      }

                      if (createdCount === 1) {
                        const createdOrderId = Number(createdOrders[0]?.id || 0);
                        pushToast("Заказ создан и открыт.", "success");
                        if (createdOrderId > 0) {
                          navigate(
                            `/warehouse?section=suppliers&suppliersTab=orders&poId=${createdOrderId}`
                          );
                        } else {
                          navigate("/warehouse?section=suppliers&suppliersTab=orders");
                        }
                        if (unresolvedItems.length > 0) {
                          pushToast(
                            `Требуют выбора поставщика: ${unresolvedItems.length}.`,
                            "warning"
                          );
                        }
                      } else if (createdCount > 1) {
                        pushToast(`Создано заказов: ${createdCount}.`, "success");
                        navigate("/warehouse?section=suppliers&suppliersTab=orders");
                        if (unresolvedItems.length > 0) {
                          pushToast(
                            `Требуют выбора поставщика: ${unresolvedItems.length}.`,
                            "warning"
                          );
                        }
                      } else if (unresolvedItems.length > 0) {
                        pushToast(
                          `Заказы не созданы. Требуют выбора поставщика: ${unresolvedItems.length}.`,
                          "warning"
                        );
                      } else {
                        pushToast("Заказы не созданы: нет позиций ниже минимума.", "warning");
                        if (item.linkUrl) {
                          openNotificationLink(item.linkUrl);
                        }
                      }
                      setOpen(false);
                    } catch (err) {
                      pushToast(
                        normalizeErrorMessage(err, "Не удалось сформировать заказы поставщикам."),
                        "error"
                      );
                    }
                    return;
                  }

                  if (!item.isRead) {
                    await markRead(notificationId);
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
      {toasts.length > 0 && (
        <div
          style={{
            position: "fixed",
            top: 76,
            right: 10,
            display: "flex",
            flexDirection: "column",
            gap: 8,
            zIndex: 500,
            maxWidth: "min(92vw, 420px)",
          }}
        >
          {toasts.map((toast) => (
            <div
              key={toast.id}
              style={{
                borderRadius: 10,
                border: "1px solid #e5e7eb",
                background:
                  toast.type === "error"
                    ? "#fef2f2"
                    : toast.type === "warning"
                      ? "#fffbeb"
                      : toast.type === "info"
                        ? "#eff6ff"
                        : "#f0fdf4",
                color:
                  toast.type === "error"
                    ? "#991b1b"
                    : toast.type === "warning"
                      ? "#92400e"
                      : toast.type === "info"
                        ? "#1d4ed8"
                        : "#166534",
                boxShadow: "0 12px 24px rgba(15, 23, 42, 0.18)",
                fontSize: 13,
                padding: "10px 12px",
                lineHeight: 1.35,
              }}
            >
              {toast.message}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
