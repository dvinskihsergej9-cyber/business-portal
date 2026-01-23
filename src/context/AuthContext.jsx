import { createContext, useContext, useEffect, useState } from "react";

export const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

const API = "http://localhost:3001/api";

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
        const res = await fetch(`${API}/me`, {
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

  const login = async (email, password) => {
    try {
      const res = await fetch(`${API}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
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
      const res = await fetch(`${API}/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, name }),
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
      const res = await fetch(`${API}/me`, {
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

  const value = {
    user,
    loading,
    login,
    register,
    updateProfile,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
