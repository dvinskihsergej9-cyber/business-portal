import { useEffect, useRef, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { apiFetch } from "../apiConfig";

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
      setError("Не указан идентификатор платежа");
      return;
    }

    try {
      const token = localStorage.getItem("token");
      const res = await apiFetch(
        `/billing/yookassa/payment-status?paymentId=${encodeURIComponent(paymentId)}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );
      const data = await res.json();
      if (!res.ok) {
        setStatus("error");
        setError(data.message || "Не удалось проверить статус платежа");
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
        setError("Платёж был отменён");
        if (timerRef.current) {
          clearInterval(timerRef.current);
        }
      } else {
        setStatus("pending");
      }
    } catch (err) {
      console.error("payment status error:", err);
      setStatus("error");
      setError("Не удалось проверить статус платежа");
    }
  };

  useEffect(() => {
    if (!paymentId) {
      setStatus("error");
      setError("Не указан идентификатор платежа");
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
        <h1 className="page-title">Подписка</h1>
        <p className="page-subtitle">Проверяем статус платежа...</p>
      </div>

      <div className="card">
        {status === "checking" && <div>Проверяем платёж...</div>}
        {status === "pending" && (
          <div>
            Платёж всё ещё обрабатывается. Мы продолжим проверку.
          </div>
        )}
        {status === "success" && <div>Платёж успешен. Перенаправляем...</div>}
        {status === "error" && <div>{error}</div>}
        {status !== "success" && paymentId && (
          <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
            <button className="btn" onClick={check}>
              Обновить статус
            </button>
            <div style={{ fontSize: 12, color: "#6b7280", alignSelf: "center" }}>
              проверок: {attempts}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
