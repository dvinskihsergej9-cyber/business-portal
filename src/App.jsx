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
import Billing from "./pages/Billing";
import Dashboard from "./pages/Dashboard";
import HrPanel from "./pages/HrPanel";          // ✅ вот так
import Accounting from "./pages/Accounting";
import Page403 from "./pages/Page403";
import Profile from "./pages/Profile";
import LeaveRequests from "./pages/LeaveRequests";
import PaymentRequests from "./pages/PaymentRequests";
import UserManagement from "./pages/UserManagement";
import AdminConsole from "./pages/AdminConsole";

import DocFlow from "./pages/DocFlow";
import Legal from "./pages/Legal";
import Warehouse from "./pages/Warehouse";
import MobileTsd from "./pages/MobileTsd";
import Support from "./pages/Support";
import OverflowDebug from "./components/OverflowDebug";

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
            path="/"
            element={
              <ProtectedRoute>
                <Layout />
              </ProtectedRoute>
            }
          >
            <Route index element={<Navigate to="/dashboard" replace />} />

            <Route path="dashboard" element={<Dashboard />} />
            <Route path="profile" element={<Profile />} />
            <Route
              path="billing"
              element={
                <ProtectedRoute requirePaid={false}>
                  <Billing />
                </ProtectedRoute>
              }
            />

            {/* существующие модули */}
            <Route path="leave" element={<LeaveRequests />} />
            <Route path="payments" element={<PaymentRequests />} />

            {/* КАДРЫ / HR */}
            <Route
              path="hr"                          // можно без /*, вложенных роутов нет
              element={
                <ProtectedRoute roles={["HR", "ADMIN"]}>
                  <HrPanel />
                </ProtectedRoute>
              }
            />

            <Route
              path="accounting"
              element={
                <ProtectedRoute roles={["ACCOUNTING", "ADMIN"]}>
                  <Accounting />
                </ProtectedRoute>
              }
            />

            {/* новые разделы-отделы */}
            <Route path="documents" element={<DocFlow />} />
            <Route path="legal" element={<Legal />} />
            <Route path="warehouse" element={<Warehouse />} />
            <Route path="warehouse/tsd" element={<MobileTsd />} />
            <Route path="support" element={<Support />} />

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
          </Route>

          <Route path="/403" element={<Page403 />} />

          {/* фолбэк */}
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </div>
    </>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        {import.meta.env.DEV && <OverflowDebug />}
        <AppRoutesWithBackground />
      </BrowserRouter>
    </AuthProvider>
  );
}
