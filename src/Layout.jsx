import { useEffect, useMemo, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "./context/AuthContext";
import { hasPermission, PERMISSION_KEYS } from "./utils/permissions";
import { APP_LOGO_DATA_URL } from "./assets/appLogoDataUrl";
import NotificationBell from "./components/NotificationBell";

const DATE_INPUT_SELECTOR =
  'input[type="date"], input[type="datetime-local"], input[type="month"]';
const APP_LOGO_SRC = APP_LOGO_DATA_URL;
const WAREHOUSE_SECTION_TITLE_MAP = {
  tasks: "\u0417\u0430\u0434\u0430\u0447\u0438 \u0441\u043a\u043b\u0430\u0434\u0430",
  inventory: "\u041e\u0441\u0442\u0430\u0442\u043a\u0438",
  holds: "\u0411\u043b\u043e\u043a\u0438\u0440\u043e\u0432\u043a\u0430 \u043e\u0441\u0442\u0430\u0442\u043a\u043e\u0432",
  movement: "\u0418\u0441\u0442\u043e\u0440\u0438\u044f \u0434\u0432\u0438\u0436\u0435\u043d\u0438\u0439",
  transactions: "\u0422\u0440\u0430\u043d\u0437\u0430\u043a\u0446\u0438\u0438",
  revision: "\u0420\u0435\u0432\u0438\u0437\u0438\u044f",
  suppliers: "\u041f\u043e\u0441\u0442\u0430\u0432\u0449\u0438\u043a\u0438",
  locations: "\u0421\u043f\u0440\u0430\u0432\u043e\u0447\u043d\u0438\u043a \u044f\u0447\u0435\u0435\u043a",
  items: "\u0421\u043f\u0440\u0430\u0432\u043e\u0447\u043d\u0438\u043a \u0442\u043e\u0432\u0430\u0440\u043e\u0432",
  queue: "\u041c\u0430\u0448\u0438\u043d\u044b \u043f\u043e\u0441\u0442\u0430\u0432\u0449\u0438\u043a\u043e\u0432",
  tsd: "\u041c\u043e\u0431\u0438\u043b\u044c\u043d\u044b\u0439 \u0422\u0421\u0414",
};

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
        <path
          d="M4.5 10.5 12 6l7.5 4.5v8L12 21l-7.5-2.5v-8Z"
          stroke={stroke}
          strokeWidth="1.8"
          fill={fill}
        />
        <path d="M4.5 10.5 12 15l7.5-4.5" stroke={stroke} strokeWidth="1.6" />
        <path
          d="M8.6 12.5h6.8M8.6 15.2h4.4"
          stroke={stroke}
          strokeWidth="1.4"
          strokeLinecap="round"
        />
      </svg>
    );
  }

  if (type === "news") {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <rect
          x="3.5"
          y="4.5"
          width="17"
          height="15"
          rx="2.5"
          stroke={stroke}
          strokeWidth="1.8"
          fill={fill}
        />
        <path
          d="M7.5 9h9M7.5 12.5h9M7.5 16h6"
          stroke={stroke}
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </svg>
    );
  }

  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 3.5 4 7.5v5c0 4.2 3.1 7.5 8 8.5 4.9-1 8-4.3 8-8.5v-5l-8-4Z"
        stroke={stroke}
        strokeWidth="1.8"
        fill={fill}
      />
      <path
        d="M8.5 12.2 11 14.7l4.7-4.7"
        stroke={stroke}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function BackIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M15.5 4.5 8 12l7.5 7.5" stroke="#334155" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [isMobile, setIsMobile] = useState(false);

  const menu = useMemo(
    () => [
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
    ],
    []
  );

  const allowedMenu = user
    ? menu.filter((item) => hasPermission(user, item.permission))
    : [];
  const sectionParam = new URLSearchParams(location.search || "").get("section");
  const isWarehouseNested = location.pathname === "/warehouse" && Boolean(sectionParam);
  const isTopLevelMenuRoute = allowedMenu.some((item) => item.to === location.pathname);
  const showBack = isWarehouseNested || !isTopLevelMenuRoute;
  const activeMenuItem = allowedMenu.find((item) => item.to === location.pathname) || null;
  const currentPageTitle =
    location.pathname === "/warehouse" && sectionParam
      ? WAREHOUSE_SECTION_TITLE_MAP[sectionParam] || activeMenuItem?.label || "\u0421\u043a\u043b\u0430\u0434"
      : activeMenuItem?.label || "\u0420\u0430\u0437\u0434\u0435\u043b";

  useEffect(() => {
    const media = window.matchMedia("(max-width: 768px)");
    const onChange = () => setIsMobile(media.matches);
    onChange();
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

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
        if (
          dateInputs.length === 1 &&
          dateInputs[0] instanceof HTMLInputElement
        ) {
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

  const handleSupportOpen = () => {
    navigate("/support");
  };

  const handleBack = () => {
    if (!showBack) return;

    if (location.pathname === "/warehouse") {
      const event = new CustomEvent("portal:warehouse-back", { cancelable: true });
      window.dispatchEvent(event);
      if (event.defaultPrevented) {
        return;
      }
    }

    if (window.history.length > 1) {
      navigate(-1);
      return;
    }

    const fallbackRoute = allowedMenu[0]?.to || "/warehouse";
    if (location.pathname !== fallbackRoute) {
      navigate(fallbackRoute);
    }
  };

  const rootStyle = isMobile ? styles.rootMobile : styles.root;
  const sidebarStyle = isMobile
    ? { ...styles.sidebar, display: "none" }
    : styles.sidebar;
  const canUseSupport = Boolean(user && user.role === "ADMIN");
  const supportBtnStyle = isMobile
    ? { ...styles.headerSupportBtn, ...styles.headerTopBtnMobile }
    : styles.headerSupportBtn;
  const logoutBtnStyle = isMobile
    ? { ...styles.headerLogoutBtn, ...styles.headerTopBtnMobile }
    : styles.headerLogoutBtn;

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
        <header
          style={isMobile ? styles.topBarMobile : styles.topBar}
          className="portal-topbar"
        >
          <div style={styles.topBarLeft}>
            {showBack && (
            <button
              type="button"
              style={styles.backBtn}
              onClick={handleBack}
              aria-label="Назад"
            >
              <BackIcon />
              <span>Назад</span>
            </button>
            )}
          </div>

          <div style={styles.topBarTitle} title={currentPageTitle}>
            {currentPageTitle}
          </div>

          <div style={styles.topBarActions}>
            {user && <NotificationBell />}
            {canUseSupport && (
              <button type="button" style={supportBtnStyle} onClick={handleSupportOpen}>
                Поддержка
              </button>
            )}
            <button type="button" style={logoutBtnStyle} onClick={handleLogout}>
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
    display: "grid",
    gridTemplateColumns: "auto minmax(0, 1fr) auto",
    alignItems: "center",
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
    display: "grid",
    gridTemplateColumns: "auto minmax(0, 1fr) auto",
    alignItems: "flex-end",
    padding: "calc(env(safe-area-inset-top, 0px) + 6px) 10px 6px",
    borderBottom: "1px solid rgba(15, 23, 42, 0.08)",
    background: "rgba(248, 250, 252, 0.92)",
    backdropFilter: "blur(10px)",
  },
  backBtn: {
    minHeight: 34,
    padding: "7px 10px",
    borderRadius: 10,
    border: "1px solid #d1d5db",
    background: "#ffffff",
    color: "#334155",
    fontSize: 13,
    fontWeight: 600,
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    boxShadow: "none",
  },
  topBarLeft: {
    justifySelf: "start",
    display: "inline-flex",
    alignItems: "center",
    minHeight: 34,
    minWidth: 0,
  },
  topBarTitle: {
    justifySelf: "stretch",
    maxWidth: "100%",
    padding: "0 8px",
    textAlign: "center",
    fontSize: 16,
    fontWeight: 700,
    lineHeight: 1.2,
    color: "#0f172a",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    pointerEvents: "none",
  },
  topBarActions: {
    justifySelf: "end",
    display: "inline-flex",
    alignItems: "center",
    flexWrap: "nowrap",
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
  headerSupportBtn: {
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
  headerTopBtnMobile: {
    minHeight: 34,
    padding: "6px 9px",
    fontSize: 12,
  },
  content: {
    padding: 0,
    flex: 1,
    boxSizing: "border-box",
  },
  contentMobile: {
    paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 108px)",
  },
  mobileBottomNav: {
    position: "fixed",
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 120,
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    gap: 4,
    padding: "8px 8px calc(env(safe-area-inset-bottom, 0px) + 8px)",
    borderTop: "1px solid rgba(191, 219, 254, 0.95)",
    borderRadius: "16px 16px 0 0",
    background: "rgba(255, 255, 255, 0.97)",
    boxShadow: "0 -10px 24px rgba(15, 23, 42, 0.16)",
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
    textDecoration: "none",
    color: "#64748b",
    background: "transparent",
    padding: "5px 2px",
  },
  mobileBottomNavItemActive: {
    color: "#0b67c0",
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
