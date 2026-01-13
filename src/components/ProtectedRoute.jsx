import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function ProtectedRoute({
  children,
  roles = [],
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
    const currentRoles = user.roles || [];
    const allowed = roles.some((role) => currentRoles.includes(role));
    if (!allowed) {
      return <Navigate to="/403" replace />;
    }
  }

  if (requirePaid) {
    const active = Boolean(user.subscription?.isActive);
    if (!active) {
      return <Navigate to="/pricing" replace />;
    }
  }

  return children;
}
