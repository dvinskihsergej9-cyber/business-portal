import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

const ERROR_MESSAGES = {
  EMAIL_ALREADY_EXISTS: "Пользователь с такой почтой уже существует.",
  OWNER_EMAIL_RESERVED: "Эта почта зарезервирована для владельца платформы.",
  WEAK_PASSWORD: "Пароль должен быть не короче 8 символов.",
  EMAIL_VERIFY_RATE_LIMIT: "Слишком часто. Подождите минуту и повторите.",
  EMAIL_VERIFY_CODE_INVALID: "Неверный код подтверждения.",
  EMAIL_VERIFY_CODE_EXPIRED: "Срок действия кода истек. Запросите новый код.",
  EMAIL_VERIFY_TOO_MANY_ATTEMPTS: "Превышено число попыток. Запросите новый код.",
  EMAIL_ALREADY_VERIFIED: "Почта уже подтверждена. Войдите в систему.",
  EMAIL_VERIFY_ERROR: "Не удалось подтвердить почту. Попробуйте позже.",
  EMAIL_NOT_VERIFIED: "Подтвердите почту кодом из письма.",
  EMAIL_INVALID: "Укажите корректную почту с доменом, например name@mail.ru.",
  FULL_NAME_INVALID: "Укажите ФИО полностью (минимум имя и фамилия).",
  PHONE_INVALID: "Укажите корректный номер телефона.",
  COMPANY_INVALID: "Укажите корректное название компании.",
};

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/u;
const PHONE_ALLOWED_REGEX = /^[0-9+\-()\s]+$/u;

function toUiMessage(message, fallback) {
  const key = String(message || "").trim().toUpperCase();
  return ERROR_MESSAGES[key] || message || fallback;
}

function normalizeFullName(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function isValidFullName(value) {
  const normalized = normalizeFullName(value);
  if (!normalized) return false;
  const words = normalized.split(" ").filter(Boolean);
  return words.length >= 2 && words.every((word) => word.length >= 2);
}

function isValidEmail(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!EMAIL_REGEX.test(normalized)) return false;
  const domain = String(normalized.split("@")[1] || "");
  if (!domain || domain.startsWith(".") || domain.endsWith(".")) return false;
  return true;
}

function isValidPhone(value) {
  const normalized = String(value || "").trim();
  if (!normalized) return false;
  if (!PHONE_ALLOWED_REGEX.test(normalized)) return false;
  const digits = normalized.replace(/\D+/g, "");
  return digits.length >= 10 && digits.length <= 15;
}

const INITIAL_FORM = {
  name: "",
  email: "",
  phone: "",
  companyName: "",
  password: "",
  confirmPassword: "",
};

