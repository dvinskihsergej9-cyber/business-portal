import { useEffect, useRef, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

const normalizeLoginInput = (value) =>
  String(value || "").replace(/\s+/g, "_");

function LoginBackgroundAnimation() {
  const lottieRef = useRef(null);

  useEffect(() => {
    if (!lottieRef.current) return undefined;

    let instance;
    let isUnmounted = false;

    const setupAnimation = async () => {
      const lottieModule = await import("lottie-web");
      if (isUnmounted || !lottieRef.current) return;

      instance = lottieModule.default.loadAnimation({
        container: lottieRef.current,
        renderer: "svg",
        loop: true,
        autoplay: true,
        path: "/animations/modernwms-warehouse.json",
      });
    };

    setupAnimation();

    return () => {
      isUnmounted = true;
      if (instance) instance.destroy();
    };
  }, []);

  return (
    <div className="login-page__bg" aria-hidden="true">
      <div className="login-page__bg-lottie" ref={lottieRef} />
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
      <LoginBackgroundAnimation />
      <div className="login-page__veil" aria-hidden="true" />

      <div className="login-card">
        <div className="login-card__brand">СкладОнлайн</div>
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
