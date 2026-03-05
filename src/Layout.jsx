import { useEffect, useMemo, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "./context/AuthContext";
import { hasPermission, PERMISSION_KEYS } from "./utils/permissions";

export default function Layout() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [isMobile, setIsMobile] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const menu = [
    {
      label: "\u0421\u043a\u043b\u0430\u0434",
      to: "/warehouse",
      permission: PERMISSION_KEYS.APP_WAREHOUSE,
    },
    {
      label: "\u0422\u041c\u0426 \u0438 \u0420\u041c",
      to: "/tmc",
      permission: PERMISSION_KEYS.APP_TMC,
    },
    {
      label: "\u0410\u0434\u043c\u0438\u043d\u0438\u0441\u0442\u0440\u0438\u0440\u043e\u0432\u0430\u043d\u0438\u0435",
      to: "/admin",
      permission: PERMISSION_KEYS.APP_ADMIN,
    },
  ];

  const allowedMenu = user
    ? menu.filter((item) => hasPermission(user, item.permission))
    : [];

  const pageTitle = useMemo(() => {
    if (location.pathname.startsWith("/admin")) return "\u0410\u0434\u043c\u0438\u043d\u0438\u0441\u0442\u0440\u0438\u0440\u043e\u0432\u0430\u043d\u0438\u0435";
    if (location.pathname.startsWith("/tmc")) return "\u0422\u041c\u0426 \u0438 \u0420\u041c";
    if (location.pathname.startsWith("/warehouse")) return "\u0421\u043a\u043b\u0430\u0434";
    return "\u0421\u043a\u043b\u0430\u0434\u041e\u043d\u043b\u0430\u0439\u043d";
  }, [location.pathname]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 768px)");
    const onChange = () => setIsMobile(media.matches);
    onChange();
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    if (drawerOpen) {
      setDrawerOpen(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  useEffect(() => {
    if (!drawerOpen) return;
    const onKeyDown = (e) => {
      if (e.key === "Escape") setDrawerOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [drawerOpen]);

  const handleLogout = () => {
    logout();
  };

  const rootStyle = isMobile ? styles.rootMobile : styles.root;
  const sidebarStyle = isMobile
    ? { ...styles.sidebar, display: "none" }
    : styles.sidebar;
  const headerStyle = isMobile
    ? { ...styles.header, ...styles.headerMobile }
    : styles.header;

  return (
    <div style={rootStyle}>
      {/* Сайдбар */}
      <aside style={sidebarStyle}>
        {/* Лого / название */}
        <div style={styles.logoBlock}>
          <div style={styles.logoMark} />
          <div>
            <div style={styles.logoTitle}>СкладОнлайн</div>
            <div style={styles.logoSubtitle}>Внутренний сервис компании</div>
          </div>
        </div>

        {/* Карточка пользователя */}
        {user && (
          <div style={styles.userCard}>
            <div style={styles.userName}>{user.name}</div>
            <div style={styles.userEmail}>{user.login || user.username || user.email}</div>
            <div style={styles.userRole}>{user.role}</div>
          </div>
        )}

        {/* Навигация */}
        <nav style={styles.nav} className="sidebar-nav">
          {allowedMenu.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={() => setDrawerOpen(false)}
              style={({ isActive }) =>
                isActive
                  ? { ...styles.navItem, ...styles.navItemActive }
                  : styles.navItem
              }
            >
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>

      </aside>

      {/* Правая часть: шапка + контент */}
      <div style={styles.main}>
        <header style={headerStyle} className="portal-header">
          <div style={styles.headerRow}>
            <div style={styles.headerLeft}>
              {isMobile && (
                <button
                  type="button"
                  onClick={() => setDrawerOpen(true)}
                  style={styles.burgerBtn}
                  aria-label="Открыть меню"
                  aria-expanded={drawerOpen}
                >
                  ☰
                </button>
              )}
              <div>
                <div style={styles.headerTitle}>{pageTitle}</div>
                <div style={styles.headerSubtitle}>
                  {user
                    ? `Пользователь: ${user.name} (${user.role})`
                    : "Вы не авторизованы"}
                </div>
              </div>
            </div>
            <div style={styles.headerActions}>
              {!isMobile && (
                <div style={styles.headerUserInfo}>
                  {user?.name || "Пользователь"}
                </div>
              )}
              <button
                type="button"
                style={styles.headerLogoutBtn}
                onClick={handleLogout}
              >
                Выйти
              </button>
            </div>
          </div>
        </header>

        <main style={styles.content} className="portal-surface">
          <Outlet />
        </main>
      </div>

      {/* Мобильное меню (drawer) */}
      {isMobile && drawerOpen && (
        <div
          style={styles.drawerOverlay}
          onClick={() => setDrawerOpen(false)}
          role="presentation"
        >
          <aside
            style={styles.drawerPanel}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Навигация"
          >
            <div style={styles.drawerHeader}>
              <div style={styles.logoMark} />
              <div>
                <div style={styles.logoTitle}>СкладОнлайн</div>
                <div style={styles.logoSubtitle}>Меню</div>
              </div>
            </div>

            <nav style={styles.drawerNav} className="sidebar-nav">
              {allowedMenu.map((item) => (
                <NavLink
                  key={`drawer-${item.to}`}
                  to={item.to}
                  onClick={() => setDrawerOpen(false)}
                  style={({ isActive }) =>
                    isActive
                      ? { ...styles.navItem, ...styles.navItemActive }
                      : styles.navItem
                  }
                >
                  <span>{item.label}</span>
                </NavLink>
              ))}
            </nav>

          </aside>
        </div>
      )}
    </div>
  );
}

const styles = {
  root: {
    display: "flex",
    minHeight: "100vh",
  },
  rootMobile: {
    display: "block",
    minHeight: "100vh",
  },
  sidebar: {
    width: 260,
    background: "#ffffff",
    color: "#111827",
    display: "flex",
    flexDirection: "column",
    padding: "20px 16px",
    boxSizing: "border-box",
    borderRight: "1px solid #e5e7eb",
    boxShadow: "2px 0 6px rgba(15, 23, 42, 0.04)",
    backdropFilter: "blur(4px)",
  },
  logoBlock: {
    display: "flex",
    alignItems: "center",
    marginBottom: 24,
    padding: "8px 10px",
    borderRadius: 12,
    background: "#eff6ff",
    border: "1px solid #dbeafe",
    gap: 10,
  },
  logoMark: {
    width: 28,
    height: 28,
    borderRadius: 8,
    background:
      "linear-gradient(135deg, #2563eb 0%, #1e40af 40%, #93c5fd 100%)",
  },
  logoTitle: {
    fontSize: 16,
    fontWeight: 600,
  },
  logoSubtitle: {
    fontSize: 11,
    color: "#6b7280",
  },
  userCard: {
    background: "#f9fafb",
    borderRadius: 12,
    padding: "12px 14px",
    marginBottom: 20,
    border: "1px solid #e5e7eb",
  },
  userName: {
    fontSize: 15,
    fontWeight: 600,
  },
  userEmail: {
    fontSize: 12,
    color: "#6b7280",
    marginTop: 2,
  },
  userRole: {
    fontSize: 11,
    marginTop: 6,
    textTransform: "uppercase",
    color: "#2563eb",
    letterSpacing: 0.5,
  },
  nav: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    gap: 6,
    marginTop: 4,
  },
  navItem: {
    display: "flex",
    alignItems: "center",
    padding: "8px 10px",
    borderRadius: 8,
    textDecoration: "none",
    color: "#374151",
    fontSize: 14,
    gap: 8,
    background: "transparent",
    border: "1px solid #111827", // чёрная рамка всегда
    transition:
      "background 0.15s ease, color 0.15s ease, border 0.15s ease, box-shadow 0.15s ease",
  },
  navItemActive: {
    background: "#ffffff",
    color: "#1d4ed8",
    borderColor: "#2563eb", // активный — синяя рамка
    boxShadow: "0 0 0 1px rgba(37, 99, 235, 0.12)",
    fontWeight: 600,
  },
  main: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
  },
  header: {
    padding: "14px 26px",
    background: "rgba(255,255,255,0.9)",
    borderBottom: "1px solid #e5e7eb",
    boxShadow: "0 1px 4px rgba(15, 23, 42, 0.04)",
    backdropFilter: "blur(6px)",
    position: "sticky",
    top: 0,
    zIndex: 5,
  },
  headerMobile: {
    padding: "12px 14px",
  },
  headerRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  headerLeft: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    minWidth: 0,
  },
  headerActions: {
    display: "inline-flex",
    alignItems: "center",
    gap: 10,
    marginLeft: 12,
    flexShrink: 0,
  },
  headerUserInfo: {
    fontSize: 13,
    color: "#4b5563",
    whiteSpace: "nowrap",
  },
  headerLogoutBtn: {
    padding: "7px 12px",
    borderRadius: 8,
    border: "1px solid #d1d5db",
    background: "#ffffff",
    color: "#111827",
    fontSize: 13,
    cursor: "pointer",
    textAlign: "center",
    whiteSpace: "nowrap",
  },
  burgerBtn: {
    width: 40,
    height: 40,
    borderRadius: 10,
    border: "1px solid #e5e7eb",
    background: "#ffffff",
    color: "#0f172a",
    fontSize: 20,
    lineHeight: 1,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 600,
  },
  headerSubtitle: {
    fontSize: 13,
    color: "#6b7280",
    marginTop: 2,
  },
  content: {
    padding: "0",
    flex: 1,
    boxSizing: "border-box",
  },
  drawerOverlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(15, 23, 42, 0.45)",
    zIndex: 60,
    display: "flex",
    alignItems: "stretch",
  },
  drawerPanel: {
    width: "min(84vw, 320px)",
    background: "#ffffff",
    borderRight: "1px solid #e5e7eb",
    boxShadow: "8px 0 24px rgba(15, 23, 42, 0.18)",
    padding: "16px 14px 20px",
    display: "flex",
    flexDirection: "column",
    gap: 12,
    animation: "portal-rise 0.18s ease-out",
  },
  drawerHeader: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "6px 8px",
    borderRadius: 12,
    background: "#eff6ff",
    border: "1px solid #dbeafe",
    marginBottom: 6,
  },
  drawerNav: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    gap: 6,
    marginTop: 2,
  },
};
