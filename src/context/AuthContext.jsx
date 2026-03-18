import { createContext, useContext, useEffect, useState } from "react";
import { apiFetch } from "../apiConfig";
import { ensurePushSubscription } from "../utils/pushSubscription";

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

  const bindPushForSession = (token, interactive = false, forceRebind = false) => {
    if (!token) return;
    ensurePushSubscription({ token, interactive, forceRebind }).then((result) => {
      if (result?.subscribed) return;
      setTimeout(() => {
        ensurePushSubscription({ token, interactive: false, forceRebind: false }).catch(() => null);
      }, 1800);
      setTimeout(() => {
        ensurePushSubscription({ token, interactive: false, forceRebind: false }).catch(() => null);
      }, 5000);
    }).catch(() => null);
  };

  // Р°РІС‚Рѕ-РїРѕРґС‚СЏРіРёРІР°РЅРёРµ РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ РїРѕ С‚РѕРєРµРЅСѓ
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
        console.error("РћС€РёР±РєР° Р°РІС‚РѕР°РІС‚РѕСЂРёР·Р°С†РёРё:", e);
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
        return { ok: false, message: data.message || "РћС€РёР±РєР° РІС…РѕРґР°" };
      }

      localStorage.setItem("token", data.token);
      localStorage.setItem("user", JSON.stringify(data.user));
      setUser(data.user);
      bindPushForSession(data.token, true, true);

      return { ok: true };
    } catch (e) {
      console.error("Login error:", e);
      return { ok: false, message: "РЎРµС‚РµРІР°СЏ РѕС€РёР±РєР°" };
    }
  };

  // Р Р•Р“РРЎРўР РђР¦РРЇ Р‘Р•Р— ROLE вЂ” СЂРѕР»СЊ СЃС‚Р°РІРёС‚ СЃРµСЂРІРµСЂ
  const register = async ({
    email,
    password,
    name,
    phone = "",
    companyName = "",
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
        return { ok: false, message: data.message || "РћС€РёР±РєР° СЃРѕС…СЂР°РЅРµРЅРёСЏ" };
      }

      setUser(data.user);
      localStorage.setItem("user", JSON.stringify(data.user));

      return { ok: true };
    } catch (e) {
      console.error("Update profile error:", e);
      return { ok: false, message: "РЎРµС‚РµРІР°СЏ РѕС€РёР±РєР°" };
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
      bindPushForSession(token, false, false);
    } catch (err) {
      console.error("Refresh user error:", err);
    }
  };

  useEffect(() => {
    if (!user?.id) return;
    const token = localStorage.getItem("token");
    bindPushForSession(token, false, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const value = {
    user,
    loading,
    login,
    register,
    verifyRegistrationCode,
    resendRegistrationCode,
    updateProfile,
    logout,
    refreshUser,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}


