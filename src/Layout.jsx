import { useEffect, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "./context/AuthContext";
import { hasPermission, PERMISSION_KEYS } from "./utils/permissions";
import { APP_LOGO_DATA_URL } from "./assets/appLogoDataUrl";
import NotificationBell from "./components/NotificationBell";

const DATE_INPUT_SELECTOR =
  'input[type="date"], input[type="datetime-local"], input[type="month"]';
const APP_LOGO_SRC = APP_LOGO_DATA_URL;

function openDatePicker(input) {
  if (!input) return;
  try {
    input.focus({ preventScroll: true });
  } catch {
    input.focus();
  }

  try {
    if (typeof input.showPicker === "function") {
      input.showPicker();
      return;
    }
  } catch {
    // ignore browser restrictions and fallback to click
  }

  try {
    input.click();
  } catch {
    // no-op
  }
}

function MenuIcon({ type, active = false }) {
  const stroke = active ? "#0b67c0" : "#64748b";
  const fill = active ? "rgba(14, 165, 233, 0.14)" : "transparent";

  if (type === "warehouse") {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M3 9.5L12 4l9 5.5v10L12 20 3 19.5v-10Z" stroke={stroke} strokeWidth="1.8" fill={fill} />
        <path d="M3 9.5 12 15l9-5.5" stroke={stroke} strokeWidth="1.6" />
      </svg>
    );
  }

  if (type === "news") {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" stroke={stroke} strokeWidth="1.8" fill={fill} />
        <path d="M7.5 9h9M7.5 12.5h9M7.5 16h6" stroke={stroke} strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    );
  }

  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 3.5 4 7.5v5c0 4.2 3.1 7.5 8 8.5 4.9-1 8-4.3 8-8.5v-5l-8-4Z" stroke={stroke} strokeWidth="1.8" fill={fill} />
      <path d="M8.5 12.2 11 14.7l4.7-4.7" stroke={stroke} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function BurgerIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 6.5h16M4 12h16M4 17.5h16" stroke="#334155" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export default function Layout() {
  const { user, logout } = useAuth();
  const [isMobile, setIsMobile] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const menu = [
    {
      label: "Склад",
      shortLabel: "Склад",
      icon: "warehouse",
      to: "/warehouse",
      permission: PERMISSION_KEYS.APP_WAREHOUSE,
    },
    {
      label: "Новости платформы",
      shortLabel: "Новости",
      icon: "news",
      to: "/news",
    },
    {
      label: "Управление",
      shortLabel: "Управление",
      icon: "admin",
      to: "/admin",
      permission: PERMISSION_KEYS.APP_ADMIN,
    },
  ];

  const allowedMenu = user
    ? menu.filter((item) => hasPermission(user, item.permission))
    : [];

  useEffect(() => {
    const media = window.matchMedia("(max-width: 768px)");
    const onChange = () => setIsMobile(media.matches);
    onChange();
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    if (!isMobile) {
      setMobileMenuOpen(false);
    }
  }, [isMobile]);

  useEffect(() => {
    const onDocumentClick = (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;

      const directDateInput = target.closest(DATE_INPUT_SELECTOR);
      if (directDateInput instanceof HTMLInputElement) {
        openDatePicker(directDateInput);
        return;
      }

      if (target.closest("button, a, [role='button']")) return;
      if (target.closest("input, textarea, select")) return;

      let node = target;
      for (let depth = 0; node && depth < 8; depth += 1) {
        const dateInputs = node.querySelectorAll(DATE_INPUT_SELECTOR);
        if (dateInputs.length === 1 && dateInputs[0] instanceof HTMLInputElement) {
          const dateInput = dateInputs[0];
          const rowRect = node.getBoundingClientRect();
          const inputRect = dateInput.getBoundingClientRect();

          if (rowRect.height <= 140) {
            const rowCenterY = (rowRect.top + rowRect.bottom) / 2;
            const inputCenterY = (inputRect.top + inputRect.bottom) / 2;
            if (Math.abs(rowCenterY - inputCenterY) <= 90) {
              openDatePicker(dateInput);
              return;
            }
          }
        }
        node = node.parentElement;
      }
    };

    document.addEventListener("click", onDocumentClick, true);
    return () => document.removeEventListener("click", onDocumentClick, true);
  }, []);

  const handleLogout = () => {
    logout();
  };

  const rootStyle = isMobile ? styles.rootMobile : styles.root;
  const sidebarStyle = isMobile
    ? { ...styles.sidebar, display: "none" }
    : styles.sidebar;

  return (
    <div style={rootStyle}>
      <aside style={sidebarStyle}>
        <div style={styles.logoBlock}>
          <img
            src={APP_LOGO_SRC}
            alt="Логотип"
            style={styles.logoMarkImage}
            loading="eager"
            decoding="sync"
          />
          <div>
            <div style={styles.logoTitle}>СкладОнлайн</div>
            <div style={styles.logoSubtitle}>Внутренний сервис компании</div>
          </div>
        </div>

        {user && (
          <div style={styles.userCard}>
            <div style={styles.userName}>{user.name}</div>
            <div style={styles.userEmail}>{user.login || user.username || user.email}</div>
            <div style={styles.userRole}>{user.role}</div>
          </div>
        )}

        <nav style={styles.nav} className="sidebar-nav">
          {allowedMenu.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              style={({ isActive }) =>
                isActive
                  ? { ...styles.navItem, ...styles.navItemActive }
                  : styles.navItem
              }
            >
              <MenuIcon type={item.icon} active={false} />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
      </aside>

      <div style={styles.main}>
        <header style={isMobile ? styles.topBarMobile : styles.topBar} className="portal-topbar">
          {isMobile ? (
            <button
              type="button"
              style={styles.topBarMenuButton}
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Открыть меню"
            >
              <BurgerIcon />
            </button>
          ) : (
            <div />
          )}

          <div style={styles.topBarActions}>
            {user && <NotificationBell />}
            <button type="button" style={styles.headerLogoutBtn} onClick={handleLogout}>
              Выйти
            </button>
          </div>
        </header>

        <main
          style={isMobile ? { ...styles.content, ...styles.contentMobile } : styles.content}
          className="portal-surface"
        >
          <Outlet />
        </main>
      </div>

      {isMobile && mobileMenuOpen && (
        <>
          <button
            type="button"
            style={styles.mobileMenuBackdrop}
            onClick={() => setMobileMenuOpen(false)}
            aria-label="Закрыть меню"
          />
          <aside style={styles.mobileMenuPanel}>
            <div style={styles.mobileMenuHeader}>
              <div style={styles.mobileMenuTitle}>Меню</div>
              <button
                type="button"
                style={styles.mobileMenuCloseButton}
                onClick={() => setMobileMenuOpen(false)}
                aria-label="Закрыть"
              >
                ✕
              </button>
            </div>

            {user && (
              <div style={{ ...styles.userCard, marginBottom: 12 }}>
                <div style={styles.userName}>{user.name}</div>
                <div style={styles.userEmail}>{user.login || user.username || user.email}</div>
                <div style={styles.userRole}>{user.role}</div>
              </div>
            )}

            <nav style={styles.mobileMenuNav}>
              {allowedMenu.map((item) => (
                <NavLink
                  key={`mobile-drawer-${item.to}`}
                  to={item.to}
                  onClick={() => setMobileMenuOpen(false)}
                  style={({ isActive }) =>
                    isActive
                      ? { ...styles.mobileMenuNavItem, ...styles.mobileMenuNavItemActive }
                      : styles.mobileMenuNavItem
                  }
                >
                  <MenuIcon type={item.icon} active={false} />
                  <span>{item.label}</span>
                </NavLink>
              ))}
            </nav>
          </aside>
        </>
      )}

      {isMobile && (
        <nav style={styles.mobileBottomNav} className="mobile-bottom-nav">
          {allowedMenu.map((item) => (
            <NavLink
              key={`mobile-bottom-${item.to}`}
              to={item.to}
              style={({ isActive }) =>
                isActive
                  ? { ...styles.mobileBottomNavItem, ...styles.mobileBottomNavItemActive }
                  : styles.mobileBottomNavItem
              }
            >
              {({ isActive }) => (
                <>
                  <span style={styles.mobileBottomNavIconWrap}>
                    <MenuIcon type={item.icon} active={isActive} />
                  </span>
                  <span style={styles.mobileBottomNavLabel}>{item.shortLabel}</span>
                </>
              )}
            </NavLink>
          ))}
        </nav>
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
    gap: 14,
  },
  logoMarkImage: {
    width: 68,
    height: 68,
    borderRadius: 12,
    objectFit: "cover",
    display: "block",
    background: "transparent",
  },
  logoTitle: {
    fontSize: 18,
    fontWeight: 600,
  },
  logoSubtitle: {
    fontSize: 12,
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
    padding: "9px 11px",
    borderRadius: 10,
    textDecoration: "none",
    color: "#334155",
    fontSize: 14,
    fontWeight: 600,
    gap: 8,
    background: "transparent",
    border: "1px solid #d1d5db",
    transition:
      "background 0.15s ease, color 0.15s ease, border 0.15s ease, box-shadow 0.15s ease",
  },
  navItemActive: {
    background: "#eff6ff",
    color: "#0b67c0",
    borderColor: "#bfdbfe",
    boxShadow: "0 0 0 1px rgba(37, 99, 235, 0.12)",
  },
  main: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
  },
  topBar: {
    position: "sticky",
    top: 0,
    zIndex: 45,
    minHeight: 52,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "6px 16px",
    borderBottom: "1px solid rgba(15, 23, 42, 0.08)",
    background: "rgba(248, 250, 252, 0.9)",
    backdropFilter: "blur(8px)",
  },
  topBarMobile: {
    position: "sticky",
    top: 0,
    zIndex: 120,
    minHeight: "calc(env(safe-area-inset-top, 0px) + 52px)",
    display: "flex",
    alignItems: "flex-end",
    justifyContent: "space-between",
    padding: "calc(env(safe-area-inset-top, 0px) + 6px) 10px 6px",
    borderBottom: "1px solid rgba(15, 23, 42, 0.08)",
    background: "rgba(248, 250, 252, 0.92)",
    backdropFilter: "blur(10px)",
  },
  topBarMenuButton: {
    width: 36,
    height: 36,
    borderRadius: 10,
    border: "1px solid #d1d5db",
    background: "#ffffff",
    color: "#334155",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 0,
    boxShadow: "none",
  },
  topBarActions: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
  },
  headerLogoutBtn: {
    padding: "7px 12px",
    borderRadius: 10,
    border: "1px solid #d1d5db",
    background: "#ffffff",
    color: "#111827",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    textAlign: "center",
    whiteSpace: "nowrap",
    boxShadow: "none",
  },
  content: {
    padding: 0,
    flex: 1,
    boxSizing: "border-box",
  },
  contentMobile: {
    paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 90px)",
  },
  mobileMenuBackdrop: {
    position: "fixed",
    inset: 0,
    border: "none",
    background: "rgba(15, 23, 42, 0.35)",
    zIndex: 129,
    padding: 0,
    margin: 0,
  },
  mobileMenuPanel: {
    position: "fixed",
    top: 0,
    left: 0,
    bottom: 0,
    width: "min(300px, 86vw)",
    background: "#ffffff",
    borderRight: "1px solid #dbe4ee",
    boxShadow: "0 14px 32px rgba(15, 23, 42, 0.2)",
    padding: "calc(env(safe-area-inset-top, 0px) + 10px) 12px calc(env(safe-area-inset-bottom, 0px) + 12px)",
    display: "grid",
    gridTemplateRows: "auto auto 1fr",
    gap: 10,
    zIndex: 130,
    overflowY: "auto",
  },
  mobileMenuHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  mobileMenuTitle: {
    fontSize: 17,
    fontWeight: 700,
    color: "#0f172a",
  },
  mobileMenuCloseButton: {
    width: 34,
    height: 34,
    borderRadius: 10,
    border: "1px solid #d1d5db",
    background: "#ffffff",
    color: "#111827",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 0,
    fontSize: 20,
    lineHeight: 1,
    boxShadow: "none",
  },
  mobileMenuNav: {
    display: "grid",
    gap: 8,
  },
  mobileMenuNavItem: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    minHeight: 42,
    borderRadius: 11,
    border: "1px solid #d1d5db",
    padding: "8px 10px",
    textDecoration: "none",
    color: "#334155",
    fontWeight: 600,
    fontSize: 14,
    background: "#ffffff",
  },
  mobileMenuNavItemActive: {
    color: "#0b67c0",
    background: "#eff6ff",
    borderColor: "#bfdbfe",
  },
  mobileBottomNav: {
    position: "fixed",
    left: 8,
    right: 8,
    bottom: "calc(env(safe-area-inset-bottom, 0px) + 8px)",
    zIndex: 120,
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    gap: 6,
    padding: "6px",
    borderRadius: 16,
    border: "1px solid rgba(191, 219, 254, 0.95)",
    background: "rgba(255, 255, 255, 0.95)",
    boxShadow: "0 12px 28px rgba(15, 23, 42, 0.16)",
    backdropFilter: "blur(12px)",
  },
  mobileBottomNavItem: {
    display: "inline-flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
    minHeight: 48,
    borderRadius: 11,
    border: "1px solid transparent",
    textDecoration: "none",
    color: "#64748b",
    background: "transparent",
    padding: "5px 2px",
  },
  mobileBottomNavItemActive: {
    color: "#0b67c0",
    borderColor: "#bfdbfe",
    background: "#eff6ff",
  },
  mobileBottomNavIconWrap: {
    height: 18,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
  },
  mobileBottomNavLabel: {
    display: "block",
    fontSize: 10,
    fontWeight: 600,
    lineHeight: 1.1,
    letterSpacing: 0,
    textAlign: "center",
    whiteSpace: "normal",
    overflowWrap: "anywhere",
  },
};
