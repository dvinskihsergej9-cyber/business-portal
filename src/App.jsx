import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  useLocation,
} from "react-router-dom";
import { useEffect, useMemo, useRef, useState } from "react";

import { AuthProvider, useAuth } from "./context/AuthContext";
import ProtectedRoute from "./components/ProtectedRoute";
import BackgroundNetwork from "./components/BackgroundNetwork";
import GlobalErrorModal from "./components/GlobalErrorModal";

import Layout from "./Layout";

import Login from "./pages/Login";
import Register from "./pages/Register";
import InviteAccept from "./pages/InviteAccept";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import Pricing from "./pages/Pricing";
import SubscribeReturn from "./pages/SubscribeReturn";
import Support from "./pages/Support";
import Landing from "./pages/Landing";
import Offer from "./pages/Offer";
import Privacy from "./pages/Privacy";
import Contacts from "./pages/Contacts";
import Refund from "./pages/Refund";
import MarketingUnsubscribe from "./pages/MarketingUnsubscribe";
import Page403 from "./pages/Page403";
import AdminConsole from "./pages/AdminConsole";
import PlatformNews from "./pages/PlatformNews";
import DesignPreview from "./pages/DesignPreview";

import Warehouse from "./pages/Warehouse";
import MobileTsd from "./pages/MobileTsd";
import {
  hasPermission,
  PERMISSION_KEYS,
  WAREHOUSE_SECTION_PERMISSION_MAP,
} from "./utils/permissions";

const BUNDLE_SYNC_RELOAD_KEY = "app:bundle-sync:reload-at";

