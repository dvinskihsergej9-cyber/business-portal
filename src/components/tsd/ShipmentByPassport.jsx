import { useMemo, useState } from "react";
import { API_BASE, normalizeErrorMessage } from "../../apiConfig";
import Scanner from "./Scanner";
import TsdErrorAlert from "./TsdErrorAlert";
import TsdHeader from "./TsdHeader";

const STATUS_LABELS = {
  NEW: "Новый",
  IN_PICKING: "В отборе",
  PICKED: "Отобран",
  PACKED: "Упакован",
  READY_TO_SHIP: "Готов к отгрузке",
  SHIPPED: "Отгружен",
  CANCELLED: "Отменен",
};

const getStatusLabel = (status) =>
  STATUS_LABELS[String(status || "").trim()] || String(status || "-");

const parseOrderIdFromScan = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const qrMatch = raw.match(/^bp:order:(\d+)$/i);
  if (qrMatch) {
    return Number(qrMatch[1]);
  }
  if (/^\d+$/.test(raw)) {
    return Number(raw);
  }
  return null;
};

const readJsonSafe = async (res) => {
  try {
    return await res.json();
  } catch {
    return null;
  }
};

export default function ShipmentByPassport({ authHeaders, onBack }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [order, setOrder] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [carrier, setCarrier] = useState("");
  const [trackingNumber, setTrackingNumber] = useState("");
  const [notes, setNotes] = useState("");

  const canSubmit = useMemo(
    () => Boolean(order) && String(order?.status || "") === "READY_TO_SHIP",
    [order]
  );

  const resetForm = () => {
    setCarrier("");
    setTrackingNumber("");
    setNotes("");
  };

  const loadOrderByScan = async (scanValue) => {
    const orderId = parseOrderIdFromScan(scanValue);
    if (!orderId || Number.isNaN(orderId)) {
      throw new Error("Неверный код. Используйте QR паспорта или ID заказа.");
    }

    const res = await fetch(`${API_BASE}/orders/${orderId}`, {
      headers: authHeaders,
    });
    const data = await readJsonSafe(res);
    if (!res.ok) {
      if (data?.message === "ORDER_NOT_FOUND") {
        throw new Error("Заказ не найден.");
      }
      throw new Error(data?.message || "Не удалось загрузить заказ.");
    }
    return data?.order || null;
  };

  const handleScan = async (scanValue) => {
    try {
      setLoading(true);
      setError("");
      setSuccess("");
      const nextOrder = await loadOrderByScan(scanValue);
      if (!nextOrder) {
        throw new Error("Заказ не найден.");
      }
      setOrder(nextOrder);

      const status = String(nextOrder.status || "");
      if (status === "READY_TO_SHIP") {
        setModalOpen(true);
        resetForm();
        return;
      }
      setModalOpen(false);
      if (status === "SHIPPED") {
        setSuccess(`Заказ ${nextOrder.orderNumber || `#${nextOrder.id}`} уже отгружен.`);
      } else {
        setError(
          `Заказ ${nextOrder.orderNumber || `#${nextOrder.id}`} не в статусе «Готов к отгрузке».`
        );
      }
    } catch (err) {
      setError(normalizeErrorMessage(err, "Ошибка обработки скана."));
      setModalOpen(false);
    } finally {
      setLoading(false);
    }
  };

  const submitShip = async (method) => {
    if (!order || !canSubmit) return;
    try {
      setLoading(true);
      setError("");
      setSuccess("");
      const payload = {
        method,
        carrier: String(carrier || "").trim(),
        trackingNumber: String(trackingNumber || "").trim(),
        notes: String(notes || "").trim(),
      };
      const res = await fetch(`${API_BASE}/orders/${order.id}/ship`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify(payload),
      });
      const data = await readJsonSafe(res);
      if (!res.ok) {
        if (data?.message === "ORDER_ALREADY_SHIPPED") {
          throw new Error("Заказ уже отгружен.");
        }
        if (data?.message === "ORDER_BAD_STATUS") {
          throw new Error("Заказ не в статусе «Готов к отгрузке».");
        }
        if (data?.message === "ORDER_NOT_FOUND") {
          throw new Error("Заказ не найден.");
        }
        throw new Error(data?.message || "Не удалось подтвердить отгрузку.");
      }

      const shippedOrder = data?.order || null;
      setOrder(shippedOrder);
      setModalOpen(false);
      setSuccess(`Отгружено: ${shippedOrder?.orderNumber || `#${order.id}`}.`);
      resetForm();
    } catch (err) {
      setError(normalizeErrorMessage(err, "Ошибка подтверждения отгрузки."));
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <TsdHeader
        title="Отгрузка"
        subtitle="Скан паспорта и подтверждение"
        contextLabel="Статус"
        contextValue={order ? getStatusLabel(order.status) : "Ожидание скана"}
        onBack={onBack}
      />

      <div className="tsd-section">
        <TsdErrorAlert message={error} />
        {success ? <div className="tsd-alert tsd-alert--success">{success}</div> : null}

        <Scanner
          label="Сканируй QR паспорта"
          hint="Ожидается код формата bp:order:<id>"
          manualPlaceholder="bp:order:123 или ID заказа"
          onScan={handleScan}
          disabled={loading}
          scanKind="qr"
        />

        {order ? (
          <div className="tsd-card">
            <div className="tsd-card__body">
              <div className="tsd-card__title">{order.orderNumber || `Заказ #${order.id}`}</div>
              <div className="tsd-card__meta">Статус: {getStatusLabel(order.status)}</div>
              <div className="tsd-card__meta">Получатель: {order.customerName || "-"}</div>
              <div className="tsd-card__meta">Адрес: {order.shippingAddress || "-"}</div>
              {order.shippedAt ? (
                <div className="tsd-card__meta">
                  Уже отгружен: {new Date(order.shippedAt).toLocaleString("ru-RU")}
                </div>
              ) : null}
            </div>
            <div className="tsd-action-inline">
              <button
                type="button"
                className="tsd-btn tsd-btn--ghost"
                onClick={() => {
                  setOrder(null);
                  setModalOpen(false);
                  setError("");
                  setSuccess("");
                  resetForm();
                }}
                disabled={loading}
              >
                Очистить
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {modalOpen ? (
        <div className="tsd-modal" role="dialog" aria-modal="true">
          <div className="tsd-modal__card">
            <div className="tsd-modal__title">Подтверждение отгрузки</div>
            <div className="tsd-modal__text">
              Подтвердить или пропустить ввод данных. В обоих вариантах заказ будет отгружен.
            </div>

            <div className="tsd-modal__row">
              <label className="tsd-modal__label">Перевозчик (необязательно)</label>
              <input
                className="tsd-input"
                value={carrier}
                onChange={(event) => setCarrier(event.target.value)}
                placeholder="Например: СДЭК"
                disabled={loading}
              />
            </div>
            <div className="tsd-modal__row">
              <label className="tsd-modal__label">Трек-номер (необязательно)</label>
              <input
                className="tsd-input"
                value={trackingNumber}
                onChange={(event) => setTrackingNumber(event.target.value)}
                placeholder="Например: 123456789"
                disabled={loading}
              />
            </div>
            <div className="tsd-modal__row">
              <label className="tsd-modal__label">Комментарий (необязательно)</label>
              <textarea
                className="tsd-input"
                rows={3}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Комментарий к отгрузке"
                disabled={loading}
              />
            </div>

            <div className="tsd-modal__actions">
              <button
                type="button"
                className="tsd-btn tsd-btn--ghost"
                onClick={() => setModalOpen(false)}
                disabled={loading}
              >
                Отмена
              </button>
              <button
                type="button"
                className="tsd-btn tsd-btn--secondary"
                onClick={() => submitShip("SKIP")}
                disabled={loading || !canSubmit}
              >
                Пропустить
              </button>
              <button
                type="button"
                className="tsd-btn tsd-btn--primary"
                onClick={() => submitShip("CONFIRM")}
                disabled={loading || !canSubmit}
              >
                Подтвердить
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

