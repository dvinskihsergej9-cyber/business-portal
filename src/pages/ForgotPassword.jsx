import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { API_BASE } from "../apiConfig";

const T = {
  title: "\u0412\u043e\u0441\u0441\u0442\u0430\u043d\u043e\u0432\u043b\u0435\u043d\u0438\u0435 \u043f\u0430\u0440\u043e\u043b\u044f",
  email: "\u041f\u043e\u0447\u0442\u0430",
  send: "\u041e\u0442\u043f\u0440\u0430\u0432\u0438\u0442\u044c",
  success:
    "\u0415\u0441\u043b\u0438 \u0430\u043a\u043a\u0430\u0443\u043d\u0442 \u0441\u0443\u0449\u0435\u0441\u0442\u0432\u0443\u0435\u0442 \u2014 \u043c\u044b \u043e\u0442\u043f\u0440\u0430\u0432\u0438\u043b\u0438 \u043f\u0438\u0441\u044c\u043c\u043e.",
  placeholder: "\u0438\u043c\u044f@\u0434\u043e\u043c\u0435\u043d.ru",
  errEmail: "\u0423\u043a\u0430\u0436\u0438\u0442\u0435 email",
};

export default function ForgotPassword() {
  const navigate = useNavigate();
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
      await fetch(`${API_BASE}/auth/forgot-password`, {
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
      <button
        type="button"
        onClick={() => navigate("/login")}
        style={{
          marginBottom: 12,
          padding: "8px 14px",
          background: "#e5efff",
          color: "#1d4ed8",
          border: "1px solid #bfdbfe",
          borderRadius: 8,
          cursor: "pointer",
        }}
      >
        Назад
      </button>
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