function extractIndexBundlePathFromHtml(html) {
  const text = String(html || "");
  const match = text.match(
    /<script[^>]+type=["']module["'][^>]+src=["']([^"']*\/assets\/index-[^"']+\.js)["']/i
  );
  if (!match?.[1]) return "";
  try {
    return new URL(match[1], window.location.origin).pathname;
  } catch {
    return "";
  }
}

function AppRoutesWithBackground() {
  const { user } = useAuth();
  const location = useLocation();
  const path = location.pathname || "/";
  const startupTimerRef = useRef(null);
  const [showStartup, setShowStartup] = useState(true);

  useEffect(() => {
    startupTimerRef.current = setTimeout(() => setShowStartup(false), 2100);
    return () => {
      if (startupTimerRef.current) {
        clearTimeout(startupTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const checkFreshBundle = async () => {
      try {
        if (typeof window === "undefined" || typeof document === "undefined") return;
        const currentScript = document.querySelector(
          "script[type='module'][src*='/assets/index-']"
        );
        const currentSrc = String(currentScript?.getAttribute("src") || "").trim();
        if (!currentSrc) return;

        const currentPath = new URL(currentSrc, window.location.origin).pathname;
        const probeUrl = new URL(window.location.href);
        probeUrl.searchParams.set("__bundle_probe", String(Date.now()));

        const res = await fetch(probeUrl.toString(), {
          cache: "no-store",
          credentials: "same-origin",
          headers: { "Cache-Control": "no-cache" },
        });
        if (!res.ok) return;

        const html = await res.text();
        if (cancelled) return;
        const latestPath = extractIndexBundlePathFromHtml(html);
        if (!latestPath || latestPath === currentPath) {
          try {
            window.sessionStorage?.removeItem(BUNDLE_SYNC_RELOAD_KEY);
          } catch {
            // ignore
          }
          return;
        }

        const now = Date.now();
        let lastReloadAt = 0;
        try {
          lastReloadAt = Number(window.sessionStorage?.getItem(BUNDLE_SYNC_RELOAD_KEY) || 0);
        } catch {
          lastReloadAt = 0;
        }
        if (now - lastReloadAt < 15000) return;

        try {
          window.sessionStorage?.setItem(BUNDLE_SYNC_RELOAD_KEY, String(now));
        } catch {
          // ignore
        }

        if ("serviceWorker" in navigator) {
          navigator.serviceWorker.getRegistrations().then((regs) => {
            regs.forEach((reg) => reg.update().catch(() => {}));
          });
        }

        const nextUrl = new URL(window.location.href);
        nextUrl.searchParams.set("__bundle_reload", String(now));
        window.location.replace(nextUrl.toString());
      } catch {
        // ignore bundle freshness check failures
      }
    };

    const timer = setTimeout(checkFreshBundle, 900);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  const disablePublicRegister =
    String(import.meta.env.VITE_DISABLE_PUBLIC_REGISTER || "false") === "true";

  const showBackground = path === "/login" || path === "/register" || path === "/invite" || path === "/forgot-password" || path === "/reset-password" || path === "/unsubscribe";

  const allowedWarehouseSections = useMemo(() => {
    const allSections = Object.keys(WAREHOUSE_SECTION_PERMISSION_MAP);
    if (!user) return [];
    return allSections.filter((section) =>
      hasPermission(user, WAREHOUSE_SECTION_PERMISSION_MAP[section])
    );
  }, [user]);

  const mainWarehouseSections = useMemo(
    () =>
      allowedWarehouseSections.filter(
        (section) => section !== "requests"
      ),
    [allowedWarehouseSections]
  );

  const defaultPrivateRoute = useMemo(() => {
    if (hasPermission(user, PERMISSION_KEYS.APP_WAREHOUSE)) return "/warehouse";
    if (hasPermission(user, PERMISSION_KEYS.APP_ADMIN)) return "/admin";
    return "/403";
  }, [user]);

  return (
    <>
      {showBackground && <BackgroundNetwork />}
      {showStartup && (
        <div className="login-intro" role="status" aria-live="polite">
          <div className="login-intro__space" />
          <div className="login-intro__stars" />
          <div className="login-intro__planet" />
          <div className="login-intro__content">
            <img
              className="login-intro__logo"
              src="/logo-mark.png"
              alt="Логотип СкладОнлайн"
            />
            <div className="login-intro__brand">СкладОнлайн</div>
            <div className="login-intro__subtitle">Операционный центр вашего склада</div>
          </div>
        </div>
      )}

      <div className="app-shell">
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/about" element={<Landing />} />
          <Route path="/offer" element={<Offer />} />
          <Route path="/privacy" element={<Privacy />} />
          <Route path="/contacts" element={<Contacts />} />
          <Route path="/refund" element={<Refund />} />
          <Route path="/design-preview" element={<DesignPreview />} />

          <Route path="/login" element={<Login />} />
          <Route
            path="/register"
            element={
              disablePublicRegister ? (
                <Navigate to="/login" replace />
              ) : (
                <Register />
              )
            }
          />
          <Route path="/invite" element={<InviteAccept />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/unsubscribe" element={<MarketingUnsubscribe />} />
          <Route
            path="/pricing"
            element={
              <ProtectedRoute requirePaid={false}>
                <Pricing />
              </ProtectedRoute>
            }
          />
          <Route
            path="/subscribe/return"
            element={
              <ProtectedRoute requirePaid={false}>
                <SubscribeReturn />
              </ProtectedRoute>
            }
          />
          <Route
            path="/support"
            element={
              <ProtectedRoute requirePaid={false}>
                <Support />
              </ProtectedRoute>
            }
          />

          <Route
            path="/*"
            element={
              <ProtectedRoute>
                <Layout />
              </ProtectedRoute>
            }
          >
            <Route index element={<Navigate to={defaultPrivateRoute} replace />} />
            <Route
              path="warehouse"
              element={
                <ProtectedRoute permissionsAny={[PERMISSION_KEYS.APP_WAREHOUSE]}>
                  <Warehouse allowedSections={mainWarehouseSections} />
                </ProtectedRoute>
              }
            />
            <Route
              path="warehouse/tsd"
              element={
                <ProtectedRoute permissionsAny={[PERMISSION_KEYS.WAREHOUSE_TSD]}>
                  <MobileTsd />
                </ProtectedRoute>
              }
            />
            <Route
              path="news"
              element={
                <ProtectedRoute>
                  <PlatformNews />
                </ProtectedRoute>
              }
            />
            <Route
              path="admin/users"
              element={
                <ProtectedRoute
                  roles={["ADMIN"]}
                  permissionsAny={[PERMISSION_KEYS.ADMIN_USERS]}
                >
                  <AdminConsole initialTab="users" />
                </ProtectedRoute>
              }
            />
            <Route
              path="admin/tenants"
              element={
                <ProtectedRoute
                  roles={["ADMIN"]}
                  permissionsAny={[PERMISSION_KEYS.ADMIN_TENANTS]}
                >
                  <AdminConsole initialTab="tenants" />
                </ProtectedRoute>
              }
            />
            <Route
              path="admin/platform-news"
              element={
                <ProtectedRoute
                  roles={["ADMIN"]}
                  permissionsAny={[PERMISSION_KEYS.ADMIN_TENANTS]}
                >
                  <AdminConsole initialTab="platform-news" />
                </ProtectedRoute>
              }
            />
            <Route
              path="admin"
              element={
                <ProtectedRoute
                  roles={["ADMIN"]}
                  permissionsAny={[PERMISSION_KEYS.APP_ADMIN]}
                >
                  <AdminConsole />
                </ProtectedRoute>
              }
            />
            <Route path="*" element={<Navigate to={defaultPrivateRoute} replace />} />
          </Route>

          <Route path="/403" element={<Page403 />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
      <GlobalErrorModal />
    </>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppRoutesWithBackground />
      </BrowserRouter>
    </AuthProvider>
  );
}
