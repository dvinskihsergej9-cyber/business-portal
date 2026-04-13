import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { apiFetch, normalizeErrorMessage } from "../apiConfig";
import { useAuth } from "../context/AuthContext";

function getPaymentStatusLabel(status, paid) {
  if (paid || status === "succeeded") return "Оплата прошла успешно.";
  if (status === "pending") return "Платеж ожидает подтверждения.";
  if (status === "waiting_for_capture") {
    return "Платеж авторизован, ожидается подтверждение.";
  }
  if (status === "canceled") return "Платеж отменен.";
  return `Статус платежа: ${status || "unknown"}`;
}

export default function SubscribeReturn() {
  const [params] = useSearchParams();
  const paymentId = params.get("paymentId") || "";
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("");
  const [paid, setPaid] = useState(false);
  const [error, setError] = useState("");
  const { refreshUser } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    const checkStatus = async () => {
      if (!paymentId) {
        setError("Не указан идентификатор платежа.");
        setLoading(false);
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
          setError(
            normalizeErrorMessage(data?.message || "", "Не удалось проверить статус оплаты.")
          );
          setLoading(false);
          return;
        }

        setStatus(data.status || "pending");
        setPaid(Boolean(data.paid));
        await refreshUser();
        setLoading(false);
      } catch (err) {
        console.error("payment status error:", err);
        setError("Ошибка проверки оплаты.");
        setLoading(false);
      }
    };

    checkStatus();
  }, [paymentId, refreshUser]);

  const handleContinue = () => {
    navigate("/warehouse");
  };

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Статус оплаты</h1>
        <p className="page-subtitle">Проверяем результат платежа.</p>
      </div>

      {loading && <div className="card">Проверяем оплату...</div>}

      {!loading && error && (
        <div className="card" style={{ borderColor: "#ef4444", color: "#b91c1c" }}>
          {error}
        </div>
      )}

      {!loading && !error && (
        <div className="card" style={{ display: "grid", gap: 8 }}>
          <div>{getPaymentStatusLabel(status, paid)}</div>
          <button className="btn primary" onClick={handleContinue}>
            Продолжить
          </button>
        </div>
      )}
    </div>
  );
}