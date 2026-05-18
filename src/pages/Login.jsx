import { useEffect, useRef, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import lottie from "lottie-web";
import { useAuth } from "../context/AuthContext";
import modernWmsWarehouseAnimation from "../assets/login/modernwms-warehouse.json";
import { ensurePushSubscription, requestPushPermissionIfNeeded } from "../utils/pushSubscription";

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
  const { login, startDemoSession, signInWithToken } = useAuth();
  const navigate = useNavigate();
  const welcomeTimerRef = useRef(null);
  const demoAutoStartedRef = useRef(false);
  const disablePublicRegister =
    String(import.meta.env.VITE_DISABLE_PUBLIC_REGISTER || "false") === "true";

  const [loginValue, setLoginValue] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pushHint, setPushHint] = useState("");
  const [loading, setLoading] = useState(false);
  const [demoLoading, setDemoLoading] = useState(false);
  const [showWelcome, setShowWelcome] = useState(false);

  useEffect(() => {
    return () => {
      if (welcomeTimerRef.current) {
        clearTimeout(welcomeTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (demoAutoStartedRef.current) return;
    const params = new URLSearchParams(window.location.search || "");
    const demoToken = String(params.get("demo_token") || "").trim();
    const demoFlag = String(params.get("demo") || "").trim() === "1";
    if (!demoToken && !demoFlag) return;

    demoAutoStartedRef.current = true;
    params.delete("demo_token");
    params.delete("demo");
    params.delete("demo_from");
    const cleanSearch = params.toString();
    const cleanUrl = `${window.location.pathname}${cleanSearch ? `?${cleanSearch}` : ""}`;
    window.history.replaceState({}, "", cleanUrl);

    const start = async () => {
      setError("");
      setPushHint("");
      setDemoLoading(true);
      const result = demoToken
        ? await signInWithToken(demoToken)
        : await startDemoSession();
      setDemoLoading(false);
      if (!result.ok) {
        setError(result.message || "Не удалось открыть демо.");
        return;
      }
      setShowWelcome(true);
      welcomeTimerRef.current = setTimeout(openDashboard, 1200);
    };

    start();
  }, [signInWithToken, startDemoSession]);

  const openDashboard = () => {
    if (welcomeTimerRef.current) {
      clearTimeout(welcomeTimerRef.current);
    }
    navigate("/dashboard");
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (loading || showWelcome) return;

    setPushHint("");
    const pushPermission = await requestPushPermissionIfNeeded();
    if (pushPermission?.reason === "IOS_NOT_STANDALONE") {
      setPushHint(
        "На iPhone push работают из ярлыка «На экран Домой». Откройте приложение с иконки на домашнем экране."
      );
    } else if (pushPermission?.reason === "DENIED") {
      setPushHint(
        "Уведомления для сайта запрещены. Разрешите их в настройках браузера и откройте приложение снова."
      );
    } else if (
      pushPermission?.reason === "NO_NOTIFICATION_API" ||
      pushPermission?.reason === "NO_PUSH_MANAGER"
    ) {
      setPushHint("На этом устройстве push-уведомления не поддерживаются в текущем режиме.");
    } else if (pushPermission?.reason === "INSECURE_CONTEXT") {
      setPushHint("Push-уведомления работают только по защищённой ссылке https.");
    } else if (pushPermission?.reason === "PERMISSION_NOT_CHOSEN") {
      setPushHint("Разрешение на уведомления не выбрано. Разрешите уведомления в окне браузера.");
    }

    setError("");
    setLoading(true);

    const res = await login(loginValue, password);

    setLoading(false);

    if (!res.ok) {
      setError(res.message || "Ошибка входа");
      return;
    }

    const token = localStorage.getItem("token");
    if (token) {
      ensurePushSubscription({
        token,
        interactive: false,
        forceRebind: true,
      }).catch(() => null);
    }

    setShowWelcome(true);
    welcomeTimerRef.current = setTimeout(openDashboard, 1700);
  };

  const handleStartDemo = async () => {
    if (loading || demoLoading || showWelcome) return;
    setError("");
    setPushHint("");
    setDemoLoading(true);
    const result = await startDemoSession();
    setDemoLoading(false);
    if (!result.ok) {
      setError(result.message || "Не удалось запустить демо.");
      return;
    }
    setShowWelcome(true);
    welcomeTimerRef.current = setTimeout(openDashboard, 1200);
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-card__brand">СкладОнлайн</div>
        <div className="login-card__tagline">Операционный центр вашего склада</div>
        <LoginHero />
        <h1 className="login-card__title">Вход</h1>

        {error && <div className="login-card__error">{error}</div>}
        {pushHint && <div className="login-card__notice">{pushHint}</div>}

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
          <button
            type="button"
            disabled={loading || demoLoading}
            className="register-form__secondary"
            onClick={handleStartDemo}
          >
            {demoLoading ? "Подготавливаем демо..." : "Попробовать демо 72ч"}
          </button>
        </form>

        <p className="login-card__help">
          <Link to="/forgot-password">Забыли пароль?</Link>
        </p>
        {!disablePublicRegister && (
          <p className="login-card__help">
            <Link to="/register">Нет аккаунта? Зарегистрироваться</Link>
          </p>
        )}

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
