import { useEffect, useRef, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import lottie from "lottie-web";
import { useAuth } from "../context/AuthContext";
import modernWmsWarehouseAnimation from "../assets/login/modernwms-warehouse.json";

const normalizeLoginInput = (value) =>
  String(value || "").replace(/\s+/g, "_");

function LoginHero() {
  const lottieRef = useRef(null);

  useEffect(() => {
    const container = lottieRef.current;
    if (!container) return undefined;

    const instance = lottie.loadAnimation({
      container,
      renderer: "svg",
      loop: true,
      autoplay: true,
      animationData: modernWmsWarehouseAnimation,
      rendererSettings: {
        preserveAspectRatio: "xMidYMid slice",
      },
    });

    const keepAlive = () => {
      instance.resize();
      instance.play();
    };

    // Mobile browsers (especially iOS) can miss the first paint on initial tab open.
    // These delayed resize/play calls make the first render reliable.
    const raf1 = requestAnimationFrame(keepAlive);
    const raf2 = requestAnimationFrame(() => requestAnimationFrame(keepAlive));
    const t1 = window.setTimeout(keepAlive, 120);
    const t2 = window.setTimeout(keepAlive, 360);

    const onPageShow = () => keepAlive();
    const onVisibilityChange = () => {
      if (!document.hidden) keepAlive();
    };
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("resize", onPageShow);
    window.addEventListener("orientationchange", onPageShow);
    document.addEventListener("visibilitychange", onVisibilityChange);

    let observer;
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(() => keepAlive());
      observer.observe(container);
    }

    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      clearTimeout(t1);
      clearTimeout(t2);
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("resize", onPageShow);
      window.removeEventListener("orientationchange", onPageShow);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      observer?.disconnect();
      instance.destroy();
    };
  }, []);

  return (
    <div className="login-hero" aria-hidden="true">
      <div className="login-hero__lottie" ref={lottieRef} />
    </div>
  );
}

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const welcomeTimerRef = useRef(null);
  const introTimerRef = useRef(null);

  const [loginValue, setLoginValue] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showWelcome, setShowWelcome] = useState(false);
  const [showIntro, setShowIntro] = useState(true);

  useEffect(() => {
    introTimerRef.current = setTimeout(() => setShowIntro(false), 2100);
    return () => {
      if (introTimerRef.current) {
        clearTimeout(introTimerRef.current);
      }
      if (welcomeTimerRef.current) {
        clearTimeout(welcomeTimerRef.current);
      }
    };
  }, []);

  const openDashboard = () => {
    if (welcomeTimerRef.current) {
      clearTimeout(welcomeTimerRef.current);
    }
    navigate("/dashboard");
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (loading || showWelcome) return;

    setError("");
    setLoading(true);

    const res = await login(loginValue, password);

    setLoading(false);

    if (!res.ok) {
      setError(res.message || "Ошибка входа");
      return;
    }

    setShowWelcome(true);
    welcomeTimerRef.current = setTimeout(openDashboard, 1700);
  };

  return (
    <div className="login-page">
      {showIntro && (
        <div className="login-intro" role="status" aria-live="polite">
          <div className="login-intro__space" />
          <div className="login-intro__stars" />
          <div className="login-intro__planet" />
          <div className="login-intro__content">
            <img
              className="login-intro__logo"
              src="/logo-mark.png"
              alt="Логотип СкладОнлайн"
            />
            <div className="login-intro__brand">СкладОнлайн</div>
            <div className="login-intro__subtitle">Операционный центр вашего склада</div>
          </div>
          <div className="login-intro__footer">Приятной работы</div>
        </div>
      )}

      <div className="login-card">
        <div className="login-card__brand">СкладОнлайн</div>
        <div className="login-card__tagline">Операционный центр вашего склада</div>
        <LoginHero />
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

      {showWelcome && (
        <div className="login-welcome" role="status" aria-live="polite">
          <div className="login-welcome__backdrop" />
          <div className="login-welcome__card">
            <div className="login-welcome__title">Добро пожаловать на платформу!</div>
            <button type="button" className="login-welcome__logo" onClick={openDashboard}>
              <img src="/logo-mark.png" alt="Логотип СкладОнлайн" />
              <span>СкладОнлайн</span>
            </button>
            <div className="login-welcome__hint">Подготовка рабочего пространства...</div>
          </div>
        </div>
      )}
    </div>
  );
}
