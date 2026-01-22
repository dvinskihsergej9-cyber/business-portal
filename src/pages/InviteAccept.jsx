import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { apiFetch } from "../apiConfig";

const T = {
  title: "Завершение регистрации",
  checking: "Проверяем приглашение...",
  email: "Эл. почта",
  role: "Роль",
  fio: "ФИО",
  pass: "Пароль",
  pass2: "Повтор пароля",
  create: "Создать аккаунт",
  login: "Войти",
  success: "Аккаунт создан.",
  phFio: "Иванов Иван Иванович",
  phPass: "Минимум 8 символов",
  phPass2: "Введите пароль ещё раз",
  errFio: "Укажите ФИО (минимум 2 слова).",
  errPass: "Пароль минимум 8 символов.",
  errPass2: "Пароли не совпадают.",
};

function mapError(code) {
  switch (code) {
    case "INVITE_EXPIRED":
      return "Ссылка устарела";
    case "INVITE_USED":
      return "Ссылка уже использована";
    case "INVITE_NOT_FOUND":
    case "BAD_TOKEN":
    case "INVITE_INVALID":
      return "Неверная ссылка";
    case "WEAK_PASSWORD":
      return "Пароль слишком короткий (минимум 8 символов)";
    case "PASSWORDS_NOT_MATCH":
      return "Пароли не совпадают";
    case "EMAIL_ALREADY_EXISTS":
      return "Аккаунт с этой почтой уже есть";
    default:
      return code;
  }
}

function getValidationErrors(form) {
  const errors = {};
  const name = form.name.trim();
  if (!name || name.split(/\s+/).length < 2) {
    errors.name = T.errFio;
  }
  if (!form.password || form.password.length < 8) {
    errors.password = T.errPass;
  }
  if (form.password !== form.passwordRepeat) {
    errors.passwordRepeat = T.errPass2;
  }
  return errors;
}

export default function InviteAccept() {
  const [params] = useSearchParams();
  const navigate = useNavigate();

  const token = params.get("token") || "";
  const [infoLoading, setInfoLoading] = useState(true);
  const [infoError, setInfoError] = useState("");
  const [inviteInfo, setInviteInfo] = useState(null);

  const [form, setForm] = useState({
    name: "",
    password: "",
    passwordRepeat: "",
  });
  const [fieldErrors, setFieldErrors] = useState({});
  const [submitError, setSubmitError] = useState("");
  const [submitLoading, setSubmitLoading] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const loadInfo = async () => {
      if (!token) {
        setInfoError("INVALID_TOKEN");
        setInfoLoading(false);
        return;
      }
      try {
        setInfoLoading(true);
        setInfoError("");
        const res = await apiFetch(
          `/auth/invite-info?token=${encodeURIComponent(token)}`
        );
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.message || "INVITE_INVALID");
        }
        setInviteInfo(data);
      } catch (err) {
        setInfoError(err.message);
      } finally {
        setInfoLoading(false);
      }
    };

    loadInfo();
  }, [token]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSubmitError("");

    const validationErrors = getValidationErrors(form);
    setFieldErrors(validationErrors);
    if (Object.keys(validationErrors).length > 0) return;

    try {
      setSubmitLoading(true);
      const res = await apiFetch("/auth/accept-invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          password: form.password,
          name: form.name.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || "INVITE_ACCEPT_ERROR");
      }
      setDone(true);
    } catch (err) {
      setSubmitError(err.message);
    } finally {
      setSubmitLoading(false);
    }
  };

  const validationErrors = getValidationErrors(form);
  const isFormValid = Object.keys(validationErrors).length === 0;

  return (
    <div style={{ maxWidth: 420, margin: "60px auto", padding: "0 16px" }}>
      <h1 style={{ marginBottom: 12 }}>{T.title}</h1>

      {infoLoading && <p>{T.checking}</p>}

      {!infoLoading && infoError && (
        <div
          style={{
            background: "#ffe6e6",
            color: "#b00020",
            padding: 8,
            marginBottom: 12,
            borderRadius: 4,
          }}
        >
          {mapError(infoError)}
        </div>
      )}

      {!infoLoading && inviteInfo && !done && (
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 12, color: "#6b7280", fontSize: 13 }}>
            Эл. почта: {inviteInfo.email} · Роль: {inviteInfo.role || "-"}
          </div>

          <div style={{ marginBottom: 10 }}>
            <label style={{ display: "block", marginBottom: 6 }}>{T.fio}</label>
            <input
              type="text"
              placeholder={T.phFio}
              value={form.name}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, name: e.target.value }))
              }
              style={{ width: "100%", padding: 8, boxSizing: "border-box" }}
            />
            {fieldErrors.name && (
              <div style={{ color: "#b00020", marginTop: 4, fontSize: 12 }}>
                {fieldErrors.name}
              </div>
            )}
          </div>

          <div style={{ marginBottom: 10 }}>
            <label style={{ display: "block", marginBottom: 6 }}>{T.pass}</label>
            <input
              type="password"
              placeholder={T.phPass}
              value={form.password}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, password: e.target.value }))
              }
              style={{ width: "100%", padding: 8, boxSizing: "border-box" }}
            />
            {fieldErrors.password && (
              <div style={{ color: "#b00020", marginTop: 4, fontSize: 12 }}>
                {fieldErrors.password}
              </div>
            )}
          </div>

          <div style={{ marginBottom: 12 }}>
            <label style={{ display: "block", marginBottom: 6 }}>
              {T.pass2}
            </label>
            <input
              type="password"
              placeholder={T.phPass2}
              value={form.passwordRepeat}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, passwordRepeat: e.target.value }))
              }
              style={{ width: "100%", padding: 8, boxSizing: "border-box" }}
            />
            {fieldErrors.passwordRepeat && (
              <div style={{ color: "#b00020", marginTop: 4, fontSize: 12 }}>
                {fieldErrors.passwordRepeat}
              </div>
            )}
          </div>

          {submitError && (
            <div
              style={{
                background: "#ffe6e6",
                color: "#b00020",
                padding: 8,
                marginBottom: 12,
                borderRadius: 4,
              }}
            >
              {mapError(submitError)}
            </div>
          )}

          <button
            type="submit"
            disabled={submitLoading || !isFormValid}
            style={{
              width: "100%",
              padding: 10,
              background: submitLoading || !isFormValid ? "#9db7e0" : "#1976d2",
              color: "#fff",
              border: "none",
              cursor: submitLoading || !isFormValid ? "not-allowed" : "pointer",
            }}
          >
            {submitLoading ? "Создаём..." : T.create}
          </button>
        </form>
      )}

      {done && (
        <div
          style={{
            background: "#e6ffed",
            color: "#146c2e",
            padding: 10,
            borderRadius: 4,
          }}
        >
          {T.success}
          <div style={{ marginTop: 8 }}>
            <button
              type="button"
              onClick={() => navigate("/login")}
              style={{
                padding: "8px 14px",
                background: "#1976d2",
                color: "#fff",
                border: "none",
                cursor: "pointer",
              }}
            >
              {T.login}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
