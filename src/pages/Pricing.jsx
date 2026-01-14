import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../apiConfig";
import { useAuth } from "../context/AuthContext";

const PLANS = [
  {
    id: "basic-30",
    title: "Basic",
    amount: 1990,
    currency: "RUB",
    period: "30 days",
    description: "Full access to the portal features for 30 days.",
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
        setError(data.message || "Payment init failed");
        return;
      }

      if (data.confirmationUrl) {
        window.location.href = data.confirmationUrl;
        return;
      }

      setError("Payment confirmation URL missing");
    } catch (err) {
      console.error("create payment error:", err);
      setError("Payment init failed");
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
        setError(data.message || "Test subscription failed");
        return;
      }
      await refreshUser();
      navigate("/dashboard");
    } catch (err) {
      console.error("test subscription error:", err);
      setError("Test subscription failed");
    } finally {
      setDevLoading(false);
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Pricing</h1>
        <p className="page-subtitle">
          Choose a plan and activate your subscription.
        </p>
      </div>

      {user?.subscription?.isActive && (
        <div className="card" style={{ marginBottom: 16 }}>
          <strong>Subscription active</strong>
          <div>
            Paid until:{" "}
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
              {loading ? "Redirecting..." : "Pay"}
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
                ? "Activating..."
                : "Activate test subscription (30 days)"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
