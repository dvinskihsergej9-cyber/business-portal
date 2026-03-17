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
};

function toUiMessage(message, fallback) {
  const key = String(message || "").trim().toUpperCase();
  return ERROR_MESSAGES[key] || message || fallback;
}

const INITIAL_FORM = {
  name: "",
  email: "",
  phone: "",
  companyName: "",
  note: "",
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
    if (!form.name.trim() || !form.email.trim() || !form.password || !form.confirmPassword) {
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
      email: form.email,
      password: form.password,
      name: form.name,
      phone: form.phone,
      companyName: form.companyName,
      note: form.note,
    });
    setLoading(false);

    if (!result.ok) {
      setError(toUiMessage(result.message, "Не удалось зарегистрироваться."));
      return;
    }

    setVerificationEmail(String(result.email || form.email || "").trim().toLowerCase());
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
              <span>Имя</span>
              <input
                type="text"
                value={form.name}
                onChange={handleChange("name")}
                autoComplete="name"
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
                placeholder="Необязательно"
              />
            </label>

            <label className="register-form__field">
              <span>Компания</span>
              <input
                type="text"
                value={form.companyName}
                onChange={handleChange("companyName")}
                placeholder="Необязательно"
              />
            </label>

            <label className="register-form__field">
              <span>Комментарий</span>
              <textarea
                value={form.note}
                onChange={handleChange("note")}
                placeholder="Кратко опишите ваш запрос (необязательно)"
                rows={3}
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
