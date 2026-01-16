import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { apiFetch } from "../apiConfig";

const T = {
  title: "Сброс пароля",
  pass: "Новый пароль",
  pass2: "Повторите пароль",
  phPass: "Минимум 8 символов",
  phPass2: "Повторите пароль еще раз",
  save: "Сохранить",
  success: "Пароль обновлен.",
  login: "Войти",
  errPass: "Пароль должен быть минимум 8 символов.",
  errPass2: "Пароли не совпадают.",
  invalid: "Ссылка недействительна или истекла.",
};

export default function ResetPassword() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get("token") || "";

  const [form, setForm] = useState({ password: "", passwordRepeat: "" });
  const [fieldErrors, setFieldErrors] = useState({});
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const validate = () => {
    const errors = {};
    if (!form.password || form.password.length < 8) {
      errors.password = T.errPass;
    }
    if (form.password !== form.passwordRepeat) {
      errors.passwordRepeat = T.errPass2;
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");

    if (!token) {
      setError(T.invalid);
      return;
    }

    if (!validate()) return;

    try {
      setLoading(true);
      const res = await apiFetch("/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, newPassword: form.password }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || T.invalid);
      }
      setDone(true);
    } catch (err) {
      setError(T.invalid);
    } finally {
      setLoading(false);
    }
  };

  const isValid =
    form.password.length >= 8 && form.password === form.passwordRepeat;

  return (
    <div style={{ maxWidth: 420, margin: "60px auto", padding: "0 16px" }}>
      <h1 style={{ marginBottom: 12 }}>{T.title}</h1>

      {done ? (
        <div
          style={{
            background: "#e6ffed",
            color: "#146c2e",
            padding: 10,
            borderRadius: 4,
          }}
        >
          {T.success}
          <div style={{ marginTop: 8 }}>
            <button
              type="button"
              onClick={() => navigate("/login")}
              style={{
                padding: "8px 14px",
                background: "#1976d2",
                color: "#fff",
                border: "none",
                cursor: "pointer",
              }}
            >
              {T.login}
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 10 }}>
            <label style={{ display: "block", marginBottom: 6 }}>{T.pass}</label>
            <input
              type="password"
              placeholder={T.phPass}
              value={form.password}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, password: e.target.value }))
              }
              style={{ width: "100%", padding: 8, boxSizing: "border-box" }}
            />
            {fieldErrors.password && (
              <div style={{ color: "#b00020", marginTop: 4, fontSize: 12 }}>
                {fieldErrors.password}
              </div>
            )}
          </div>

          <div style={{ marginBottom: 12 }}>
            <label style={{ display: "block", marginBottom: 6 }}>{T.pass2}</label>
            <input
              type="password"
              placeholder={T.phPass2}
              value={form.passwordRepeat}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, passwordRepeat: e.target.value }))
              }
              style={{ width: "100%", padding: 8, boxSizing: "border-box" }}
            />
            {fieldErrors.passwordRepeat && (
              <div style={{ color: "#b00020", marginTop: 4, fontSize: 12 }}>
                {fieldErrors.passwordRepeat}
              </div>
            )}
          </div>

          {error && (
            <div
              style={{
                background: "#ffe6e6",
                color: "#b00020",
                padding: 8,
                marginBottom: 12,
                borderRadius: 4,
              }}
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !isValid}
            style={{
              width: "100%",
              padding: 10,
              background: loading || !isValid ? "#9db7e0" : "#1976d2",
              color: "#fff",
              border: "none",
              cursor: loading || !isValid ? "not-allowed" : "pointer",
            }}
          >
            {loading ? "..." : T.save}
          </button>
        </form>
      )}
    </div>
  );
}
