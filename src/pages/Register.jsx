import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
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
  EMAIL_VERIFY_DELIVERY_FAILED:
    "Не удалось отправить код подтверждения. Проверьте почтовые настройки и повторите попытку.",
  MAIL_TIMEOUT: "Почтовый сервер не ответил вовремя. Повторите попытку.",
  EMAIL_VERIFY_ERROR: "Не удалось подтвердить почту. Попробуйте позже.",
  AUTH_DB_PERMISSION_USER_TABLE:
    "Сервер БД не выдал доступ к таблице пользователей (User). Проверьте права роли подключения.",
  AUTH_DB_PERMISSION_ORG_TABLE:
    "Сервер БД не выдал доступ к таблице организаций (Organization). Проверьте права роли подключения.",
  AUTH_DB_PERMISSION_EMAIL_VERIFY_TABLE:
    "Сервер БД не выдал доступ к таблице кодов подтверждения (EmailVerificationCode). Проверьте права роли подключения.",
  EMAIL_NOT_VERIFIED: "Подтвердите почту кодом из письма.",
  EMAIL_INVALID: "Укажите корректную почту с доменом, например name@mail.ru.",
  FULL_NAME_INVALID: "Укажите ФИО полностью (минимум имя и фамилия).",
  PHONE_INVALID: "Укажите корректный номер телефона.",
  COMPANY_INVALID: "Укажите корректное название компании.",
  PRIVACY_CONSENT_REQUIRED: "Подтвердите согласие с обработкой персональных данных.",
};

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/u;
const PHONE_ALLOWED_REGEX = /^[0-9+\-()\s]+$/u;
const PHONE_COUNTRIES = [
  { code: "RU", name: "Россия", dialCode: "+7", placeholder: "+7 (999) 123-45-67" },
  { code: "BY", name: "Беларусь", dialCode: "+375", placeholder: "+375 (29) 123-45-67" },
  { code: "KZ", name: "Казахстан", dialCode: "+7", placeholder: "+7 (777) 123-45-67" },
  { code: "AM", name: "Армения", dialCode: "+374", placeholder: "+374 (77) 123456" },
  { code: "AZ", name: "Азербайджан", dialCode: "+994", placeholder: "+994 (50) 123-45-67" },
  { code: "KG", name: "Киргизия", dialCode: "+996", placeholder: "+996 (555) 123-456" },
  { code: "MD", name: "Молдова", dialCode: "+373", placeholder: "+373 (79) 12345" },
  { code: "TJ", name: "Таджикистан", dialCode: "+992", placeholder: "+992 (93) 123-45-67" },
  { code: "TM", name: "Туркменистан", dialCode: "+993", placeholder: "+993 (65) 123456" },
  { code: "UZ", name: "Узбекистан", dialCode: "+998", placeholder: "+998 (90) 123-45-67" },
];
const DEFAULT_PHONE_COUNTRY = "RU";

function sanitizePhoneInput(value) {
  return String(value || "").replace(/[^\d+\-()\s]/gu, "");
}

function findPhoneCountry(code) {
  return PHONE_COUNTRIES.find((country) => country.code === code) || PHONE_COUNTRIES[0];
}

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
  phoneCountry: DEFAULT_PHONE_COUNTRY,
  phone: "",
  companyName: "",
  password: "",
  confirmPassword: "",
  privacyAccepted: false,
  marketingAccepted: false,
};
const CONSENT_VERSION = "register-2026-03-18";

