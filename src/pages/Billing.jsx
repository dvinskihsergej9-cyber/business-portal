import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../apiConfig";
import { useAuth } from "../context/AuthContext";

export default function Billing() {
  const { refreshUser } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");
  const [devLoading, setDevLoading] = useState(false);

  const fetchMe = async () => {
    try {
      setStatus("loading");
      setError("");
      const token = localStorage.getItem("token");
      const res = await apiFetch("/me", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const payload = await res.json();
      if (!res.ok) {
        setStatus("error");
        setError(payload.message || "Не удалось загрузить данные оплаты");
        return;
      }
      setData(payload);
      setStatus("ready");
    } catch (err) {
      console.error("billing fetch error:", err);
      setStatus("error");
      setError("Не удалось загрузить данные оплаты");
    }
  };

  useEffect(() => {
    fetchMe();
  }, []);

  const subscription = data?.subscription || null;
  const isDev = import.meta.env.DEV;

  const activateTestSubscription = async () => {
    try {
      setDevLoading(true);
      setError("");
      const token = localStorage.getItem("token");
      const res = await apiFetch("/dev/activate-test-subscription", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const payload = await res.json();
      if (!res.ok) {
        setError(payload.message || "Не удалось активировать тестовую подписку");
        return;
      }
      await refreshUser();
      navigate("/dashboard");
    } catch (err) {
      console.error("activate test subscription error:", err);
      setError("Не удалось активировать тестовую подписку");
    } finally {
      setDevLoading(false);
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Оплата и тариф</h1>
        <p className="page-subtitle">Управление подпиской и статусом оплаты</p>
      </div>

      {status === "error" && (
        <div className="card" style={{ borderColor: "#ef4444", color: "#b91c1c" }}>
          {error}
        </div>
      )}

      <div className="card" style={{ display: "grid", gap: 10 }}>
        <div>
          <strong>Тариф:</strong> {subscription?.plan || "—"}
        </div>
        <div>
          <strong>Статус:</strong> {subscription?.status || "неактивна"}
        </div>
        <div>
          <strong>Оплачено до:</strong>{" "}
          {subscription?.paidUntil
            ? new Date(subscription.paidUntil).toLocaleDateString()
            : "—"}
        </div>
        <div>
          <strong>Активна:</strong>{" "}
          {subscription?.isActive ? "да" : "нет"}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn" onClick={fetchMe} disabled={status === "loading"}>
            {status === "loading" ? "Обновляем..." : "Обновить статус"}
          </button>
          <a className="btn primary" href="/pricing">
            Продлить подписку
          </a>
        </div>
        {isDev && (
          <div style={{ marginTop: 8 }}>
            <button
              className="btn"
              onClick={activateTestSubscription}
              disabled={devLoading}
            >
              {devLoading
                ? "Активируем..."
                : "Активировать тестовую подписку (30 дней)"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
