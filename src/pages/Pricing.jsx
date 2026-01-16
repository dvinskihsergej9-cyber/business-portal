import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../apiConfig";
import { useAuth } from "../context/AuthContext";

const PLANS = [
  {
    id: "basic-30",
    title: "Базовый",
    amount: 1990,
    currency: "RUB",
    period: "30 дней",
    description: "Полный доступ к возможностям портала на 30 дней.",
  },
];

function formatPrice(amount, currency) {
  return `${amount} ${currency}`;
}

export default function Pricing() {
  const { user, refreshUser } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [devLoading, setDevLoading] = useState(false);

  const handlePay = async (planId) => {
    try {
      setLoading(true);
      setError("");
      const token = localStorage.getItem("token");
      const res = await apiFetch("/billing/yookassa/create-payment", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ planId }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.message || "Не удалось инициировать оплату");
        return;
      }

      if (data.confirmationUrl) {
        window.location.href = data.confirmationUrl;
        return;
      }

      setError("Не удалось получить ссылку для оплаты");
    } catch (err) {
      console.error("create payment error:", err);
      setError("Не удалось инициировать оплату");
    } finally {
      setLoading(false);
    }
  };

  const activateTestSubscription = async () => {
    try {
      setDevLoading(true);
      setError("");
      const token = localStorage.getItem("token");
      const res = await apiFetch("/dev/activate-test-subscription", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message || "Не удалось активировать тестовую подписку");
        return;
      }
      await refreshUser();
      navigate("/dashboard");
    } catch (err) {
      console.error("test subscription error:", err);
      setError("Не удалось активировать тестовую подписку");
    } finally {
      setDevLoading(false);
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Тарифы</h1>
        <p className="page-subtitle">
          Выберите тариф и активируйте подписку.
        </p>
      </div>

      {user?.subscription?.isActive && (
        <div className="card" style={{ marginBottom: 16 }}>
          <strong>Подписка активна</strong>
          <div>
            Оплачено до:{" "}
            {user.subscription.paidUntil
              ? new Date(user.subscription.paidUntil).toLocaleDateString()
              : "—"}
          </div>
        </div>
      )}

      {error && (
        <div className="card" style={{ borderColor: "#ef4444", color: "#b91c1c" }}>
          {error}
        </div>
      )}

      <div className="card" style={{ display: "grid", gap: 16 }}>
        {PLANS.map((plan) => (
          <div key={plan.id} style={{ display: "grid", gap: 8 }}>
            <div style={{ fontSize: 18, fontWeight: 600 }}>{plan.title}</div>
            <div style={{ fontSize: 14, color: "#6b7280" }}>{plan.description}</div>
            <div style={{ fontSize: 20 }}>
              {formatPrice(plan.amount, plan.currency)} / {plan.period}
            </div>
            <button
              className="btn primary"
              onClick={() => handlePay(plan.id)}
              disabled={loading}
            >
              {loading ? "Переходим к оплате..." : "Оплатить"}
            </button>
          </div>
        ))}
        {import.meta.env.DEV && (
          <div>
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
