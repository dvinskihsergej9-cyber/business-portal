import { useState } from "react";
import { useAuth } from "../context/AuthContext";
import { Link, useNavigate } from "react-router-dom";

export default function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();

  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    const res = await register(form.email, form.password, form.name);

    setLoading(false);

    if (!res.ok) {
      setError(res.message || "Ошибка регистрации");
    } else {
      navigate("/dashboard");
    }
  };

  const emailInvalid = (event) =>
    event.target.setCustomValidity("Введите корректный email");

  const clearInvalid = (event) => event.target.setCustomValidity("");

  return (
    <div style={{ maxWidth: 400, margin: "60px auto", padding: "0 16px" }}>
      <h1 style={{ marginBottom: 24 }}>Регистрация</h1>

      <p style={{ fontSize: 14, color: "#6b7280", marginBottom: 16 }}>
        Укажите имя, email и пароль. После регистрации вы сможете войти в портал.
      </p>

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
            type="text"
            placeholder="Имя"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            required
            style={{ width: "100%", padding: 6, boxSizing: "border-box" }}
          />
        </div>

        <div style={{ marginBottom: 8 }}>
          <input
            type="email"
            placeholder="Напр. name@company.com"
            value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
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
            value={form.password}
            onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
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
          {loading ? "Создание..." : "Создать аккаунт"}
        </button>
      </form>

      <p style={{ marginTop: 12 }}>
        Уже есть аккаунт? <Link to="/login">Войти</Link>
      </p>
    </div>
  );
}
