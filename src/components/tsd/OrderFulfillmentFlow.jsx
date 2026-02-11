import { useEffect, useMemo, useState } from "react";
import { API_BASE, normalizeErrorMessage } from "../../apiConfig";
import TsdHeader from "./TsdHeader";
import Scanner from "./Scanner";

const normalizeScan = (value) => String(value || "").trim().toLowerCase();

export default function OrderFulfillmentFlow({ authHeaders, onBack }) {
  const [mineOnly, setMineOnly] = useState(false);
  const [orders, setOrders] = useState([]);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [pickPlan, setPickPlan] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [locationScanned, setLocationScanned] = useState(false);
  const [scannedQty, setScannedQty] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [boxCode, setBoxCode] = useState("");
  const [boxType, setBoxType] = useState("");

  const currentStep = pickPlan[currentIndex] || null;
  const canPack = useMemo(() => pickPlan.length === 0 && selectedOrder, [pickPlan.length, selectedOrder]);
  const hasPlan = pickPlan.length > 0;
  const showPlanMissing = selectedOrder && pickPlan.length === 0;

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
      setError(normalizeErrorMessage(err, "Ошибка загрузки очереди заказов."));
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
            itemId: item.itemId,
            itemName: item.itemName,
            sku: item.sku,
            barcode: item.barcode || null,
            locationId: step.locationId,
            locationCode: step.locationCode,
            locationName: step.locationName,
            qty: step.qty,
          });
        }
      }

      flat.sort((a, b) => {
        const codeA = String(a.locationCode || a.locationName || "");
        const codeB = String(b.locationCode || b.locationName || "");
        return codeA.localeCompare(codeB, "ru");
      });

      setPickPlan(flat);
      setCurrentIndex(0);
      setLocationScanned(false);
      setScannedQty(0);
    } catch (err) {
      setError(normalizeErrorMessage(err, "Ошибка построения маршрута отбора."));
    } finally {
      setLoading(false);
    }
  };

  const resolveScanEntity = async (code) => {
    try {
      const res = await fetch(
        `${API_BASE}/warehouse/scan/resolve?code=${encodeURIComponent(code)}`,
        { headers: authHeaders }
      );
      const data = await res.json().catch(() => null);
      if (!res.ok) return null;
      return data;
    } catch {
      return null;
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
      setError(normalizeErrorMessage(err, "Ошибка при взятии заказа."));
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
      setError(normalizeErrorMessage(err, "Ошибка подтверждения отбора."));
    } finally {
      setLoading(false);
    }
  };

  const handleLocationScan = async (value) => {
    if (!currentStep) return;
    const raw = String(value || "").trim();
    const scanned = normalizeScan(raw);
    const code = normalizeScan(currentStep.locationCode);
    const name = normalizeScan(currentStep.locationName);
    const idValue = String(currentStep.locationId || "");
    const locMatch = scanned.match(/^bp:(loc|location):(.*)$/i);
    const locPayload = locMatch ? normalizeScan(locMatch[2]) : "";
    const locPayloadId = locPayload && /^\d+$/.test(locPayload) ? locPayload : "";

    if (
      scanned === code ||
      scanned === name ||
      scanned === idValue ||
      (locPayload && (locPayload === code || locPayload === name)) ||
      (locPayloadId && locPayloadId === idValue)
    ) {
      setLocationScanned(true);
      setError("");
      return;
    }

    const resolved = await resolveScanEntity(raw);
    const entity = resolved?.entity || {};
    const resolvedId = String(entity.id || "");
    const resolvedCode = normalizeScan(entity.code);
    const resolvedName = normalizeScan(entity.name);
    if (
      resolved?.type === "location" &&
      (resolvedId === idValue ||
        (resolvedCode && resolvedCode === code) ||
        (resolvedName && resolvedName === name))
    ) {
      setLocationScanned(true);
      setError("");
      return;
    }

    setError("Скан не совпадает с ячейкой текущего шага.");
  };

  const handleItemScan = async (value) => {
    if (!currentStep) return;
    const raw = String(value || "").trim();
    const scanned = normalizeScan(raw);
    const sku = normalizeScan(currentStep.sku);
    const barcode = normalizeScan(currentStep.barcode);
    const itemIdValue = String(currentStep.itemId || "");
    const itemMatch = scanned.match(/^bp:(item|product|sku):(.*)$/i);
    const itemPayload = itemMatch ? normalizeScan(itemMatch[2]) : "";
    const itemPayloadId = itemPayload && /^\d+$/.test(itemPayload) ? itemPayload : "";

    const directMatch =
      scanned === sku ||
      scanned === barcode ||
      scanned === itemIdValue ||
      (itemPayload &&
        (itemPayload === sku || itemPayload === barcode || itemPayload === itemIdValue));

    if (!directMatch) {
      const resolved = await resolveScanEntity(raw);
      const entity = resolved?.entity || {};
      const resolvedItemId = String(entity.id || "");
      const resolvedSku = normalizeScan(entity.sku);
      const resolvedBarcode = normalizeScan(entity.barcode);
      const resolvedMatch =
        resolved?.type === "item" &&
        (resolvedItemId === itemIdValue ||
          (resolvedSku && resolvedSku === sku) ||
          (resolvedBarcode && resolvedBarcode === barcode));
      if (!resolvedMatch) {
        setError("Скан не совпадает с товаром текущего шага.");
        return;
      }
    }

    if (Number(currentStep.qty || 0) <= 0) {
      setError("Для шага отбора не задано количество.");
      return;
    }

    const nextQty = scannedQty + 1;
    setScannedQty(nextQty);
    setError("");

    if (nextQty >= Number(currentStep.qty || 0)) {
      await confirmPick({
        lineId: currentStep.lineId,
        locationId: currentStep.locationId,
        qty: Number(currentStep.qty || 0),
      });
      setLocationScanned(false);
      setScannedQty(0);
      setCurrentIndex(0);
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
      setError(normalizeErrorMessage(err, "Ошибка упаковки заказа."));
    } finally {
      setLoading(false);
    }
  };

  const printLabel = async () => {
    if (!selectedOrder) return;
    try {
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
    } catch (err) {
      setError(normalizeErrorMessage(err, "Ошибка печати этикетки."));
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
      setError(normalizeErrorMessage(err, "Ошибка завершения заказа."));
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

            {currentStep && (
              <div className="tsd-card">
                <div className="tsd-card__body">
                  <div className="tsd-card__title">Шаг {currentIndex + 1} из {pickPlan.length}</div>
                  <div className="tsd-card__meta">
                    Ячейка: {currentStep.locationCode || currentStep.locationName || `#${currentStep.locationId}`}
                  </div>
                  <div className="tsd-card__meta">Товар: {currentStep.itemName}</div>
                  <div className="tsd-card__meta">SKU: {currentStep.sku || "-"}</div>
                  <div className="tsd-card__meta">К отбору: {currentStep.qty}</div>
                  <div className="tsd-card__meta">Сканировано: {scannedQty}</div>
                </div>
                <div className="tsd-inline">
                  <button
                    type="button"
                    className="tsd-btn tsd-btn--ghost"
                    onClick={() => {
                      setLocationScanned(false);
                      setScannedQty(0);
                      setError("");
                    }}
                  >
                    Сбросить скан
                  </button>
                </div>
              </div>
            )}

            {showPlanMissing && (
              <div className="tsd-alert tsd-alert--warning">
                Нет маршрута отбора. Проверьте, что у товаров есть ячейки и остатки.
              </div>
            )}

            {currentStep && !locationScanned && (
              <Scanner
                label="Сканируй ячейку"
                hint={`Нужна ячейка: ${currentStep.locationCode || currentStep.locationName || currentStep.locationId}`}
                onScan={handleLocationScan}
                disabled={loading}
              />
            )}

            {currentStep && locationScanned && (
              <Scanner
                label="Сканируй товар"
                hint={`Нужно: ${currentStep.qty} шт. Сканировано: ${scannedQty}`}
                onScan={handleItemScan}
                disabled={loading}
              />
            )}

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
                    Паспорт (PDF)
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

            {!hasPlan && (
              <div className="tsd-inline">
                <button
                  type="button"
                  className="tsd-btn tsd-btn--secondary"
                  onClick={() => loadPickPlan(selectedOrder.id)}
                  disabled={loading}
                >
                  Обновить маршрут
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
