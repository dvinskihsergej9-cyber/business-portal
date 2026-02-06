import { useEffect, useMemo, useState } from "react";
import { API_BASE } from "../../apiConfig";
import TsdHeader from "./TsdHeader";

function OrderLineCard({ line, onConfirm, loading }) {
  const [qty, setQty] = useState(line.qty);

  useEffect(() => {
    setQty(line.qty);
  }, [line.qty]);

  return (
    <div className="tsd-card">
      <div className="tsd-card__body">
        <div className="tsd-card__title">{line.itemName}</div>
        <div className="tsd-card__meta">
          {line.sku ? `SKU: ${line.sku}` : "SKU: -"}
        </div>
        <div className="tsd-card__meta">
          Ячейка: {line.locationCode || line.locationName || `#${line.locationId}`}
        </div>
        <div className="tsd-card__meta">К отбору: {line.qty}</div>
      </div>
      <div className="tsd-inline">
        <input
          className="tsd-input"
          type="number"
          min="1"
          value={qty}
          onChange={(event) => setQty(event.target.value)}
          disabled={loading}
        />
        <button
          type="button"
          className="tsd-btn tsd-btn--primary"
          disabled={loading}
          onClick={() =>
            onConfirm({
              lineId: line.lineId,
              locationId: line.locationId,
              qty: Number(qty) || 0,
            })
          }
        >
          Подтвердить
        </button>
      </div>
    </div>
  );
}

