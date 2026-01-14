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
        setError(payload.message || "Failed to load billing data");
        return;
      }
      setData(payload);
      setStatus("ready");
    } catch (err) {
      console.error("billing fetch error:", err);
      setStatus("error");
      setError("Failed to load billing data");
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
        setError(payload.message || "Failed to activate test subscription");
        return;
      }
      await refreshUser();
      navigate("/dashboard");
    } catch (err) {
      console.error("activate test subscription error:", err);
      setError("Failed to activate test subscription");
    } finally {
      setDevLoading(false);
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Billing</h1>
        <p className="page-subtitle">Manage your subscription</p>
      </div>

      {status === "error" && (
        <div className="card" style={{ borderColor: "#ef4444", color: "#b91c1c" }}>
          {error}
        </div>
      )}

      <div className="card" style={{ display: "grid", gap: 10 }}>
        <div>
          <strong>Plan:</strong> {subscription?.plan || "—"}
        </div>
        <div>
          <strong>Status:</strong> {subscription?.status || "inactive"}
        </div>
        <div>
          <strong>Paid until:</strong>{" "}
          {subscription?.paidUntil
            ? new Date(subscription.paidUntil).toLocaleDateString()
            : "—"}
        </div>
        <div>
          <strong>Active:</strong>{" "}
          {subscription?.isActive ? "yes" : "no"}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn" onClick={fetchMe} disabled={status === "loading"}>
            {status === "loading" ? "Refreshing..." : "Refresh status"}
          </button>
          <a className="btn primary" href="/pricing">
            Extend subscription
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
                ? "Activating..."
                : "Activate test subscription (30 days)"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
