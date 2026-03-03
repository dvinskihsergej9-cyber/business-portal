import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

const normalizeLoginInput = (value) =>
  String(value || "").replace(/\s+/g, "_");

function LoginCartAnimation() {
  return (
    <div className="login-hero" aria-hidden="true">
      <div className="login-hero__track" />
      <svg
        className="login-hero__cart"
        viewBox="0 0 340 140"
        role="img"
        aria-label="Warehouse worker with cart"
      >
        <g className="login-hero__cart-body">
          <circle cx="62" cy="108" r="12" className="login-hero__wheel" />
          <circle cx="178" cy="108" r="12" className="login-hero__wheel" />
          <path
            d="M72 96h116l22-46h-90l-8-14H84"
            className="login-hero__trolley"
          />
          <rect
            x="130"
            y="24"
            width="16"
            height="24"
            rx="8"
            className="login-hero__person"
          />
          <path
            d="M136 48v30m0 0l-16 18m16-18l20 16m-20-16l26-4"
            className="login-hero__person-line"
          />
          <rect
            x="160"
            y="54"
            width="40"
            height="26"
            rx="4"
            className="login-hero__box"
          />
        </g>
      </svg>
    </div>
  );
}

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
    <div className="login-page">
      <div className="login-card">
        <LoginCartAnimation />
        <h1 className="login-card__title">Вход</h1>

        {error && <div className="login-card__error">{error}</div>}

        <form onSubmit={handleSubmit} className="login-form">
          <div className="login-form__field">
            <input
              type="text"
              placeholder="Логин"
              value={loginValue}
              onChange={(e) => setLoginValue(normalizeLoginInput(e.target.value))}
              required
            />
          </div>

          <div className="login-form__field">
            <input
              type="password"
              placeholder="Пароль"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          <button type="submit" disabled={loading} className="login-form__submit">
            {loading ? "Входим..." : "Войти"}
          </button>
        </form>

        <p className="login-card__help">
          <Link to="/forgot-password">Забыли пароль?</Link>
        </p>
        <p className="login-card__hint">
          Доступ создаёт администратор в разделе «Пользователи».
        </p>

        <div className="login-card__footer">
          <div className="login-card__footer-title">Документы и контакты</div>
          <div className="login-card__links">
            <Link to="/about">О сервисе</Link>
            <Link to="/offer">Оферта</Link>
            <Link to="/privacy">Политика</Link>
            <Link to="/contacts">Контакты</Link>
            <Link to="/refund">Возврат</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
