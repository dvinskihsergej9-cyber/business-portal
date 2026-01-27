import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  useLocation,
} from "react-router-dom";

import { AuthProvider } from "./context/AuthContext";
import ProtectedRoute from "./components/ProtectedRoute";
import BackgroundNetwork from "./components/BackgroundNetwork";

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
import MobileTsd from "./pages/MobileTsd";

function AppRoutesWithBackground() {
  const location = useLocation();
  const path = location.pathname || "/";

  const disablePublicRegister =
    String(import.meta.env.VITE_DISABLE_PUBLIC_REGISTER || "true") === "true";

  const showBackground = path === "/login" || path === "/register" || path === "/invite" || path === "/forgot-password" || path === "/reset-password";

  return (
    <>
      {showBackground && <BackgroundNetwork />}

      <div className="app-shell">
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/offer" element={<Offer />} />
          <Route path="/privacy" element={<Privacy />} />
          <Route path="/contacts" element={<Contacts />} />
          <Route path="/refund" element={<Refund />} />

          {/* публичные страницы */}
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

          {/* всё остальное под Layout и защитой */}
          <Route
            path="/*"
            element={
              <ProtectedRoute>
                <Layout />
              </ProtectedRoute>
            }
          >
            <Route index element={<Navigate to="/warehouse" replace />} />

            {/* главная больше не отдельный раздел */}
            <Route path="dashboard" element={<Navigate to="/warehouse" replace />} />
            <Route path="profile" element={<Navigate to="/warehouse" replace />} />
            <Route path="leave" element={<Navigate to="/warehouse" replace />} />
            <Route path="payments" element={<Navigate to="/warehouse" replace />} />

            {/* отключенные разделы редиректим в склад */}
            <Route path="hr" element={<Navigate to="/warehouse" replace />} />
            <Route path="accounting" element={<Navigate to="/warehouse" replace />} />
            <Route path="documents" element={<Navigate to="/warehouse" replace />} />
            <Route path="legal" element={<Navigate to="/warehouse" replace />} />
            <Route path="support" element={<Navigate to="/warehouse" replace />} />
            <Route path="warehouse" element={<Warehouse />} />
            <Route path="warehouse/tsd" element={<MobileTsd />} />

            {/* админка пользователей */}
            <Route
              path="admin/users"
              element={
                <ProtectedRoute roles={["ADMIN"]}>
                  <AdminConsole initialTab="users" />
                </ProtectedRoute>
              }
            />
            <Route
              path="admin"
              element={
                <ProtectedRoute roles={["ADMIN"]}>
                  <AdminConsole />
                </ProtectedRoute>
              }
            />

            {/* фолбэк внутри защищенной части */}
            <Route path="*" element={<Navigate to="/warehouse" replace />} />
          </Route>

          <Route path="/403" element={<Page403 />} />

          {/* фолбэк */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
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
