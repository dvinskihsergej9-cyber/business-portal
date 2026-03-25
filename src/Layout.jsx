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

export default function Layout() {
  const { user, logout } = useAuth();
  const [isMobile, setIsMobile] = useState(false);
  const menu = [
    {
      label: "\u0421\u043a\u043b\u0430\u0434",
      to: "/warehouse",
      permission: PERMISSION_KEYS.APP_WAREHOUSE,
    },
    {
      label: "\u041d\u043e\u0432\u043e\u0441\u0442\u0438 \u043f\u043b\u0430\u0442\u0444\u043e\u0440\u043c\u044b",
      to: "/news",
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
      {/* РЎР°Р№РґР±Р°СЂ */}
      <aside style={sidebarStyle}>
        {/* Р›РѕРіРѕ / РЅР°Р·РІР°РЅРёРµ */}
        <div style={styles.logoBlock}>
          <img
            src={APP_LOGO_SRC}
            alt={"\u041b\u043e\u0433\u043e\u0442\u0438\u043f"}
            style={styles.logoMarkImage}
            loading="eager"
            decoding="sync"
          />
          <div>
            <div style={styles.logoTitle}>{"\u0421\u043a\u043b\u0430\u0434\u041e\u043d\u043b\u0430\u0439\u043d"}</div>
            <div style={styles.logoSubtitle}>{"\u0412\u043d\u0443\u0442\u0440\u0435\u043d\u043d\u0438\u0439 \u0441\u0435\u0440\u0432\u0438\u0441 \u043a\u043e\u043c\u043f\u0430\u043d\u0438\u0438"}</div>
          </div>
        </div>

        {/* РљР°СЂС‚РѕС‡РєР° РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ */}
        {user && (
          <div style={styles.userCard}>
            <div style={styles.userName}>{user.name}</div>
            <div style={styles.userEmail}>{user.login || user.username || user.email}</div>
            <div style={styles.userRole}>{user.role}</div>
          </div>
        )}

        {/* РќР°РІРёРіР°С†РёСЏ */}
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
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>

      </aside>

      {/* РџСЂР°РІР°СЏ С‡Р°СЃС‚СЊ: С€Р°РїРєР° + РєРѕРЅС‚РµРЅС‚ */}
      <div style={styles.main}>
        <div
          style={isMobile ? styles.floatingActionsMobile : styles.floatingActions}
          className="portal-floating-actions"
        >
          {user && <NotificationBell />}
          <button
            type="button"
            style={styles.headerLogoutBtn}
            onClick={handleLogout}
          >
            {"\u0412\u044b\u0439\u0442\u0438"}
          </button>
        </div>

        <main
          style={isMobile ? { ...styles.content, ...styles.contentMobile } : styles.content}
          className="portal-surface"
        >
          <Outlet />
        </main>
      </div>

      {/* РњРѕР±РёР»СЊРЅРѕРµ РјРµРЅСЋ (drawer) */}
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
              <span>{item.label}</span>
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
  logoMark: {
    width: 28,
    height: 28,
    borderRadius: 8,
    background:
      "linear-gradient(135deg, #2563eb 0%, #1e40af 40%, #93c5fd 100%)",
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
    padding: "8px 10px",
    borderRadius: 8,
    textDecoration: "none",
    color: "#374151",
    fontSize: 14,
    gap: 8,
    background: "transparent",
    border: "1px solid #111827", // С‡С‘СЂРЅР°СЏ СЂР°РјРєР° РІСЃРµРіРґР°
    transition:
      "background 0.15s ease, color 0.15s ease, border 0.15s ease, box-shadow 0.15s ease",
  },
  navItemActive: {
    background: "#ffffff",
    color: "#1d4ed8",
    borderColor: "#2563eb", // Р°РєС‚РёРІРЅС‹Р№ вЂ” СЃРёРЅСЏСЏ СЂР°РјРєР°
    boxShadow: "0 0 0 1px rgba(37, 99, 235, 0.12)",
    fontWeight: 600,
  },
  main: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
  },
  floatingActions: {
    position: "fixed",
    top: 14,
    right: 16,
    zIndex: 45,
    display: "inline-flex",
    alignItems: "center",
    gap: 10,
  },
  floatingActionsMobile: {
    position: "fixed",
    top: "calc(env(safe-area-inset-top, 0px) + 8px)",
    right: 10,
    zIndex: 120,
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
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
  content: {
    padding: "0",
    flex: 1,
    boxSizing: "border-box",
  },
  contentMobile: {
    paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 74px)",
  },
  mobileBottomNav: {
    position: "fixed",
    left: 10,
    right: 10,
    bottom: "calc(env(safe-area-inset-bottom, 0px) + 8px)",
    zIndex: 120,
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    gap: 8,
    padding: "8px",
    borderRadius: 14,
    border: "1px solid #dbeafe",
    background: "rgba(255, 255, 255, 0.96)",
    boxShadow: "0 12px 24px rgba(15, 23, 42, 0.14)",
    backdropFilter: "blur(10px)",
  },
  mobileBottomNavItem: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minHeight: 38,
    padding: "8px 6px",
    borderRadius: 10,
    border: "1px solid transparent",
    fontSize: 12,
    fontWeight: 600,
    textAlign: "center",
    textDecoration: "none",
    color: "#334155",
    background: "transparent",
  },
  mobileBottomNavItemActive: {
    color: "#0b67c0",
    borderColor: "#bfdbfe",
    background: "#eff6ff",
  },
};
