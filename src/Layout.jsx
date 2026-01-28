import { useEffect, useMemo, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "./context/AuthContext";
import TourOverlay from "./components/TourOverlay";

export default function Layout() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [isMobile, setIsMobile] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [showTour, setShowTour] = useState(false);
  const menu = [
    {
      label: "Р В Р’В Р В Р вЂ№Р В Р’В Р РЋРІР‚СњР В Р’В Р вЂ™Р’В»Р В Р’В Р вЂ™Р’В°Р В Р’В Р СћРІР‚В",
      to: "/warehouse",
      roles: ["EMPLOYEE", "HR", "ACCOUNTING", "ADMIN"],
    },
    // Р В Р’В Р В РІР‚В Р В Р’В Р РЋРІР‚СњР В Р’В Р вЂ™Р’В»Р В Р’В Р вЂ™Р’В°Р В Р’В Р СћРІР‚ВР В Р’В Р РЋРІР‚СњР В Р Р‹Р РЋРІР‚Сљ "Р В Р’В Р РЋРЎСџР В Р Р‹Р В РІР‚С™Р В Р’В Р РЋРІР‚СћР В Р Р‹Р Р†Р вЂљРЎвЂєР В Р’В Р РЋРІР‚ВР В Р’В Р вЂ™Р’В»Р В Р Р‹Р В Р вЂ°" Р В Р Р‹Р РЋРІР‚СљР В Р’В Р вЂ™Р’В±Р В Р Р‹Р В РІР‚С™Р В Р’В Р вЂ™Р’В°Р В Р’В Р вЂ™Р’В»Р В Р’В Р РЋРІР‚В Р В Р’В Р РЋРІР‚ВР В Р’В Р вЂ™Р’В· Р В Р’В Р РЋР’ВР В Р’В Р вЂ™Р’ВµР В Р’В Р В РІР‚В¦Р В Р Р‹Р В РІР‚в„–
    {
      label: "Р В Р’В Р РЋРІР‚в„ўР В Р’В Р СћРІР‚ВР В Р’В Р РЋР’ВР В Р’В Р РЋРІР‚ВР В Р’В Р В РІР‚В¦Р В Р’В Р РЋРІР‚ВР В Р Р‹Р В РЎвЂњР В Р Р‹Р Р†Р вЂљРЎв„ўР В Р Р‹Р В РІР‚С™Р В Р’В Р РЋРІР‚ВР В Р Р‹Р В РІР‚С™Р В Р’В Р РЋРІР‚СћР В Р’В Р В РІР‚В Р В Р’В Р вЂ™Р’В°Р В Р’В Р В РІР‚В¦Р В Р’В Р РЋРІР‚ВР В Р’В Р вЂ™Р’Вµ",
      to: "/admin",
      roles: ["ADMIN"], // Р В Р’В Р В РІР‚В Р В Р’В Р РЋРІР‚ВР В Р’В Р СћРІР‚ВР В Р’В Р В РІР‚В¦Р В Р’В Р РЋРІР‚Сћ Р В Р Р‹Р Р†Р вЂљРЎв„ўР В Р’В Р РЋРІР‚СћР В Р’В Р вЂ™Р’В»Р В Р Р‹Р В Р вЂ°Р В Р’В Р РЋРІР‚СњР В Р’В Р РЋРІР‚Сћ ADMIN
    },
  ];

  const allowedMenu = user
    ? menu.filter((item) => item.roles.includes(user.role))
    : [];

  const pageTitle = useMemo(() => {
    if (location.pathname.startsWith("/admin")) return "Р В Р’В Р РЋРІР‚в„ўР В Р’В Р СћРІР‚ВР В Р’В Р РЋР’ВР В Р’В Р РЋРІР‚ВР В Р’В Р В РІР‚В¦Р В Р’В Р РЋРІР‚ВР В Р Р‹Р В РЎвЂњР В Р Р‹Р Р†Р вЂљРЎв„ўР В Р Р‹Р В РІР‚С™Р В Р’В Р РЋРІР‚ВР В Р Р‹Р В РІР‚С™Р В Р’В Р РЋРІР‚СћР В Р’В Р В РІР‚В Р В Р’В Р вЂ™Р’В°Р В Р’В Р В РІР‚В¦Р В Р’В Р РЋРІР‚ВР В Р’В Р вЂ™Р’Вµ";
    if (location.pathname.startsWith("/warehouse")) return "Р В Р’В Р В Р вЂ№Р В Р’В Р РЋРІР‚СњР В Р’В Р вЂ™Р’В»Р В Р’В Р вЂ™Р’В°Р В Р’В Р СћРІР‚В";
    return "Р В Р’В Р РЋРЎСџР В Р’В Р РЋРІР‚СћР В Р Р‹Р В РІР‚С™Р В Р Р‹Р Р†Р вЂљРЎв„ўР В Р’В Р вЂ™Р’В°Р В Р’В Р вЂ™Р’В»";
  }, [location.pathname]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 768px)");
    const onChange = () => setIsMobile(media.matches);
    onChange();
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    if (!user) return;
    const seen = localStorage.getItem("portalTourSeen");
    if (!seen) {
      setShowTour(true);
    }
  }, [user]);

  useEffect(() => {
    if (showTour && isMobile) {
      setDrawerOpen(true);
    }
  }, [showTour, isMobile]);

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

  const tourSteps = useMemo(() => {
    const steps = [
      {
        title: "\u0414\u043e\u0431\u0440\u043e \u043f\u043e\u0436\u0430\u043b\u043e\u0432\u0430\u0442\u044c!",
        text:
          "\u041a\u043e\u0440\u043e\u0442\u043a\u0438\u0439 \u0442\u0443\u0440 \u043f\u043e\u043a\u0430\u0436\u0435\u0442 \u043e\u0441\u043d\u043e\u0432\u043d\u044b\u0435 \u0440\u0430\u0437\u0434\u0435\u043b\u044b \u043f\u043e\u0440\u0442\u0430\u043b\u0430.",
        selector: null,
      },
      {
        title: "\u041d\u0430\u0432\u0438\u0433\u0430\u0446\u0438\u044f",
        text:
          "\u0417\u0434\u0435\u0441\u044c \u043f\u0435\u0440\u0435\u0445\u043e\u0434 \u043c\u0435\u0436\u0434\u0443 \u0440\u0430\u0437\u0434\u0435\u043b\u0430\u043c\u0438. \u041d\u0430 \u0442\u0435\u043b\u0435\u0444\u043e\u043d\u0435 \u043c\u0435\u043d\u044e \u043e\u0442\u043a\u0440\u044b\u0432\u0430\u0435\u0442\u0441\u044f \u043f\u043e \u043a\u043d\u043e\u043f\u043a\u0435.",
        selector: isMobile ? ".tour-burger" : ".sidebar-nav",
      },
      {
        title: "\u0421\u043a\u043b\u0430\u0434",
        text:
          "\u041e\u0441\u043d\u043e\u0432\u043d\u0430\u044f \u0440\u0430\u0431\u043e\u0442\u0430: \u0437\u0430\u044f\u0432\u043a\u0438, \u043e\u0441\u0442\u0430\u0442\u043a\u0438, \u0434\u0432\u0438\u0436\u0435\u043d\u0438\u0435.",
        selector: ".warehouse-section",
      },
      {
        title: "\u041f\u043e\u0434\u0440\u0430\u0437\u0434\u0435\u043b\u044b \u0441\u043a\u043b\u0430\u0434\u0430",
        text:
          "\u0411\u044b\u0441\u0442\u0440\u044b\u0439 \u0434\u043e\u0441\u0442\u0443\u043f \u043a \u043a\u043b\u044e\u0447\u0435\u0432\u044b\u043c \u0441\u0446\u0435\u043d\u0430\u0440\u0438\u044f\u043c.",
        selector: ".warehouse-grid",
      },
    ];

    if (user?.role === "ADMIN") {
      steps.push({
        title: "\u0410\u0434\u043c\u0438\u043d\u0438\u0441\u0442\u0440\u0438\u0440\u043e\u0432\u0430\u043d\u0438\u0435",
        text:
          "\u0420\u0430\u0437\u0434\u0435\u043b \u0434\u043b\u044f \u0443\u043f\u0440\u0430\u0432\u043b\u0435\u043d\u0438\u044f \u043f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u0442\u0435\u043b\u044f\u043c\u0438 \u0438 \u043d\u0430\u0441\u0442\u0440\u043e\u0439\u043a\u0430\u043c\u0438.",
        selector: ".sidebar-nav a[href='/admin']",
      });
    }

    steps.push({
      title: "\u0412\u044b\u0445\u043e\u0434",
      text:
        "\u0412\u044b\u0439\u0442\u0438 \u0438\u0437 \u0430\u043a\u043a\u0430\u0443\u043d\u0442\u0430 \u043c\u043e\u0436\u043d\u043e \u0437\u0434\u0435\u0441\u044c.",
      selector: ".tour-logout",
    });

    return steps;
  }, [isMobile, user]);

  const rootStyle = isMobile ? styles.rootMobile : styles.root;
  const sidebarStyle = isMobile
    ? { ...styles.sidebar, display: "none" }
    : styles.sidebar;
  const headerStyle = isMobile
    ? { ...styles.header, ...styles.headerMobile }
    : styles.header;

  return (
    <div style={rootStyle}>
      {/* Р В Р’В Р В Р вЂ№Р В Р’В Р вЂ™Р’В°Р В Р’В Р Р†РІР‚С›РІР‚вЂњР В Р’В Р СћРІР‚ВР В Р’В Р вЂ™Р’В±Р В Р’В Р вЂ™Р’В°Р В Р Р‹Р В РІР‚С™ */}
      <aside style={sidebarStyle}>
        {/* Р В Р’В Р Р†Р вЂљРЎвЂќР В Р’В Р РЋРІР‚СћР В Р’В Р РЋРІР‚вЂњР В Р’В Р РЋРІР‚Сћ / Р В Р’В Р В РІР‚В¦Р В Р’В Р вЂ™Р’В°Р В Р’В Р вЂ™Р’В·Р В Р’В Р В РІР‚В Р В Р’В Р вЂ™Р’В°Р В Р’В Р В РІР‚В¦Р В Р’В Р РЋРІР‚ВР В Р’В Р вЂ™Р’Вµ */}
        <div style={styles.logoBlock}>
          <div style={styles.logoMark} />
          <div>
            <div style={styles.logoTitle}>Business Portal</div>
            <div style={styles.logoSubtitle}>Р В Р’В Р Р†Р вЂљРІвЂћСћР В Р’В Р В РІР‚В¦Р В Р Р‹Р РЋРІР‚СљР В Р Р‹Р Р†Р вЂљРЎв„ўР В Р Р‹Р В РІР‚С™Р В Р’В Р вЂ™Р’ВµР В Р’В Р В РІР‚В¦Р В Р’В Р В РІР‚В¦Р В Р’В Р РЋРІР‚ВР В Р’В Р Р†РІР‚С›РІР‚вЂњ Р В Р Р‹Р В РЎвЂњР В Р’В Р вЂ™Р’ВµР В Р Р‹Р В РІР‚С™Р В Р’В Р В РІР‚В Р В Р’В Р РЋРІР‚ВР В Р Р‹Р В РЎвЂњ Р В Р’В Р РЋРІР‚СњР В Р’В Р РЋРІР‚СћР В Р’В Р РЋР’ВР В Р’В Р РЋРІР‚вЂќР В Р’В Р вЂ™Р’В°Р В Р’В Р В РІР‚В¦Р В Р’В Р РЋРІР‚ВР В Р’В Р РЋРІР‚В</div>
          </div>
        </div>

        {/* Р В Р’В Р РЋРІвЂћСћР В Р’В Р вЂ™Р’В°Р В Р Р‹Р В РІР‚С™Р В Р Р‹Р Р†Р вЂљРЎв„ўР В Р’В Р РЋРІР‚СћР В Р Р‹Р Р†Р вЂљР Р‹Р В Р’В Р РЋРІР‚СњР В Р’В Р вЂ™Р’В° Р В Р’В Р РЋРІР‚вЂќР В Р’В Р РЋРІР‚СћР В Р’В Р вЂ™Р’В»Р В Р Р‹Р В Р вЂ°Р В Р’В Р вЂ™Р’В·Р В Р’В Р РЋРІР‚СћР В Р’В Р В РІР‚В Р В Р’В Р вЂ™Р’В°Р В Р Р‹Р Р†Р вЂљРЎв„ўР В Р’В Р вЂ™Р’ВµР В Р’В Р вЂ™Р’В»Р В Р Р‹Р В Р РЏ */}
        {user && (
          <div style={styles.userCard}>
            <div style={styles.userName}>{user.name}</div>
            <div style={styles.userEmail}>{user.email}</div>
            <div style={styles.userRole}>{user.role}</div>
          </div>
        )}

        {/* Р В Р’В Р РЋРЎС™Р В Р’В Р вЂ™Р’В°Р В Р’В Р В РІР‚В Р В Р’В Р РЋРІР‚ВР В Р’В Р РЋРІР‚вЂњР В Р’В Р вЂ™Р’В°Р В Р Р‹Р Р†Р вЂљР’В Р В Р’В Р РЋРІР‚ВР В Р Р‹Р В Р РЏ */}
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

        {/* Р В Р’В Р РЋРІвЂћСћР В Р’В Р В РІР‚В¦Р В Р’В Р РЋРІР‚СћР В Р’В Р РЋРІР‚вЂќР В Р’В Р РЋРІР‚СњР В Р’В Р вЂ™Р’В° Р В Р’В Р В РІР‚В Р В Р Р‹Р Р†Р вЂљРІвЂћвЂ“Р В Р Р‹Р Р†Р вЂљР’В¦Р В Р’В Р РЋРІР‚СћР В Р’В Р СћРІР‚ВР В Р’В Р вЂ™Р’В° */}
        <button style={styles.logoutBtn} onClick={handleLogout} className="tour-logout">
          Р В Р’В Р Р†Р вЂљРІвЂћСћР В Р Р‹Р Р†Р вЂљРІвЂћвЂ“Р В Р’В Р Р†РІР‚С›РІР‚вЂњР В Р Р‹Р Р†Р вЂљРЎв„ўР В Р’В Р РЋРІР‚В
        </button>
      </aside>

      {/* Р В Р’В Р РЋРЎСџР В Р Р‹Р В РІР‚С™Р В Р’В Р вЂ™Р’В°Р В Р’В Р В РІР‚В Р В Р’В Р вЂ™Р’В°Р В Р Р‹Р В Р РЏ Р В Р Р‹Р Р†Р вЂљР Р‹Р В Р’В Р вЂ™Р’В°Р В Р Р‹Р В РЎвЂњР В Р Р‹Р Р†Р вЂљРЎв„ўР В Р Р‹Р В Р вЂ°: Р В Р Р‹Р Р†РІР‚С™Р’В¬Р В Р’В Р вЂ™Р’В°Р В Р’В Р РЋРІР‚вЂќР В Р’В Р РЋРІР‚СњР В Р’В Р вЂ™Р’В° + Р В Р’В Р РЋРІР‚СњР В Р’В Р РЋРІР‚СћР В Р’В Р В РІР‚В¦Р В Р Р‹Р Р†Р вЂљРЎв„ўР В Р’В Р вЂ™Р’ВµР В Р’В Р В РІР‚В¦Р В Р Р‹Р Р†Р вЂљРЎв„ў */}
      <div style={styles.main}>
        <header style={headerStyle} className="portal-header">
          <div style={styles.headerRow}>
            {isMobile && (
              <button
                type="button"
                onClick={() => setDrawerOpen(true)}
                style={styles.burgerBtn}
                className="tour-burger"
                aria-label="Р В Р’В Р РЋРІР‚С”Р В Р Р‹Р Р†Р вЂљРЎв„ўР В Р’В Р РЋРІР‚СњР В Р Р‹Р В РІР‚С™Р В Р Р‹Р Р†Р вЂљРІвЂћвЂ“Р В Р Р‹Р Р†Р вЂљРЎв„ўР В Р Р‹Р В Р вЂ° Р В Р’В Р РЋР’ВР В Р’В Р вЂ™Р’ВµР В Р’В Р В РІР‚В¦Р В Р Р‹Р В РІР‚в„–"
                aria-expanded={drawerOpen}
              >
                Р В Р вЂ Р вЂ™Р’ВР вЂ™Р’В°
              </button>
            )}
            <div>
              <div style={styles.headerTitle}>{pageTitle}</div>
              <div style={styles.headerSubtitle}>
                {user
                  ? `Р В Р’В Р РЋРЎСџР В Р’В Р РЋРІР‚СћР В Р’В Р вЂ™Р’В»Р В Р Р‹Р В Р вЂ°Р В Р’В Р вЂ™Р’В·Р В Р’В Р РЋРІР‚СћР В Р’В Р В РІР‚В Р В Р’В Р вЂ™Р’В°Р В Р Р‹Р Р†Р вЂљРЎв„ўР В Р’В Р вЂ™Р’ВµР В Р’В Р вЂ™Р’В»Р В Р Р‹Р В Р вЂ°: ${user.name} (${user.role})`
                  : "Р В Р’В Р Р†Р вЂљРІвЂћСћР В Р Р‹Р Р†Р вЂљРІвЂћвЂ“ Р В Р’В Р В РІР‚В¦Р В Р’В Р вЂ™Р’Вµ Р В Р’В Р вЂ™Р’В°Р В Р’В Р В РІР‚В Р В Р Р‹Р Р†Р вЂљРЎв„ўР В Р’В Р РЋРІР‚СћР В Р Р‹Р В РІР‚С™Р В Р’В Р РЋРІР‚ВР В Р’В Р вЂ™Р’В·Р В Р’В Р РЋРІР‚СћР В Р’В Р В РІР‚В Р В Р’В Р вЂ™Р’В°Р В Р’В Р В РІР‚В¦Р В Р Р‹Р Р†Р вЂљРІвЂћвЂ“"}
              </div>
            </div>
          </div>
        </header>

        <main style={styles.content} className="portal-surface">
          <Outlet />
        </main>
      </div>

      {/* Р В Р’В Р РЋРЎв„ўР В Р’В Р РЋРІР‚СћР В Р’В Р вЂ™Р’В±Р В Р’В Р РЋРІР‚ВР В Р’В Р вЂ™Р’В»Р В Р Р‹Р В Р вЂ°Р В Р’В Р В РІР‚В¦Р В Р’В Р РЋРІР‚СћР В Р’В Р вЂ™Р’Вµ Р В Р’В Р РЋР’ВР В Р’В Р вЂ™Р’ВµР В Р’В Р В РІР‚В¦Р В Р Р‹Р В РІР‚в„– (drawer) */}
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
            aria-label="Р В Р’В Р РЋРЎС™Р В Р’В Р вЂ™Р’В°Р В Р’В Р В РІР‚В Р В Р’В Р РЋРІР‚ВР В Р’В Р РЋРІР‚вЂњР В Р’В Р вЂ™Р’В°Р В Р Р‹Р Р†Р вЂљР’В Р В Р’В Р РЋРІР‚ВР В Р Р‹Р В Р РЏ"
          >
            <div style={styles.drawerHeader}>
              <div style={styles.logoMark} />
              <div>
                <div style={styles.logoTitle}>Business Portal</div>
                <div style={styles.logoSubtitle}>Р В Р’В Р РЋРЎв„ўР В Р’В Р вЂ™Р’ВµР В Р’В Р В РІР‚В¦Р В Р Р‹Р В РІР‚в„–</div>
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

            <button
              type="button"
              style={styles.logoutBtn}
              className="tour-logout"
              onClick={() => {
                setDrawerOpen(false);
                handleLogout();
              }}
            >
              Р В Р’В Р Р†Р вЂљРІвЂћСћР В Р Р‹Р Р†Р вЂљРІвЂћвЂ“Р В Р’В Р Р†РІР‚С›РІР‚вЂњР В Р Р‹Р Р†Р вЂљРЎв„ўР В Р’В Р РЋРІР‚В
            </button>
          </aside>
        </div>
      )}
      {showTour && (
        <TourOverlay
          steps={tourSteps}
          onSkip={() => {
            localStorage.setItem("portalTourSeen", "true");
            setShowTour(false);
            setDrawerOpen(false);
          }}
          onFinish={() => {
            localStorage.setItem("portalTourSeen", "true");
            setShowTour(false);
            setDrawerOpen(false);
          }}
        />
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
    border: "1px solid #111827", // Р В Р Р‹Р Р†Р вЂљР Р‹Р В Р Р‹Р Р†Р вЂљР’ВР В Р Р‹Р В РІР‚С™Р В Р’В Р В РІР‚В¦Р В Р’В Р вЂ™Р’В°Р В Р Р‹Р В Р РЏ Р В Р Р‹Р В РІР‚С™Р В Р’В Р вЂ™Р’В°Р В Р’В Р РЋР’ВР В Р’В Р РЋРІР‚СњР В Р’В Р вЂ™Р’В° Р В Р’В Р В РІР‚В Р В Р Р‹Р В РЎвЂњР В Р’В Р вЂ™Р’ВµР В Р’В Р РЋРІР‚вЂњР В Р’В Р СћРІР‚ВР В Р’В Р вЂ™Р’В°
    transition:
      "background 0.15s ease, color 0.15s ease, border 0.15s ease, box-shadow 0.15s ease",
  },
  navItemActive: {
    background: "#ffffff",
    color: "#1d4ed8",
    borderColor: "#2563eb", // Р В Р’В Р вЂ™Р’В°Р В Р’В Р РЋРІР‚СњР В Р Р‹Р Р†Р вЂљРЎв„ўР В Р’В Р РЋРІР‚ВР В Р’В Р В РІР‚В Р В Р’В Р В РІР‚В¦Р В Р Р‹Р Р†Р вЂљРІвЂћвЂ“Р В Р’В Р Р†РІР‚С›РІР‚вЂњ Р В Р вЂ Р В РІР‚С™Р Р†Р вЂљРЎСљ Р В Р Р‹Р В РЎвЂњР В Р’В Р РЋРІР‚ВР В Р’В Р В РІР‚В¦Р В Р Р‹Р В Р РЏР В Р Р‹Р В Р РЏ Р В Р Р‹Р В РІР‚С™Р В Р’В Р вЂ™Р’В°Р В Р’В Р РЋР’ВР В Р’В Р РЋРІР‚СњР В Р’В Р вЂ™Р’В°
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
  headerMobile: {
    padding: "12px 14px",
  },
  headerRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
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
