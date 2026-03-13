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
import Landing from "./pages/Landing";
import Offer from "./pages/Offer";
import Privacy from "./pages/Privacy";
import Contacts from "./pages/Contacts";
import Refund from "./pages/Refund";
import Page403 from "./pages/Page403";
import AdminConsole from "./pages/AdminConsole";

import Warehouse from "./pages/Warehouse";
import TmcRm from "./pages/TmcRm";
import MobileTsd from "./pages/MobileTsd";
import {
  hasPermission,
  PERMISSION_KEYS,
  WAREHOUSE_SECTION_PERMISSION_MAP,
} from "./utils/permissions";

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

  const disablePublicRegister =
    String(import.meta.env.VITE_DISABLE_PUBLIC_REGISTER || "true") === "true";

  const showBackground = path === "/login" || path === "/register" || path === "/invite" || path === "/forgot-password" || path === "/reset-password";

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
        (section) => section !== "tmc" && section !== "requests"
      ),
    [allowedWarehouseSections]
  );

  const defaultPrivateRoute = useMemo(() => {
    if (hasPermission(user, PERMISSION_KEYS.APP_WAREHOUSE)) return "/warehouse";
    if (hasPermission(user, PERMISSION_KEYS.APP_TMC)) return "/tmc";
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
              path="tmc"
              element={
                <ProtectedRoute permissionsAny={[PERMISSION_KEYS.APP_TMC]}>
                  <TmcRm />
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
