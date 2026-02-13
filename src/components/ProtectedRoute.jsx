import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { hasAnyPermission } from "../utils/permissions";

export default function ProtectedRoute({
  children,
  roles = [],
  permissionsAny = [],
  requirePaid = true,
}) {
  const { user, loading } = useAuth();

  if (loading) {
    return null;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (roles.length > 0) {
    const currentRoles = user.roles || [user.role].filter(Boolean);
    const allowed = roles.some((role) => currentRoles.includes(role));
    if (!allowed) {
      return <Navigate to="/403" replace />;
    }
  }

  if (permissionsAny.length > 0) {
    const allowed = hasAnyPermission(user, permissionsAny);
    if (!allowed) {
      return <Navigate to="/403" replace />;
    }
  }

  if (requirePaid) {
    const active = Boolean(user.subscription?.isActive);
    const isAdmin = (user.roles || []).includes("ADMIN") || user.role === "ADMIN";
    if (!active && !isAdmin) {
      return <Navigate to="/pricing" replace />;
    }
  }

  return children;
}
