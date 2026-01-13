import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "./context/AuthContext";

export default function Layout() {
  const { user, logout } = useAuth();
  const location = useLocation();

  const menu = [
    {
      label: "Главная",
      to: "/dashboard",
      roles: ["EMPLOYEE", "HR", "ACCOUNTING", "ADMIN"],
    },
    {
      label: "Кадры",
      to: "/hr",
      roles: ["HR", "ADMIN"],
    },
    {
      label: "Бухгалтерия",
      to: "/accounting",
      roles: ["ACCOUNTING", "ADMIN"],
    },
    {
      label: "Документооборот",
      to: "/documents",
      roles: ["EMPLOYEE", "HR", "ACCOUNTING", "ADMIN"],
    },
    {
      label: "Юрист",
      to: "/legal",
      roles: ["EMPLOYEE", "HR", "ACCOUNTING", "ADMIN"],
    },
    {
      label: "Склад",
      to: "/warehouse",
      roles: ["EMPLOYEE", "HR", "ACCOUNTING", "ADMIN"],
    },
    {
      label: "Техническая поддержка",
      to: "/support",
      roles: ["EMPLOYEE", "HR", "ACCOUNTING", "ADMIN"],
    },
    {
      label: "Billing",
      to: "/billing",
      roles: ["EMPLOYEE", "HR", "ACCOUNTING", "ADMIN"],
    },
    // вкладку "Профиль" убрали из меню
    {
      label: "Администрирование",
      to: "/admin",
      roles: ["ADMIN"], // видно только ADMIN
    },
  ];

  const allowedMenu = user
    ? menu.filter((item) => item.roles.includes(user.role))
    : [];

  const handleLogout = () => {
    logout();
  };

  return (
    <div style={styles.root}>
      {/* Сайдбар */}
      <aside style={styles.sidebar}>
        {/* Лого / название */}
        <div style={styles.logoBlock}>
          <div style={styles.logoMark} />
          <div>
            <div style={styles.logoTitle}>Business Portal</div>
            <div style={styles.logoSubtitle}>Внутренний сервис компании</div>
          </div>
        </div>

        {/* Карточка пользователя */}
        {user && (
          <div style={styles.userCard}>
            <div style={styles.userName}>{user.name}</div>
            <div style={styles.userEmail}>{user.email}</div>
            <div style={styles.userRole}>{user.role}</div>
          </div>
        )}

        {/* Навигация */}
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

        {/* Кнопка выхода */}
        <button style={styles.logoutBtn} onClick={handleLogout}>
          Выйти
        </button>
      </aside>

      {/* Правая часть: шапка + контент */}
      <div style={styles.main}>
        <header style={styles.header} className="portal-header">
          <div>
            <div style={styles.headerTitle}>
              {location.pathname === "/dashboard"
                ? "Обзор"
                : "Внутренний портал"}
            </div>
            <div style={styles.headerSubtitle}>
              {user
                ? `Пользователь: ${user.name} (${user.role})`
                : "Вы не авторизованы"}
            </div>
          </div>
        </header>

        <main style={styles.content} className="portal-surface">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

const styles = {
  root: {
    display: "flex",
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
  logoutBtn: {
    marginTop: 16,
    padding: "8px 12px",
    borderRadius: 8,
    border: "none",
    background: "#4b5563",
    color: "white",
    fontSize: 14,
    cursor: "pointer",
    textAlign: "center",
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
};
