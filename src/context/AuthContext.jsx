import { createContext, useContext, useEffect, useState } from "react";
import { apiFetch } from "../apiConfig";

export const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

const normalizeLoginInput = (value) =>
  String(value || "")
    .trim()
    .replace(/\s+/g, "_")
    .toLowerCase();

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
          setUser(data);
          localStorage.setItem("user", JSON.stringify(data));
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

  const login = async (loginValue, password) => {
    try {
      const normalizedLogin = normalizeLoginInput(loginValue);
      const res = await apiFetch("/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ login: normalizedLogin, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        return { ok: false, message: data.message || "Ошибка входа" };
      }

      localStorage.setItem("token", data.token);
      localStorage.setItem("user", JSON.stringify(data.user));
      setUser(data.user);

      return { ok: true };
    } catch (e) {
      console.error("Login error:", e);
      return { ok: false, message: "Сетевая ошибка" };
    }
  };

  // РЕГИСТРАЦИЯ БЕЗ ROLE — роль ставит сервер
  const register = async (email, password, name) => {
    try {
      const normalizedEmail = String(email || "").trim().toLowerCase();
      const res = await apiFetch("/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: normalizedEmail, password, name }),
      });

      const data = await res.json();

      if (!res.ok) {
        return { ok: false, message: data.message || "Ошибка регистрации" };
      }

      localStorage.setItem("token", data.token);
      localStorage.setItem("user", JSON.stringify(data.user));
      setUser(data.user);

      return { ok: true };
    } catch (e) {
      console.error("Register error:", e);
      return { ok: false, message: "Сетевая ошибка" };
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
        return { ok: false, message: data.message || "Ошибка сохранения" };
      }

      setUser(data.user);
      localStorage.setItem("user", JSON.stringify(data.user));

      return { ok: true };
    } catch (e) {
      console.error("Update profile error:", e);
      return { ok: false, message: "Сетевая ошибка" };
    }
  };

  const logout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    setUser(null);
  };

  const refreshUser = async () => {
    const token = localStorage.getItem("token");
    if (!token) return;
    try {
      const res = await apiFetch("/me", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (!res.ok) return;
      const data = await res.json();
      setUser(data);
      localStorage.setItem("user", JSON.stringify(data));
    } catch (err) {
      console.error("Refresh user error:", err);
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
