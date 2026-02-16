import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();

  const [loginValue, setLoginValue] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    const res = await login(loginValue, password);

    setLoading(false);

    if (!res.ok) {
      setError(res.message || "Ошибка входа");
      return;
    }

    navigate("/dashboard");
  };

  return (
    <div style={{ maxWidth: 400, margin: "60px auto", padding: "0 16px" }}>
      <h1 style={{ marginBottom: 24 }}>Вход</h1>

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

      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: 8 }}>
          <div style={{ marginBottom: 4, fontSize: 13, color: "#374151" }}>
            {"\u041b\u043e\u0433\u0438\u043d"}
          </div>
          <input
            type="text"
            placeholder={"\u041b\u043e\u0433\u0438\u043d"}
            value={loginValue}
            onChange={(e) => setLoginValue(e.target.value)}
            required
            style={{ width: "100%", padding: 6, boxSizing: "border-box" }}
          />
        </div>

        <div style={{ marginBottom: 12 }}>
          <input
            type="password"
            placeholder="Пароль"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            style={{ width: "100%", padding: 6, boxSizing: "border-box" }}
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          style={{
            width: "100%",
            padding: 8,
            background: "#1976d2",
            color: "#fff",
            border: "none",
            cursor: "pointer",
          }}
        >
          {loading ? "Вхожу..." : "Войти"}
        </button>
      </form>

      <p style={{ marginTop: 12 }}>
        <Link to="/forgot-password">{"\u0417\u0430\u0431\u044b\u043b\u0438 \u043f\u0430\u0440\u043e\u043b\u044c?"}</Link>
      </p>
      <p style={{ marginTop: 8, color: "#6b7280", fontSize: 13 }}>{"\u0414\u043e\u0441\u0442\u0443\u043f \u0441\u043e\u0437\u0434\u0430\u0451\u0442 \u0430\u0434\u043c\u0438\u043d\u0438\u0441\u0442\u0440\u0430\u0442\u043e\u0440 \u0432 \u0440\u0430\u0437\u0434\u0435\u043b\u0435 \u00ab\u041f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u0442\u0435\u043b\u0438\u00bb."}</p>

      <div
        style={{
          marginTop: 20,
          paddingTop: 12,
          borderTop: "1px solid #e5e7eb",
          fontSize: 13,
          color: "#6b7280",
        }}
      >
        <div style={{ marginBottom: 6 }}>{"\u0414\u043e\u043a\u0443\u043c\u0435\u043d\u0442\u044b \u0438 \u043a\u043e\u043d\u0442\u0430\u043a\u0442\u044b"}</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          <Link to="/about">{"\u041e \u0441\u0435\u0440\u0432\u0438\u0441\u0435"}</Link>
          <Link to="/offer">{"\u041e\u0444\u0435\u0440\u0442\u0430"}</Link>
          <Link to="/privacy">{"\u041f\u043e\u043b\u0438\u0442\u0438\u043a\u0430"}</Link>
          <Link to="/contacts">{"\u041a\u043e\u043d\u0442\u0430\u043a\u0442\u044b"}</Link>
          <Link to="/refund">{"\u0412\u043e\u0437\u0432\u0440\u0430\u0442"}</Link>
        </div>
      </div>
    </div>
  );
}
