import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

const normalizeLoginInput = (value) =>
  String(value || "").replace(/\s+/g, "_");

function LoginCartAnimation() {
  return (
    <div className="login-hero" aria-hidden="true">
      <svg
        className="login-hero__scene"
        viewBox="0 0 760 300"
        role="img"
        aria-label="Warehouse worker with cart"
      >
        <path
          className="login-hero__blob"
          d="M86 242c-20-18-31-44-26-72 8-49 54-87 112-93 18-42 66-71 124-71 33 0 63 10 86 27 21-10 44-15 68-15 63 0 114 37 121 88 43 22 69 63 64 105-7 56-64 99-134 99H196c-45 0-84-14-110-39z"
        />
        <ellipse className="login-hero__cloud login-hero__cloud--one" cx="210" cy="74" rx="50" ry="20" />
        <ellipse className="login-hero__cloud login-hero__cloud--two" cx="300" cy="56" rx="36" ry="14" />
        <ellipse className="login-hero__cloud login-hero__cloud--three" cx="640" cy="72" rx="45" ry="18" />
        <ellipse className="login-hero__ground" cx="390" cy="250" rx="300" ry="22" />
        <ellipse className="login-hero__ground-shadow" cx="470" cy="252" rx="120" ry="14" />

        <g className="login-hero__rack">
          <rect x="106" y="108" width="260" height="104" rx="8" />
          <line x1="106" y1="142" x2="366" y2="142" />
          <line x1="106" y1="176" x2="366" y2="176" />
          <line x1="174" y1="108" x2="174" y2="212" />
          <line x1="242" y1="108" x2="242" y2="212" />
          <line x1="310" y1="108" x2="310" y2="212" />
        </g>

        <g className="login-hero__rack-boxes">
          <rect x="112" y="112" width="56" height="28" rx="4" />
          <rect x="178" y="112" width="56" height="28" rx="4" />
          <rect x="246" y="112" width="56" height="28" rx="4" />
          <rect x="314" y="112" width="46" height="28" rx="4" />

          <rect x="112" y="146" width="56" height="28" rx="4" />
          <rect x="178" y="146" width="56" height="28" rx="4" />
          <rect x="246" y="146" width="56" height="28" rx="4" />

          <rect x="112" y="180" width="56" height="28" rx="4" />
          <rect x="178" y="180" width="56" height="28" rx="4" />
          <rect x="246" y="180" width="56" height="28" rx="4" />
          <rect x="314" y="180" width="46" height="28" rx="4" />
        </g>

        <g className="login-hero__worker-group">
          <g className="login-hero__cart-group">
            <rect x="352" y="190" width="186" height="10" rx="5" className="login-hero__cart-base" />
            <line x1="352" y1="190" x2="352" y2="216" className="login-hero__cart-frame" />
            <line x1="538" y1="190" x2="538" y2="216" className="login-hero__cart-frame" />
            <line x1="538" y1="190" x2="555" y2="164" className="login-hero__cart-frame" />
            <line x1="555" y1="164" x2="555" y2="132" className="login-hero__cart-frame" />

            <rect x="388" y="138" width="72" height="50" rx="5" className="login-hero__cart-box" />
            <rect
              x="462"
              y="138"
              width="56"
              height="50"
              rx="5"
              className="login-hero__cart-box login-hero__cart-box--dark"
            />
            <rect x="430" y="100" width="66" height="38" rx="5" className="login-hero__cart-box" />
            <line x1="425" y1="128" x2="498" y2="128" className="login-hero__cart-box-line" />

            <g className="login-hero__wheel-group login-hero__wheel-group--left">
              <circle cx="392" cy="220" r="20" className="login-hero__wheel-ring" />
              <circle cx="392" cy="220" r="10" className="login-hero__wheel-core" />
              <line x1="392" y1="200" x2="392" y2="240" className="login-hero__wheel-spoke" />
              <line x1="372" y1="220" x2="412" y2="220" className="login-hero__wheel-spoke" />
            </g>

            <g className="login-hero__wheel-group login-hero__wheel-group--right">
              <circle cx="505" cy="220" r="20" className="login-hero__wheel-ring" />
              <circle cx="505" cy="220" r="10" className="login-hero__wheel-core" />
              <line x1="505" y1="200" x2="505" y2="240" className="login-hero__wheel-spoke" />
              <line x1="485" y1="220" x2="525" y2="220" className="login-hero__wheel-spoke" />
            </g>
          </g>

          <g className="login-hero__person-group">
            <circle cx="584" cy="98" r="16" className="login-hero__person-skin" />
            <path d="M571 92c8-14 31-12 34 3-5 3-10 3-15 2-6 0-11 0-19-5z" className="login-hero__person-hair" />
            <circle cx="590" cy="97" r="1.7" className="login-hero__person-eye" />
            <path d="M592 104c3 2 7 2 10 0" className="login-hero__person-smile" />

            <path d="M536 130c20-19 58-20 75-3 10 10 12 28 2 40l-17 22-36-58z" className="login-hero__person-body" />
            <path d="M553 135c18-10 36-6 50 8" className="login-hero__person-body-line" />

            <g className="login-hero__person-arm-group">
              <path d="M568 112l-32 30-20 8 5 16 26-9 30-27" className="login-hero__person-arm" />
            </g>

            <g className="login-hero__person-leg-group login-hero__person-leg-group--back">
              <path d="M590 171l-6 43c-1 8-6 14-13 17l-24 10-8-17 18-10 4-43z" className="login-hero__person-leg" />
              <rect x="536" y="227" width="52" height="14" rx="6" className="login-hero__shoe" />
            </g>

            <g className="login-hero__person-leg-group login-hero__person-leg-group--front">
              <path
                d="M551 176l-14 40c-3 8-10 13-18 13h-25v-18h17l8-35z"
                className="login-hero__person-leg person-leg-light"
              />
              <rect x="490" y="227" width="42" height="14" rx="6" className="login-hero__shoe" />
            </g>
          </g>
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