export default function OrderFulfillmentFlow({ authHeaders, onBack }) {
  const [mineOnly, setMineOnly] = useState(false);
  const [orders, setOrders] = useState([]);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [pickPlan, setPickPlan] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [boxCode, setBoxCode] = useState("");
  const [boxType, setBoxType] = useState("");

  const normalizeError = (err, fallback) => {
    const message = String(err?.message || "").trim();
    if (!message) return fallback;
    if (message.toLowerCase().includes("failed to fetch")) {
      return "Не удалось подключиться к серверу.";
    }
    if (message.toLowerCase().includes("string did not match")) {
      return "Некорректный адрес сервера.";
    }
    return message;
  };

  const canPack = useMemo(() => pickPlan.length === 0, [pickPlan.length]);

  const loadQueue = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(
        `${API_BASE}/orders/queue?mine=${mineOnly ? "1" : "0"}`,
        { headers: authHeaders }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Не удалось загрузить заказы");
      setOrders(data.items || []);
    } catch (err) {
      setError(normalizeError(err, "Ошибка загрузки очереди заказов."));
    } finally {
      setLoading(false);
    }
  };

  const loadPickPlan = async (orderId) => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${API_BASE}/orders/${orderId}/pick-plan`, {
        headers: authHeaders,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Не удалось построить маршрут");

      const flat = [];
      for (const item of data.items || []) {
        for (const step of item.steps || []) {
          flat.push({
            lineId: item.lineId,
            itemName: item.itemName,
            sku: item.sku,
            locationId: step.locationId,
            locationCode: step.locationCode,
            locationName: step.locationName,
            qty: step.qty,
          });
        }
      }
      setPickPlan(flat);
    } catch (err) {
      setError(normalizeError(err, "Ошибка построения маршрута отбора."));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mineOnly]);

  const takeOrder = async (orderId) => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${API_BASE}/orders/${orderId}/take`, {
        method: "POST",
        headers: authHeaders,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Не удалось взять заказ");
      setSelectedOrder(data.order);
      await loadPickPlan(orderId);
      await loadQueue();
    } catch (err) {
      setError(normalizeError(err, "Ошибка при взятии заказа."));
    } finally {
      setLoading(false);
    }
  };

  const confirmPick = async ({ lineId, locationId, qty }) => {
    if (!selectedOrder) return;
    if (!qty || qty <= 0) {
      setError("Укажите количество больше 0");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${API_BASE}/orders/${selectedOrder.id}/pick-confirm`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ lineId, locationId, qty }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Ошибка подтверждения отбора");
      setSelectedOrder(data.order);
      await loadPickPlan(selectedOrder.id);
      await loadQueue();
    } catch (err) {
      setError(normalizeError(err, "Ошибка подтверждения отбора."));
    } finally {
      setLoading(false);
    }
  };

  const packOrder = async () => {
    if (!selectedOrder) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${API_BASE}/orders/${selectedOrder.id}/pack`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          boxCode,
          boxType,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Ошибка упаковки");
      setSelectedOrder(data.order);
      await loadQueue();
    } catch (err) {
      setError(normalizeError(err, "Ошибка упаковки заказа."));
    } finally {
      setLoading(false);
    }
  };

  const printLabel = async () => {
    if (!selectedOrder) return;
    const res = await fetch(`${API_BASE}/orders/${selectedOrder.id}/label`, {
      headers: authHeaders,
    });
    if (!res.ok) {
      const data = await res.json();
      setError(data.message || "Ошибка печати этикетки.");
      return;
    }
    const html = await res.text();
    const win = window.open("", "_blank");
    if (win) {
      win.document.write(html);
      win.document.close();
    }
  };

  const completeOrder = async () => {
    if (!selectedOrder) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${API_BASE}/orders/${selectedOrder.id}/complete`, {
        method: "POST",
        headers: authHeaders,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Ошибка завершения заказа");
      setSelectedOrder(data.order);
      await loadQueue();
    } catch (err) {
      setError(normalizeError(err, "Ошибка завершения заказа."));
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <TsdHeader
        title="Заказы"
        subtitle="Сборка, упаковка, печать этикетки"
        contextLabel="Режим"
        contextValue={mineOnly ? "Мои" : "Общий"}
        onBack={onBack}
      />
      <div className="tsd-section">
        {error && <div className="tsd-alert tsd-alert--error">{error}</div>}
        <div className="tsd-inline">
          <button
            type="button"
            className="tsd-btn tsd-btn--ghost"
            onClick={() => setMineOnly(false)}
            disabled={loading}
          >
            Общая очередь
          </button>
          <button
            type="button"
            className="tsd-btn tsd-btn--ghost"
            onClick={() => setMineOnly(true)}
            disabled={loading}
          >
            Мои заказы
          </button>
          <button
            type="button"
            className="tsd-btn tsd-btn--secondary"
            onClick={loadQueue}
            disabled={loading}
          >
            Обновить
          </button>
        </div>

        {!selectedOrder && (
          <div className="tsd-list">
            {(orders || []).map((order) => (
              <div className="tsd-card" key={order.id}>
                <div className="tsd-card__body">
                  <div className="tsd-card__title">
                    {order.orderNumber} ({order.status})
                  </div>
                  <div className="tsd-card__meta">{order.customerName}</div>
                  <div className="tsd-card__meta">{order.shippingAddress}</div>
                </div>
                <div className="tsd-action-inline">
                  <button
                    type="button"
                    className="tsd-btn tsd-btn--primary"
                    disabled={loading}
                    onClick={() => takeOrder(order.id)}
                  >
                    Взять задание
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {selectedOrder && (
          <>
            <div className="tsd-card">
              <div className="tsd-card__body">
                <div className="tsd-card__title">
                  {selectedOrder.orderNumber} ({selectedOrder.status})
                </div>
                <div className="tsd-card__meta">
                  Получатель: {selectedOrder.customerName}
                </div>
                <div className="tsd-card__meta">
                  Адрес: {selectedOrder.shippingAddress}
                </div>
                <div className="tsd-card__meta">
                  Телефон: {selectedOrder.customerPhone || "-"}
                </div>
              </div>
              <div className="tsd-action-inline">
                <button
                  type="button"
                  className="tsd-btn tsd-btn--secondary"
                  onClick={() => {
                    setSelectedOrder(null);
                    setPickPlan([]);
                    setError("");
                  }}
                >
                  К списку
                </button>
              </div>
            </div>

            <div className="tsd-card">
              <div className="tsd-card__body">
                <div className="tsd-card__title">Маршрут отбора</div>
                <div className="tsd-card__meta">
                  Шагов: {pickPlan.length}
                </div>
              </div>
            </div>

            <div className="tsd-list">
              {pickPlan.map((line, idx) => (
                <OrderLineCard
                  key={`${line.lineId}-${line.locationId}-${idx}`}
                  line={line}
                  onConfirm={confirmPick}
                  loading={loading}
                />
              ))}
            </div>

            {canPack && (
              <div className="tsd-card">
                <div className="tsd-card__body">
                  <div className="tsd-card__title">Упаковка</div>
                </div>
                <input
                  className="tsd-input"
                  placeholder="Номер коробки"
                  value={boxCode}
                  onChange={(event) => setBoxCode(event.target.value)}
                />
                <input
                  className="tsd-input"
                  placeholder="Тип коробки"
                  value={boxType}
                  onChange={(event) => setBoxType(event.target.value)}
                />
                <div className="tsd-inline">
                  <button
                    type="button"
                    className="tsd-btn tsd-btn--primary"
                    disabled={loading}
                    onClick={packOrder}
                  >
                    Упаковать
                  </button>
                  <button
                    type="button"
                    className="tsd-btn tsd-btn--secondary"
                    disabled={loading}
                    onClick={printLabel}
                  >
                    Печать этикетки
                  </button>
                  <button
                    type="button"
                    className="tsd-btn tsd-btn--primary"
                    disabled={loading}
                    onClick={completeOrder}
                  >
                    Завершить заказ
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
