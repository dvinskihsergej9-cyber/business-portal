import { useState } from "react";
import { apiFetch } from "../apiConfig";

const T = {
  title: "Восстановление пароля",
  email: "Эл. почта",
  send: "Отправить",
  success:
    "Если аккаунт существует — мы отправили письмо. Если письма нет, проверьте Спам или подождите 1–2 минуты.",
  placeholder: "name@domain.ru",
  errEmail: "Укажите адрес эл. почты",
};

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");

    if (!email.trim()) {
      setError(T.errEmail);
      return;
    }

    try {
      setLoading(true);
      await apiFetch("/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      setDone(true);
    } catch (err) {
      setDone(true);
    } finally {
      setLoading(false);
    }
  };

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
        </div>
      ) : (
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 10 }}>
            <label style={{ display: "block", marginBottom: 6 }}>
              {T.email}
            </label>
            <input
              type="email"
              placeholder={T.placeholder}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={{ width: "100%", padding: 8, boxSizing: "border-box" }}
            />
            {error && (
              <div style={{ color: "#b00020", marginTop: 4, fontSize: 12 }}>
                {error}
              </div>
            )}
          </div>

          <button
            type="submit"
            disabled={loading}
            style={{
              width: "100%",
              padding: 10,
              background: loading ? "#9db7e0" : "#1976d2",
              color: "#fff",
              border: "none",
              cursor: loading ? "not-allowed" : "pointer",
            }}
          >
            {loading ? "..." : T.send}
          </button>
        </form>
      )}
    </div>
  );
}
