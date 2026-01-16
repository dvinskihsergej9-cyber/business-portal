import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    const res = await login(email, password);

    setLoading(false);

    if (!res.ok) {
      setError(res.message || "Неверный email или пароль.");
      return;
    }

    navigate("/dashboard");
  };

  const emailInvalid = (event) =>
    event.target.setCustomValidity("Введите корректный email");

  const clearInvalid = (event) => event.target.setCustomValidity("");

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
          <input
            type="email"
            placeholder="Эл. почта"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onInvalid={emailInvalid}
            onInput={clearInvalid}
            title="Введите корректный email"
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
          {loading ? "Входим..." : "Войти"}
        </button>
      </form>

      <p style={{ marginTop: 12 }}>
        <Link to="/forgot-password">Забыли пароль?</Link>
      </p>
      <p style={{ marginTop: 8, color: "#6b7280", fontSize: 13 }}>
        Если нет доступа, обратитесь к администратору.
      </p>
    </div>
  );
}
