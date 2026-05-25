import { createContext, useContext, useEffect, useState } from "react";
import { apiFetch, normalizeErrorMessage } from "../apiConfig";
import { ensurePushSubscription } from "../utils/pushSubscription";

export const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

const normalizeLoginInput = (value) =>
  String(value || "")
    .trim()
    .replace(/\s+/g, "_")
    .toLowerCase();

const getBrowserTimeZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  } catch {
    return "";
  }
};

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const saved = localStorage.getItem("user");
    return saved ? JSON.parse(saved) : null;
  });
  const [loading, setLoading] = useState(true);

  const bindPushForSession = (token, interactive = false, forceRebind = false) => {
    if (!token) return;
    ensurePushSubscription({ token, interactive, forceRebind }).then((result) => {
      if (result?.subscribed) return;
      setTimeout(() => {
        ensurePushSubscription({ token, interactive: false, forceRebind }).catch(() => null);
      }, 1800);
      setTimeout(() => {
        ensurePushSubscription({ token, interactive: false, forceRebind }).catch(() => null);
      }, 5000);
    }).catch(() => null);
  };

  const warmApiConnection = (token) => {
    const authHeader = token
      ? {
          Authorization: `Bearer ${token}`,
        }
      : {};

    apiFetch("/billing/config", {
      headers: authHeader,
      suppressGlobalError: true,
      timeoutMs: 5000,
      retryCount: 1,
    }).catch(() => null);
  };

  // Автоматически подтягиваем пользователя по токену.
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
          warmApiConnection(token);
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

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        const fallbackByStatus =
          res.status === 429
            ? "Слишком много попыток входа. Подождите 10 минут."
            : "Ошибка сервера при входе";
        return { ok: false, message: data.message || fallbackByStatus };
      }

      if (!data?.token || !data?.user) {
        return {
          ok: false,
          message: "Сервер вернул некорректный ответ. Повторите вход.",
        };
      }

      localStorage.setItem("token", data.token);
      localStorage.setItem("user", JSON.stringify(data.user));
      setUser(data.user);
      bindPushForSession(data.token, true, true);
      warmApiConnection(data.token);

      return { ok: true };
    } catch (e) {
      console.error("Login error:", e);
      return { ok: false, message: normalizeErrorMessage(e, "Не удалось выполнить вход.") };
    }
  };

  const startDemoSession = async () => {
    try {
      const res = await apiFetch("/demo/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return { ok: false, message: data.message || "Не удалось запустить демо." };
      }
      if (!data?.token || !data?.user) {
        return { ok: false, message: "Сервер вернул некорректный ответ демо." };
      }
      localStorage.setItem("token", data.token);
      localStorage.setItem("user", JSON.stringify(data.user));
      setUser(data.user);
      bindPushForSession(data.token, false, true);
      warmApiConnection(data.token);
      return { ok: true, demo: data.demo || null };
    } catch (e) {
      console.error("Start demo error:", e);
      return { ok: false, message: normalizeErrorMessage(e, "Не удалось запустить демо.") };
    }
  };

  const signInWithToken = async (tokenInput) => {
    const token = String(tokenInput || "").trim();
    if (!token) {
      return { ok: false, message: "Токен демо не передан." };
    }
    try {
      localStorage.setItem("token", token);
      const res = await apiFetch("/me", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        suppressGlobalError: true,
      });
      if (!res.ok) {
        localStorage.removeItem("token");
        localStorage.removeItem("user");
        return { ok: false, message: "Демо-сессия недействительна. Запустите демо снова." };
      }
      const data = await res.json();
      localStorage.setItem("user", JSON.stringify(data));
      setUser(data);
      bindPushForSession(token, false, true);
      warmApiConnection(token);
      return { ok: true };
    } catch (e) {
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      setUser(null);
      console.error("signInWithToken error:", e);
      return { ok: false, message: normalizeErrorMessage(e, "Не удалось открыть демо-кабинет.") };
    }
  };

  // Регистрация без role: роль назначает сервер.
  const register = async ({
    email,
    password,
    name,
    phone = "",
    companyName = "",
    privacyAccepted = false,
    marketingAccepted = false,
    consentVersion = "",
  }) => {
    try {
      const normalizedEmail = String(email || "").trim().toLowerCase();
      const res = await apiFetch("/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: normalizedEmail,
          password,
          name,
          phone,
          companyName,
          privacyAccepted,
          marketingAccepted,
          consentVersion,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        return { ok: false, message: data.message || "Ошибка регистрации" };
      }

      return {
        ok: true,
        requiresVerification: Boolean(data?.requiresVerification),
        email: data?.email || normalizedEmail,
        message: data?.message || "Код подтверждения отправлен на почту.",
      };
    } catch (e) {
      console.error("Register error:", e);
      return { ok: false, message: "Сетевая ошибка" };
    }
  };

  const verifyRegistrationCode = async (email, code) => {
    try {
      const normalizedEmail = String(email || "").trim().toLowerCase();
      const normalizedCode = String(code || "").replace(/\s+/g, "");
      const res = await apiFetch("/auth/verify-email-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: normalizedEmail,
          code: normalizedCode,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        return { ok: false, message: data.message || "Код подтверждения неверный." };
      }

      localStorage.setItem("token", data.token);
      localStorage.setItem("user", JSON.stringify(data.user));
      setUser(data.user);
      bindPushForSession(data.token, true, true);
      warmApiConnection(data.token);

      return { ok: true };
    } catch (e) {
      console.error("Verify registration code error:", e);
      return { ok: false, message: "Сетевая ошибка" };
    }
  };

  const resendRegistrationCode = async (email) => {
    try {
      const normalizedEmail = String(email || "").trim().toLowerCase();
      const res = await apiFetch("/auth/resend-email-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: normalizedEmail }),
      });

      const data = await res.json();

      if (!res.ok) {
        return { ok: false, message: data.message || "Не удалось отправить код повторно." };
      }

      return {
        ok: true,
        message: data?.message || "Код подтверждения отправлен повторно.",
      };
    } catch (e) {
      console.error("Resend registration code error:", e);
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
      bindPushForSession(token, false, true);
    } catch (err) {
      console.error("Refresh user error:", err);
    }
  };

  useEffect(() => {
    if (!user?.id) return;
    const token = localStorage.getItem("token");
    bindPushForSession(token, false, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id) return;
    const token = localStorage.getItem("token");
    const timeZone = getBrowserTimeZone();
    if (!token || !timeZone || user.timeZone === timeZone) return;

    apiFetch("/me/timezone", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ timeZone }),
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        const nextUser = data?.user;
        if (!nextUser?.id) return;
        setUser(nextUser);
        localStorage.setItem("user", JSON.stringify(nextUser));
      })
      .catch(() => null);
  }, [user?.id, user?.timeZone]);

  const value = {
    user,
    loading,
    login,
    register,
    verifyRegistrationCode,
    resendRegistrationCode,
    startDemoSession,
    signInWithToken,
    updateProfile,
    logout,
    refreshUser,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}