export default function Register() {
  const { register, verifyRegistrationCode, resendRegistrationCode } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [step, setStep] = useState("register");
  const [form, setForm] = useState(INITIAL_FORM);
  const [verificationCode, setVerificationCode] = useState("");
  const [verificationEmail, setVerificationEmail] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const selectedPhoneCountry = useMemo(
    () => findPhoneCountry(form.phoneCountry),
    [form.phoneCountry]
  );
  const registerPreset = useMemo(() => {
    const params = new URLSearchParams(location.search || "");
    const nextRaw = String(params.get("next") || "").trim();
    const nextAfterVerify =
      nextRaw.startsWith("/") && !nextRaw.startsWith("//")
        ? nextRaw
        : "/dashboard";
    return {
      nextAfterVerify,
      email: String(params.get("email") || "").trim().toLowerCase(),
      name: String(params.get("name") || "").trim(),
      companyName: String(params.get("companyName") || "").trim(),
    };
  }, [location.search]);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = window.setTimeout(() => {
      setResendCooldown((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [resendCooldown]);

  useEffect(() => {
    if (
      !registerPreset.email &&
      !registerPreset.name &&
      !registerPreset.companyName
    ) {
      return;
    }
    setForm((prev) => ({
      ...prev,
      email: registerPreset.email || prev.email,
      name: registerPreset.name || prev.name,
      companyName: registerPreset.companyName || prev.companyName,
    }));
  }, [registerPreset.email, registerPreset.name, registerPreset.companyName]);

  const canSubmitRegister = useMemo(() => {
    if (
      !form.name.trim() ||
      !form.email.trim() ||
      !form.phone.trim() ||
      !form.companyName.trim() ||
      !form.password ||
      !form.confirmPassword ||
      !form.privacyAccepted
    ) {
      return false;
    }
    return true;
  }, [form]);

  const handleChange = (field) => (event) => {
    const value =
      field === "phone" ? sanitizePhoneInput(event.target.value) : event.target.value;
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handlePhoneCountryChange = (event) => {
    const nextCountryCode = String(event.target.value || DEFAULT_PHONE_COUNTRY);
    setForm((prev) => ({ ...prev, phoneCountry: nextCountryCode }));
  };

  const handleRegister = async (event) => {
    event.preventDefault();
    setError("");
    setSuccess("");

    const normalizedName = normalizeFullName(form.name);
    const normalizedEmail = String(form.email || "").trim().toLowerCase();
    let normalizedPhone = String(form.phone || "").trim();
    const normalizedCompanyName = String(form.companyName || "").trim();
    if (!normalizedPhone.startsWith("+")) {
      normalizedPhone = `${selectedPhoneCountry.dialCode} ${normalizedPhone}`.trim();
    }

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

    if (!form.privacyAccepted) {
      setError("Подтвердите согласие с обработкой персональных данных.");
      return;
    }

    setLoading(true);
    const result = await register({
      email: normalizedEmail,
      password: form.password,
      name: normalizedName,
      phone: normalizedPhone,
      companyName: normalizedCompanyName,
      privacyAccepted: Boolean(form.privacyAccepted),
      marketingAccepted: Boolean(form.marketingAccepted),
      consentVersion: CONSENT_VERSION,
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

    navigate(registerPreset.nextAfterVerify);
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
              <div className="register-form__phone-row">
                <select
                  value={form.phoneCountry}
                  onChange={handlePhoneCountryChange}
                  aria-label="Страна и код"
                  required
                >
                  {PHONE_COUNTRIES.map((country) => (
                    <option key={country.code} value={country.code}>
                      {country.name} ({country.dialCode})
                    </option>
                  ))}
                </select>
                <input
                  type="tel"
                  value={form.phone}
                  onChange={handleChange("phone")}
                  autoComplete="tel"
                  placeholder={selectedPhoneCountry.placeholder.replace(/^\+\d+\s*/u, "")}
                  required
                />
              </div>
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

            <label className="register-form__check">
              <input
                type="checkbox"
                checked={form.privacyAccepted}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, privacyAccepted: event.target.checked }))
                }
                required
              />
              <span>
                Я принимаю{" "}
                <Link to="/offer" target="_blank" rel="noreferrer">
                  оферту
                </Link>{" "}
                и даю согласие на{" "}
                <Link to="/privacy" target="_blank" rel="noreferrer">
                  обработку персональных данных
                </Link>
                .
              </span>
            </label>

            <label className="register-form__check">
              <input
                type="checkbox"
                checked={form.marketingAccepted}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, marketingAccepted: event.target.checked }))
                }
              />
              <span>Получать новости и полезные материалы сервиса на почту.</span>
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
