import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { API_BASE } from "../apiConfig";

const T = {
  title: "\u0417\u0430\u0432\u0435\u0440\u0448\u0435\u043d\u0438\u0435 \u0440\u0435\u0433\u0438\u0441\u0442\u0440\u0430\u0446\u0438\u0438",
  checking: "\u041f\u0440\u043e\u0432\u0435\u0440\u044f\u0435\u043c \u043f\u0440\u0438\u0433\u043b\u0430\u0448\u0435\u043d\u0438\u0435...",
  email: "\u041f\u043e\u0447\u0442\u0430",
  role: "\u0420\u043e\u043b\u044c",
  fio: "\u0424\u0418\u041e",
  pass: "\u041f\u0430\u0440\u043e\u043b\u044c",
  pass2: "\u041f\u043e\u0432\u0442\u043e\u0440 \u043f\u0430\u0440\u043e\u043b\u044f",
  create: "\u0421\u043e\u0437\u0434\u0430\u0442\u044c \u0430\u043a\u043a\u0430\u0443\u043d\u0442",
  login: "\u0412\u043e\u0439\u0442\u0438",
  success: "\u0410\u043a\u043a\u0430\u0443\u043d\u0442 \u0441\u043e\u0437\u0434\u0430\u043d.",
  phFio: "\u0418\u0432\u0430\u043d\u043e\u0432 \u0418\u0432\u0430\u043d \u0418\u0432\u0430\u043d\u043e\u0432\u0438\u0447",
  phPass: "\u041c\u0438\u043d\u0438\u043c\u0443\u043c 8 \u0441\u0438\u043c\u0432\u043e\u043b\u043e\u0432",
  phPass2: "\u0412\u0432\u0435\u0434\u0438\u0442\u0435 \u043f\u0430\u0440\u043e\u043b\u044c \u0435\u0449\u0451 \u0440\u0430\u0437",
  errFio: "\u0423\u043a\u0430\u0436\u0438\u0442\u0435 \u0424\u0418\u041e (\u043c\u0438\u043d\u0438\u043c\u0443\u043c 2 \u0441\u043b\u043e\u0432\u0430).",
  errPass: "\u041f\u0430\u0440\u043e\u043b\u044c \u043c\u0438\u043d\u0438\u043c\u0443\u043c 8 \u0441\u0438\u043c\u0432\u043e\u043b\u043e\u0432.",
  errPass2: "\u041f\u0430\u0440\u043e\u043b\u0438 \u043d\u0435 \u0441\u043e\u0432\u043f\u0430\u0434\u0430\u044e\u0442.",
};

function mapError(code) {
  switch (code) {
    case "INVITE_EXPIRED":
      return "\u0421\u0441\u044b\u043b\u043a\u0430 \u0443\u0441\u0442\u0430\u0440\u0435\u043b\u0430";
    case "INVITE_USED":
      return "\u0421\u0441\u044b\u043b\u043a\u0430 \u0443\u0436\u0435 \u0438\u0441\u043f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u043d\u0430";
    case "INVITE_NOT_FOUND":
    case "BAD_TOKEN":
    case "INVITE_INVALID":
      return "\u041d\u0435\u0432\u0435\u0440\u043d\u0430\u044f \u0441\u0441\u044b\u043b\u043a\u0430";
    case "WEAK_PASSWORD":
      return "\u041f\u0430\u0440\u043e\u043b\u044c \u0441\u043b\u0438\u0448\u043a\u043e\u043c \u043a\u043e\u0440\u043e\u0442\u043a\u0438\u0439 (\u043c\u0438\u043d\u0438\u043c\u0443\u043c 8 \u0441\u0438\u043c\u0432\u043e\u043b\u043e\u0432)";
    case "PASSWORDS_NOT_MATCH":
      return "\u041f\u0430\u0440\u043e\u043b\u0438 \u043d\u0435 \u0441\u043e\u0432\u043f\u0430\u0434\u0430\u044e\u0442";
    case "EMAIL_ALREADY_EXISTS":
      return "\u0410\u043a\u043a\u0430\u0443\u043d\u0442 \u0441 \u044d\u0442\u043e\u0439 \u043f\u043e\u0447\u0442\u043e\u0439 \u0443\u0436\u0435 \u0435\u0441\u0442\u044c";
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
        const res = await fetch(
          `${API_BASE}/auth/invite-info?token=${encodeURIComponent(token)}`
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
      const res = await fetch(`${API_BASE}/auth/accept-invite`, {
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
            {T.email}: {inviteInfo.email} ? {T.role}: {inviteInfo.role || "-"}
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
            {submitLoading ? "\u0421\u043e\u0437\u0434\u0430\u0435\u043c..." : T.create}
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
