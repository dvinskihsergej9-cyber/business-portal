import { Link, useSearchParams } from "react-router-dom";
import { useEffect, useState } from "react";
import { apiFetch } from "../apiConfig";

const STATUS_LOADING = "loading";
const STATUS_SUCCESS = "success";
const STATUS_ERROR = "error";

export default function MarketingUnsubscribe() {
  const [params] = useSearchParams();
  const [status, setStatus] = useState(STATUS_LOADING);
  const [message, setMessage] = useState("Проверяем ссылку отписки...");

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      const token = String(params.get("token") || "").trim();
      if (!token) {
        if (!cancelled) {
          setStatus(STATUS_ERROR);
          setMessage("Ссылка отписки повреждена или устарела.");
        }
        return;
      }

      try {
        const res = await apiFetch("/public/marketing/unsubscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
        const data = await res.json().catch(() => ({}));

        if (!cancelled) {
          if (!res.ok) {
            setStatus(STATUS_ERROR);
            setMessage(data?.message || "Не удалось отписаться от рассылки.");
            return;
          }
          setStatus(STATUS_SUCCESS);
          setMessage(data?.message || "Вы успешно отписались от рассылки.");
        }
      } catch (err) {
        if (!cancelled) {
          setStatus(STATUS_ERROR);
          setMessage(String(err?.message || "Не удалось отписаться от рассылки."));
        }
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [params]);

  return (
    <div className="login-page">
      <div className="login-card register-card">
        <h1 className="login-card__title register-card__title">Управление рассылкой</h1>

        {status === STATUS_LOADING && <div className="register-card__success">{message}</div>}
        {status === STATUS_SUCCESS && <div className="register-card__success">{message}</div>}
        {status === STATUS_ERROR && <div className="register-card__error">{message}</div>}

        <p className="register-card__footer">
          <Link to="/login">Перейти ко входу</Link>
        </p>
      </div>
    </div>
  );
}