export default function Register() {
  const { register, verifyRegistrationCode, resendRegistrationCode } = useAuth();
  const navigate = useNavigate();

  const [step, setStep] = useState("register");
  const [form, setForm] = useState(INITIAL_FORM);
  const [verificationCode, setVerificationCode] = useState("");
  const [verificationEmail, setVerificationEmail] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = window.setTimeout(() => {
      setResendCooldown((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [resendCooldown]);

  const canSubmitRegister = useMemo(() => {
    if (
      !form.name.trim() ||
      !form.email.trim() ||
      !form.phone.trim() ||
      !form.companyName.trim() ||
      !form.password ||
      !form.confirmPassword
    ) {
      return false;
    }
    return true;
  }, [form]);

  const handleChange = (field) => (event) => {
    const value = event.target.value;
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleRegister = async (event) => {
    event.preventDefault();
    setError("");
    setSuccess("");

    const normalizedName = normalizeFullName(form.name);
    const normalizedEmail = String(form.email || "").trim().toLowerCase();
    const normalizedPhone = String(form.phone || "").trim();
    const normalizedCompanyName = String(form.companyName || "").trim();

    if (!isValidFullName(normalizedName)) {
      setError("Укажите ФИО полностью (минимум имя и фамилия).");
      return;
    }

    if (!isValidEmail(normalizedEmail)) {
      setError("Укажите корректную почту с доменом, например name@mail.ru.");
      return;
    }

    if (!isValidPhone(normalizedPhone)) {
      setError("Укажите корректный номер телефона.");
      return;
    }

    if (normalizedCompanyName.length < 2) {
      setError("Укажите корректное название компании.");
      return;
    }

    if (form.password !== form.confirmPassword) {
      setError("Пароли не совпадают.");
      return;
    }

    if (String(form.password).length < 8) {
      setError("Пароль должен быть не короче 8 символов.");
      return;
    }

    setLoading(true);
    const result = await register({
      email: normalizedEmail,
      password: form.password,
      name: normalizedName,
      phone: normalizedPhone,
      companyName: normalizedCompanyName,
    });
    setLoading(false);

    if (!result.ok) {
      setError(toUiMessage(result.message, "Не удалось зарегистрироваться."));
      return;
    }

    setVerificationEmail(String(result.email || normalizedEmail).trim().toLowerCase());
    setStep("verify");
    setSuccess(result.message || "Мы отправили код подтверждения на почту.");
    setResendCooldown(60);
  };

  const handleVerify = async (event) => {
    event.preventDefault();
    setError("");
    setSuccess("");

    const normalizedCode = String(verificationCode || "").replace(/\s+/g, "");
    if (!/^\d{6}$/.test(normalizedCode)) {
      setError("Введите шестизначный код из письма.");
      return;
    }

    setLoading(true);
    const result = await verifyRegistrationCode(verificationEmail, normalizedCode);
    setLoading(false);

    if (!result.ok) {
      setError(toUiMessage(result.message, "Не удалось подтвердить почту."));
      return;
    }

    navigate("/dashboard");
  };

  const handleResend = async () => {
    if (loading || resendCooldown > 0) return;
    setError("");
    setSuccess("");

    setLoading(true);
    const result = await resendRegistrationCode(verificationEmail);
    setLoading(false);

    if (!result.ok) {
      setError(toUiMessage(result.message, "Не удалось отправить код повторно."));
      return;
    }

    setSuccess(result.message || "Код отправлен повторно.");
    setResendCooldown(60);
  };

  return (
    <div className="login-page">
      <div className="login-card register-card">
        <h1 className="login-card__title register-card__title">Регистрация</h1>

        {error && <div className="register-card__error">{error}</div>}
        {success && <div className="register-card__success">{success}</div>}

        {step === "register" ? (
          <form onSubmit={handleRegister} className="register-form" noValidate>
            <label className="register-form__field">
              <span>ФИО</span>
              <input
                type="text"
                value={form.name}
                onChange={handleChange("name")}
                autoComplete="name"
                placeholder="Иванов Иван Иванович"
                required
              />
            </label>

            <label className="register-form__field">
              <span>Почта</span>
              <input
                type="email"
                value={form.email}
                onChange={handleChange("email")}
                autoComplete="email"
                placeholder="name@mail.ru"
                required
              />
            </label>

            <label className="register-form__field">
              <span>Телефон</span>
              <input
                type="tel"
                value={form.phone}
                onChange={handleChange("phone")}
                autoComplete="tel"
                placeholder="+7 (999) 123-45-67"
                required
              />
            </label>

            <label className="register-form__field">
              <span>Компания</span>
              <input
                type="text"
                value={form.companyName}
                onChange={handleChange("companyName")}
                placeholder="ООО Пример"
                required
              />
            </label>

            <label className="register-form__field">
              <span>Пароль</span>
              <input
                type="password"
                value={form.password}
                onChange={handleChange("password")}
                autoComplete="new-password"
                minLength={8}
                placeholder="Минимум 8 символов"
                required
              />
            </label>

            <label className="register-form__field">
              <span>Повтор пароля</span>
              <input
                type="password"
                value={form.confirmPassword}
                onChange={handleChange("confirmPassword")}
                autoComplete="new-password"
                minLength={8}
                required
              />
            </label>

            <button
              type="submit"
              disabled={loading || !canSubmitRegister}
              className="register-form__submit"
            >
              {loading ? "Регистрируем..." : "Продолжить"}
            </button>
          </form>
        ) : (
          <form onSubmit={handleVerify} className="register-form" noValidate>
            <p className="register-card__hint">
              Мы отправили код подтверждения на <strong>{verificationEmail}</strong>.
            </p>

            <label className="register-form__field">
              <span>Код подтверждения</span>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={verificationCode}
                onChange={(event) => {
                  const numericValue = String(event.target.value || "")
                    .replace(/\D+/g, "")
                    .slice(0, 6);
                  setVerificationCode(numericValue);
                }}
                placeholder="6 цифр"
                required
              />
            </label>

            <button type="submit" disabled={loading} className="register-form__submit">
              {loading ? "Подтверждаем..." : "Подтвердить и войти"}
            </button>

            <button
              type="button"
              onClick={handleResend}
              disabled={loading || resendCooldown > 0}
              className="register-form__secondary"
            >
              {resendCooldown > 0
                ? `Отправить код снова через ${resendCooldown} с`
                : "Отправить код повторно"}
            </button>

            <button
              type="button"
              className="register-form__link"
              onClick={() => {
                setStep("register");
                setError("");
                setSuccess("");
              }}
            >
              Изменить данные регистрации
            </button>
          </form>
        )}

        <p className="register-card__footer">
          Уже есть аккаунт? <Link to="/login">Войти</Link>
        </p>
      </div>
    </div>
  );
}
