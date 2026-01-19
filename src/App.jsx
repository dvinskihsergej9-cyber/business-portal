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
import HrPanel from "./pages/HrPanel";
import Page403 from "./pages/Page403";
import UserManagement from "./pages/UserManagement";
import AdminConsole from "./pages/AdminConsole";
import Warehouse from "./pages/Warehouse";
import MobileTsd from "./pages/MobileTsd";
import Support from "./pages/Support";

function AppRoutesWithBackground() {
  const location = useLocation();
  const path = location.pathname || "/";

  const disablePublicRegister =
    String(import.meta.env.VITE_DISABLE_PUBLIC_REGISTER || "true") === "true";

  const showBackground =
    path === "/login" ||
    path === "/register" ||
    path === "/invite" ||
    path === "/forgot-password" ||
    path === "/reset-password";

  return (
    <>
      {showBackground && <BackgroundNetwork />}

      <div className="app-shell">
        <Routes>
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
            path="/"
            element={
              <ProtectedRoute>
                <Layout />
              </ProtectedRoute>
            }
          >
            <Route index element={<Navigate to="/warehouse" replace />} />
            <Route path="dashboard" element={<Navigate to="/warehouse" replace />} />
            <Route
              path="billing"
              element={
                <ProtectedRoute requirePaid={false}>
                  <Billing />
                </ProtectedRoute>
              }
            />

            <Route
              path="hr"
              element={
                <ProtectedRoute roles={["HR", "ADMIN"]}>
                  <HrPanel />
                </ProtectedRoute>
              }
            />

            <Route path="warehouse" element={<Warehouse />} />
            <Route path="warehouse/tsd" element={<MobileTsd />} />
            <Route path="support" element={<Support />} />

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
          <Route path="*" element={<Navigate to="/warehouse" replace />} />
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
