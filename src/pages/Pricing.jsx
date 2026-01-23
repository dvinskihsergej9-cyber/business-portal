import { useEffect, useState } from "react";
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
  const [loadingMethod, setLoadingMethod] = useState("");
  const [error, setError] = useState("");
  const [billingReady, setBillingReady] = useState(false);
  const [billingLoading, setBillingLoading] = useState(true);

  const handlePay = async (planId, paymentMethod = "sbp") => {
    try {
      setLoading(true);
      setLoadingMethod(paymentMethod);
      setError("");
      const token = localStorage.getItem("token");
      const res = await apiFetch("/billing/yookassa/create-payment", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ planId, paymentMethod }),
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
      setLoadingMethod("");
    }
  };

  const handleStartTrial = async () => {
    try {
      setLoading(true);
      setError("");
      const res = await apiFetch("/billing/start-trial", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message || "Не удалось активировать trial");
        return;
      }
      await refreshUser();
      navigate("/warehouse");
    } catch (err) {
      console.error("start trial error:", err);
      setError("Не удалось активировать trial");
    } finally {
      setLoading(false);
    }
  };

  const loadBillingConfig = async () => {
    try {
      const res = await apiFetch("/billing/config");
      const data = await res.json();
      setBillingReady(Boolean(data?.yookassaEnabled));
    } catch (err) {
      console.error("billing config error:", err);
      setBillingReady(false);
    } finally {
      setBillingLoading(false);
    }
  };

  useEffect(() => {
    loadBillingConfig();
  }, []);

  const subscription = user?.subscription;
  const trialAvailable = !subscription?.isActive && !subscription?.trialUsed;

  const handleRefresh = async () => {
    await refreshUser();
    navigate("/warehouse");
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
          <button className="btn" onClick={handleRefresh} style={{ marginTop: 8 }}>
            Обновить статус
          </button>
        </div>
      )}

      {error && (
        <div className="card" style={{ borderColor: "#ef4444", color: "#b91c1c" }}>
          {error}
        </div>
      )}

      {trialAvailable && (
        <div className="card" style={{ marginBottom: 16 }}>
          <strong>Бесплатный trial</strong>
          <div style={{ marginTop: 6 }}>
            Можно активировать один раз на 30 дней.
          </div>
          <button
            className="btn primary"
            onClick={handleStartTrial}
            disabled={loading}
            style={{ marginTop: 10 }}
          >
            {loading ? "Активируем..." : "Попробовать бесплатно 30 дней"}
          </button>
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
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                className="btn primary"
                onClick={() => handlePay(plan.id, "sbp")}
                disabled={loading || billingLoading || !billingReady}
              >
                {loading && loadingMethod === "sbp"
                  ? "Переходим к оплате..."
                  : billingReady
                    ? "Оплатить по СБП"
                    : "Оплата будет доступна после модерации"}
              </button>
              <button
                className="btn"
                onClick={() => handlePay(plan.id, "default")}
                disabled={loading || billingLoading || !billingReady}
              >
                {loading && loadingMethod === "default"
                  ? "Переходим к оплате..."
                  : billingReady
                    ? "Оплатить картой"
                    : "Оплата будет доступна после модерации"}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
