import { createContext, useContext, useEffect, useState } from "react";
import { apiFetch } from "../apiConfig";

export const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const saved = localStorage.getItem("user");
    return saved ? JSON.parse(saved) : null;
  });
  const [loading, setLoading] = useState(true);

  // авто-подтягивание пользователя по токену
  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) {
      setLoading(false);
      return;
    }

    (async () => {
      try {
        const res = await apiFetch("/me", {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (!res.ok) {
          localStorage.removeItem("token");
          localStorage.removeItem("user");
          setUser(null);
        } else {
          const data = await res.json();
          const nextUser = {
            ...data.user,
            org: data.org || null,
            memberships: data.memberships || [],
            subscription: data.subscription || null,
          };
          setUser(nextUser);
          localStorage.setItem("user", JSON.stringify(nextUser));
        }
      } catch (e) {
        console.error("Ошибка автоавторизации:", e);
        localStorage.removeItem("token");
        localStorage.removeItem("user");
        setUser(null);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const login = async (email, password) => {
  try {
    const res = await apiFetch("/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    const data = await res.json();

    if (!res.ok) {
      return { ok: false, message: data.message || "\u041e\u0448\u0438\u0431\u043a\u0430 \u0432\u0445\u043e\u0434\u0430" };
    }

    localStorage.setItem("token", data.token);

    const meRes = await apiFetch("/me", {
      headers: { Authorization: `Bearer ${data.token}` },
    });
    const meData = await meRes.json();
    const nextUser = meRes.ok
      ? {
          ...meData.user,
          org: meData.org || null,
          memberships: meData.memberships || [],
          subscription: meData.subscription || null,
        }
      : data.user;

    localStorage.setItem("user", JSON.stringify(nextUser));
    setUser(nextUser);

    return { ok: true };
  } catch (e) {
    console.error("Login error:", e);
    return { ok: false, message: "\u041e\u0448\u0438\u0431\u043a\u0430 \u0441\u0435\u0442\u0438" };
  }
};

  // РЕГИСТРАЦИЯ БЕЗ ROLE — роль ставит сервер
  const register = async (email, password, name) => {
  try {
    const res = await apiFetch("/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, name }),
    });

    const data = await res.json();

    if (!res.ok) {
      return { ok: false, message: data.message || "\u041e\u0448\u0438\u0431\u043a\u0430 \u0440\u0435\u0433\u0438\u0441\u0442\u0440\u0430\u0446\u0438\u0438" };
    }

    localStorage.setItem("token", data.token);

    const meRes = await apiFetch("/me", {
      headers: { Authorization: `Bearer ${data.token}` },
    });
    const meData = await meRes.json();
    const nextUser = meRes.ok
      ? {
          ...meData.user,
          org: meData.org || null,
          memberships: meData.memberships || [],
          subscription: meData.subscription || null,
        }
      : data.user;

    localStorage.setItem("user", JSON.stringify(nextUser));
    setUser(nextUser);

    return { ok: true };
  } catch (e) {
    console.error("Register error:", e);
    return { ok: false, message: "\u041e\u0448\u0438\u0431\u043a\u0430 \u0441\u0435\u0442\u0438" };
  }
};

  const updateProfile = async ({ name, password }) => {
  try {
    const token = localStorage.getItem("token");
    const res = await apiFetch("/me", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ name, password }),
    });

    const data = await res.json();

    if (!res.ok) {
      return { ok: false, message: data.message || "\u041e\u0448\u0438\u0431\u043a\u0430 \u043e\u0431\u043d\u043e\u0432\u043b\u0435\u043d\u0438\u044f \u043f\u0440\u043e\u0444\u0438\u043b\u044f" };
    }

    const nextUser = {
      ...user,
      ...data.user,
    };
    setUser(nextUser);
    localStorage.setItem("user", JSON.stringify(nextUser));

    return { ok: true };
  } catch (e) {
    console.error("Update profile error:", e);
    return { ok: false, message: "\u041e\u0448\u0438\u0431\u043a\u0430 \u0441\u0435\u0442\u0438" };
  }
};

  const logout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    setUser(null);
  };

  const refreshUser = async () => {
    const token = localStorage.getItem("token");
    if (!token) {
      setUser(null);
      return null;
    }
    try {
      const res = await apiFetch("/me", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) {
        localStorage.removeItem("token");
        localStorage.removeItem("user");
        setUser(null);
        return null;
      }
      const nextUser = {
        ...data.user,
        org: data.org || null,
        memberships: data.memberships || [],
        subscription: data.subscription || null,
      };
      setUser(nextUser);
      localStorage.setItem("user", JSON.stringify(nextUser));
      return nextUser;
    } catch (e) {
      console.error("Refresh user error:", e);
      return null;
    }
  };

  const value = {
    user,
    loading,
    login,
    register,
    updateProfile,
    logout,
    refreshUser,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
