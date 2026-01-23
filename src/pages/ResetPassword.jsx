import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { API_BASE } from "../apiConfig";

const T = {
  title: "\u0421\u043c\u0435\u043d\u0430 \u043f\u0430\u0440\u043e\u043b\u044f",
  pass: "\u041d\u043e\u0432\u044b\u0439 \u043f\u0430\u0440\u043e\u043b\u044c",
  pass2: "\u041f\u043e\u0432\u0442\u043e\u0440 \u043f\u0430\u0440\u043e\u043b\u044f",
  phPass: "\u041c\u0438\u043d\u0438\u043c\u0443\u043c 8 \u0441\u0438\u043c\u0432\u043e\u043b\u043e\u0432",
  phPass2: "\u0412\u0432\u0435\u0434\u0438\u0442\u0435 \u043f\u0430\u0440\u043e\u043b\u044c \u0435\u0449\u0451 \u0440\u0430\u0437",
  save: "\u0421\u043e\u0445\u0440\u0430\u043d\u0438\u0442\u044c",
  success: "\u041f\u0430\u0440\u043e\u043b\u044c \u043e\u0431\u043d\u043e\u0432\u043b\u0451\u043d.",
  login: "\u0412\u043e\u0439\u0442\u0438",
  errPass: "\u041f\u0430\u0440\u043e\u043b\u044c \u043c\u0438\u043d\u0438\u043c\u0443\u043c 8 \u0441\u0438\u043c\u0432\u043e\u043b\u043e\u0432.",
  errPass2: "\u041f\u0430\u0440\u043e\u043b\u0438 \u043d\u0435 \u0441\u043e\u0432\u043f\u0430\u0434\u0430\u044e\u0442.",
  invalid: "\u0421\u0441\u044b\u043b\u043a\u0430 \u043d\u0435\u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0442\u0435\u043b\u044c\u043d\u0430 \u0438\u043b\u0438 \u0438\u0441\u0442\u0435\u043a\u043b\u0430.",
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
      const res = await fetch(`${API_BASE}/auth/reset-password`, {
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
            <label style={{ display: "block", marginBottom: 6 }}>
              {T.pass2}
            </label>
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
