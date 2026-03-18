import { useEffect, useRef, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import lottie from "lottie-web";
import { useAuth } from "../context/AuthContext";
import modernWmsWarehouseAnimation from "../assets/login/modernwms-warehouse.json";
import { requestPushPermissionIfNeeded } from "../utils/pushSubscription";

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
  const disablePublicRegister =
    String(import.meta.env.VITE_DISABLE_PUBLIC_REGISTER || "false") === "true";

  const [loginValue, setLoginValue] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pushHint, setPushHint] = useState("");
  const [loading, setLoading] = useState(false);
  const [showWelcome, setShowWelcome] = useState(false);

  useEffect(() => {
    return () => {
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

    setPushHint("");
    const pushPermission = await requestPushPermissionIfNeeded();
    if (pushPermission?.reason === "IOS_NOT_STANDALONE") {
      setPushHint(
        "РќР° iPhone push СЂР°Р±РѕС‚Р°СЋС‚ РёР· СЏСЂР»С‹РєР° В«РќР° СЌРєСЂР°РЅ Р”РѕРјРѕР№В». РћС‚РєСЂРѕР№С‚Рµ РїСЂРёР»РѕР¶РµРЅРёРµ СЃ РёРєРѕРЅРєРё РЅР° РґРѕРјР°С€РЅРµРј СЌРєСЂР°РЅРµ."
      );
    } else if (pushPermission?.reason === "DENIED") {
      setPushHint(
        "РЈРІРµРґРѕРјР»РµРЅРёСЏ РґР»СЏ СЃР°Р№С‚Р° Р·Р°РїСЂРµС‰РµРЅС‹. Р Р°Р·СЂРµС€РёС‚Рµ РёС… РІ РЅР°СЃС‚СЂРѕР№РєР°С… Р±СЂР°СѓР·РµСЂР° Рё РѕС‚РєСЂРѕР№С‚Рµ РїСЂРёР»РѕР¶РµРЅРёРµ СЃРЅРѕРІР°."
      );
    } else if (
      pushPermission?.reason === "NO_NOTIFICATION_API" ||
      pushPermission?.reason === "NO_PUSH_MANAGER"
    ) {
      setPushHint("РќР° СЌС‚РѕРј СѓСЃС‚СЂРѕР№СЃС‚РІРµ push-СѓРІРµРґРѕРјР»РµРЅРёСЏ РЅРµ РїРѕРґРґРµСЂР¶РёРІР°СЋС‚СЃСЏ РІ С‚РµРєСѓС‰РµРј СЂРµР¶РёРјРµ.");
    } else if (pushPermission?.reason === "INSECURE_CONTEXT") {
      setPushHint("Push-СѓРІРµРґРѕРјР»РµРЅРёСЏ СЂР°Р±РѕС‚Р°СЋС‚ С‚РѕР»СЊРєРѕ РїРѕ Р·Р°С‰РёС‰С‘РЅРЅРѕР№ СЃСЃС‹Р»РєРµ https.");
    } else if (pushPermission?.reason === "PERMISSION_NOT_CHOSEN") {
      setPushHint("Р Р°Р·СЂРµС€РµРЅРёРµ РЅР° СѓРІРµРґРѕРјР»РµРЅРёСЏ РЅРµ РІС‹Р±СЂР°РЅРѕ. Р—Р°РїСЂРѕСЃ РјРѕР¶РЅРѕ РІРєР»СЋС‡РёС‚СЊ С‡РµСЂРµР· РєРѕР»РѕРєРѕР»СЊС‡РёРє.");
    }

    setError("");
    setLoading(true);

    const res = await login(loginValue, password);

    setLoading(false);

    if (!res.ok) {
      setError(res.message || "РћС€РёР±РєР° РІС…РѕРґР°");
      return;
    }

    setShowWelcome(true);
    welcomeTimerRef.current = setTimeout(openDashboard, 1700);
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-card__brand">РЎРєР»Р°РґРћРЅР»Р°Р№РЅ</div>
        <div className="login-card__tagline">РћРїРµСЂР°С†РёРѕРЅРЅС‹Р№ С†РµРЅС‚СЂ РІР°С€РµРіРѕ СЃРєР»Р°РґР°</div>
        <LoginHero />
        <h1 className="login-card__title">Р’С…РѕРґ</h1>

        {error && <div className="login-card__error">{error}</div>}
        {pushHint && <div className="login-card__notice">{pushHint}</div>}

        <form onSubmit={handleSubmit} className="login-form">
          <div className="login-form__field">
            <input
              type="text"
              placeholder="Р›РѕРіРёРЅ"
              value={loginValue}
              onChange={(e) => setLoginValue(normalizeLoginInput(e.target.value))}
              required
            />
          </div>

          <div className="login-form__field">
            <input
              type="password"
              placeholder="РџР°СЂРѕР»СЊ"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          <button type="submit" disabled={loading} className="login-form__submit">
            {loading ? "Р’С…РѕРґРёРј..." : "Р’РѕР№С‚Рё"}
          </button>
        </form>

        <p className="login-card__help">
          <Link to="/forgot-password">Р—Р°Р±С‹Р»Рё РїР°СЂРѕР»СЊ?</Link>
        </p>
        {!disablePublicRegister && (
          <p className="login-card__help">
            <Link to="/register">РќРµС‚ Р°РєРєР°СѓРЅС‚Р°? Р—Р°СЂРµРіРёСЃС‚СЂРёСЂРѕРІР°С‚СЊСЃСЏ</Link>
          </p>
        )}
        <div className="login-card__footer">
          <div className="login-card__footer-title">Р”РѕРєСѓРјРµРЅС‚С‹ Рё РєРѕРЅС‚Р°РєС‚С‹</div>
          <div className="login-card__links">
            <Link to="/about">Рћ СЃРµСЂРІРёСЃРµ</Link>
            <Link to="/offer">РћС„РµСЂС‚Р°</Link>
            <Link to="/privacy">РџРѕР»РёС‚РёРєР°</Link>
            <Link to="/contacts">РљРѕРЅС‚Р°РєС‚С‹</Link>
            <Link to="/refund">Р’РѕР·РІСЂР°С‚</Link>
          </div>
        </div>
      </div>

      {showWelcome && (
        <div className="login-welcome" role="status" aria-live="polite">
          <div className="login-welcome__backdrop" />
          <div className="login-welcome__card">
            <div className="login-welcome__title">Р”РѕР±СЂРѕ РїРѕР¶Р°Р»РѕРІР°С‚СЊ РЅР° РїР»Р°С‚С„РѕСЂРјСѓ!</div>
            <button type="button" className="login-welcome__logo" onClick={openDashboard}>
              <img src="/logo-mark.png" alt="Р›РѕРіРѕС‚РёРї РЎРєР»Р°РґРћРЅР»Р°Р№РЅ" />
              <span>РЎРєР»Р°РґРћРЅР»Р°Р№РЅ</span>
            </button>
            <div className="login-welcome__hint">РџРѕРґРіРѕС‚РѕРІРєР° СЂР°Р±РѕС‡РµРіРѕ РїСЂРѕСЃС‚СЂР°РЅСЃС‚РІР°...</div>
          </div>
        </div>
      )}
    </div>
  );
}

