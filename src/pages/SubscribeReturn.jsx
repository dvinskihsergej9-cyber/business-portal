import { useEffect, useRef, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { API_BASE } from "../apiConfig";

export default function SubscribeReturn() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState("checking");
  const [error, setError] = useState("");
  const [attempts, setAttempts] = useState(0);
  const timerRef = useRef(null);

  const paymentId = searchParams.get("paymentId");

  const check = async () => {
    if (!paymentId) {
      setStatus("error");
      setError("Payment ID missing");
      return;
    }

    try {
      const token = localStorage.getItem("token");
      const res = await fetch(
        `${API_BASE}/billing/yookassa/payment-status?paymentId=${encodeURIComponent(paymentId)}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );
      const data = await res.json();
      if (!res.ok) {
        setStatus("error");
        setError(data.message || "Payment check failed");
        return;
      }
      if (data.status === "succeeded" && data.paid) {
        setStatus("success");
        if (timerRef.current) {
          clearInterval(timerRef.current);
        }
        setTimeout(() => navigate("/dashboard"), 1500);
      } else if (data.status === "canceled") {
        setStatus("error");
        setError("Payment was canceled");
        if (timerRef.current) {
          clearInterval(timerRef.current);
        }
      } else {
        setStatus("pending");
      }
    } catch (err) {
      console.error("payment status error:", err);
      setStatus("error");
      setError("Payment check failed");
    }
  };

  useEffect(() => {
    if (!paymentId) {
      setStatus("error");
      setError("Payment ID missing");
      return;
    }

    check();
    timerRef.current = setInterval(() => {
      setAttempts((prev) => prev + 1);
      check();
    }, 5000);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [navigate, paymentId]);

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Subscription</h1>
        <p className="page-subtitle">Checking payment status...</p>
      </div>

      <div className="card">
        {status === "checking" && <div>Checking payment...</div>}
        {status === "pending" && (
          <div>
            Payment is still processing. We will keep checking for a while.
          </div>
        )}
        {status === "success" && <div>Payment succeeded. Redirecting...</div>}
        {status === "error" && <div>{error}</div>}
        {status !== "success" && paymentId && (
          <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
            <button className="btn" onClick={check}>
              Refresh status
            </button>
            <div style={{ fontSize: 12, color: "#6b7280", alignSelf: "center" }}>
              checks: {attempts}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
