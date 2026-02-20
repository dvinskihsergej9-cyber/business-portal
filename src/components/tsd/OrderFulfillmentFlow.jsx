import { useEffect, useMemo, useState } from "react";
import { API_BASE, normalizeErrorMessage } from "../../apiConfig";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { ARIAL_TTF_BASE64 } from "../../utils/arialFontBase64";
import TsdHeader from "./TsdHeader";
import Scanner from "./Scanner";
import TsdErrorAlert from "./TsdErrorAlert";

const normalizeScan = (value) => String(value || "").trim().toLowerCase();
const toNum = (value) => Number(value) || 0;

const readJsonSafe = async (res) => {
  try {
    return await res.json();
  } catch {
    return null;
  }
};

const ensurePdfFont = async (pdf) => {
  pdf.addFileToVFS("Arial.ttf", ARIAL_TTF_BASE64);
  pdf.addFont("Arial.ttf", "Arial", "normal", "Identity-H");
  pdf.setFont("Arial", "normal");
};

const formatDateTime = (value) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("ru-RU");
};

const ORDER_STATUS_LABELS = {
  NEW: "Новый",
  IN_PICKING: "В отборе",
  PICKED: "Отобран",
  PACKED: "Упакован",
  READY_TO_SHIP: "Готов к отгрузке",
  SHIPPED: "Отгружен",
  CANCELLED: "Отменен",
};

const getOrderStatusLabel = (status) =>
  ORDER_STATUS_LABELS[String(status || "").trim()] || String(status || "-");

export default function OrderFulfillmentFlow({ authHeaders, onBack }) {
  const [mineOnly, setMineOnly] = useState(false);
  const [orders, setOrders] = useState([]);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [pickPlan, setPickPlan] = useState([]);
  const [pickPlanRaw, setPickPlanRaw] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [locationScanned, setLocationScanned] = useState(false);
  const [scannedQty, setScannedQty] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const currentStep = pickPlan[currentIndex] || null;
  const orderStatus = String(selectedOrder?.status || "");
  const allLinesPicked = useMemo(
    () =>
      Boolean(selectedOrder?.lines?.length) &&
      selectedOrder.lines.every((line) => toNum(line.pickedQty) >= toNum(line.qty)),
    [selectedOrder]
  );
  const canFinalize = useMemo(
    () =>
      Boolean(selectedOrder) &&
      (["PICKED", "PACKED"].includes(orderStatus) || allLinesPicked),
    [allLinesPicked, orderStatus, selectedOrder]
  );
  const isClosed = useMemo(
    () => ["READY_TO_SHIP", "SHIPPED", "CANCELLED"].includes(orderStatus),
    [orderStatus]
  );
  const canPrintPassport = useMemo(
    () => Boolean(selectedOrder) && (canFinalize || isClosed),
    [canFinalize, isClosed, selectedOrder]
  );
  const canComplete = useMemo(
    () => Boolean(selectedOrder) && canFinalize,
    [canFinalize, selectedOrder]
  );
  const hasPlan = pickPlan.length > 0;
  const unresolvedItems = useMemo(
    () =>
      (pickPlanRaw || []).filter(
        (line) => toNum(line.remainingQty) > 0 && (!Array.isArray(line.steps) || line.steps.length === 0)
      ),
    [pickPlanRaw]
  );
  const showPlanMissing = selectedOrder && !canFinalize && !isClosed && pickPlan.length === 0;

  const loadQueue = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(
        `${API_BASE}/orders/queue?mine=${mineOnly ? "1" : "0"}`,
        { headers: authHeaders }
      );
      const data = await readJsonSafe(res);
      if (!res.ok) throw new Error(data?.message || "Не удалось загрузить заказы");
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
    setPickPlan([]);
    setPickPlanRaw([]);
    setCurrentIndex(0);
    setLocationScanned(false);
    setScannedQty(0);
    try {
      const res = await fetch(`${API_BASE}/orders/${orderId}/pick-plan`, {
        headers: authHeaders,
      });
      const data = await readJsonSafe(res);
      if (!res.ok) throw new Error(data?.message || "Не удалось построить маршрут");

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
      setPickPlanRaw(data.items || []);
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
      const data = await readJsonSafe(res);
      if (!res.ok) {
        if (res.status === 409) {
          await loadQueue();
          throw new Error(data?.message || "Заказ уже взят другим сотрудником.");
        }
        throw new Error(data?.message || "Не удалось взять заказ");
      }
      setSelectedOrder(data.order);
      await loadPickPlan(orderId);
      await loadQueue();
    } catch (err) {
      setError(normalizeErrorMessage(err, "Ошибка при взятии заказа."));
    } finally {
      setLoading(false);
    }
  };

  const releaseOrder = async (orderId) => {
    const res = await fetch(`${API_BASE}/orders/${orderId}/release`, {
      method: "POST",
      headers: authHeaders,
    });
    const data = await readJsonSafe(res);
    if (!res.ok) {
      throw new Error(data?.message || "Не удалось вернуть заказ в очередь");
    }
    return data?.order || null;
  };

  const resetSelection = () => {
    setSelectedOrder(null);
    setPickPlan([]);
    setPickPlanRaw([]);
    setCurrentIndex(0);
    setLocationScanned(false);
    setScannedQty(0);
  };

  const leaveSelectedOrder = async (navigateBack = false) => {
    if (!selectedOrder) {
      if (navigateBack) onBack?.();
      return;
    }

    setLoading(true);
    setError("");
    try {
      await releaseOrder(selectedOrder.id);
      resetSelection();
      await loadQueue();
      if (navigateBack) onBack?.();
    } catch (err) {
      setError(normalizeErrorMessage(err, "Ошибка при возврате заказа в очередь."));
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
      const data = await readJsonSafe(res);
      if (!res.ok) throw new Error(data?.message || "Ошибка подтверждения отбора");
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

  const printPassport = async () => {
    if (!selectedOrder) return;
    if (!canPrintPassport) {
      setError("Сначала завершите отбор товара.");
      return;
    }
    try {
      const order = selectedOrder;
      const pdf = new jsPDF("p", "pt", "a4");
      await ensurePdfFont(pdf);
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 28;
      const contentWidth = pageWidth - margin * 2;

      pdf.setDrawColor(28, 35, 64);
      pdf.setLineWidth(1.3);
      pdf.rect(margin, margin, contentWidth, pageHeight - margin * 2);

      pdf.setFillColor(241, 246, 255);
      pdf.rect(margin + 10, margin + 10, contentWidth - 20, 96, "F");

      pdf.setTextColor(11, 18, 42);
      pdf.setFontSize(25);
      pdf.text(`Паспорт заказа ${order.orderNumber || "-"}`, margin + 20, margin + 44);
      pdf.setFontSize(13);
      pdf.text(`Дата: ${formatDateTime(order.createdAt)}`, margin + 20, margin + 68);
      pdf.text(`Статус: ${getOrderStatusLabel(order.status)}`, margin + 20, margin + 88);

      let y = margin + 132;
      pdf.setFontSize(15);
      pdf.text(`Получатель: ${order.customerName || "-"}`, margin + 20, y);
      y += 22;
      pdf.text(`Телефон: ${order.customerPhone || "-"}`, margin + 20, y);
      y += 22;

      const addressLines = pdf.splitTextToSize(
        `Адрес: ${order.shippingAddress || "-"}`,
        contentWidth - 40
      );
      pdf.text(addressLines, margin + 20, y);
      y += addressLines.length * 17 + 4;

      const commentLines = pdf.splitTextToSize(
        `Комментарий: ${order.deliveryComment || "-"}`,
        contentWidth - 40
      );
      pdf.text(commentLines, margin + 20, y);
      y += commentLines.length * 17 + 14;

      const rows = (order.lines || []).map((line, index) => [
        String(index + 1),
        line.item?.sku || line.requestedSku || "-",
        line.item?.name || line.requestedName || "-",
        String(toNum(line.qty)),
        String(toNum(line.pickedQty)),
        line.item?.unit || "шт",
      ]);

      autoTable(pdf, {
        startY: y,
        margin: { left: margin + 10, right: margin + 10 },
        head: [["#", "SKU", "Товар", "Заказано", "Отобрано", "Ед."]],
        body: rows.length ? rows : [["-", "-", "Нет позиций", "-", "-", "-"]],
        theme: "grid",
        styles: {
          font: "Arial",
          fontSize: 12,
          cellPadding: 6,
          minCellHeight: 24,
          overflow: "linebreak",
          valign: "top",
        },
        headStyles: {
          fillColor: [225, 234, 248],
          textColor: [15, 23, 42],
          fontStyle: "bold",
          font: "Arial",
          fontSize: 12,
        },
        columnStyles: {
          0: { cellWidth: 34 },
          1: { cellWidth: 88 },
          2: { cellWidth: 206 },
          3: { cellWidth: 72, halign: "center" },
          4: { cellWidth: 72, halign: "center" },
          5: { cellWidth: 44, halign: "center" },
        },
      });

      const finalY = pdf.lastAutoTable?.finalY || y;
      const footerTop = Math.min(finalY + 16, pageHeight - 140);
      const footerHeight = pageHeight - margin - footerTop - 10;

      pdf.setFillColor(248, 250, 255);
      pdf.rect(margin + 10, footerTop, contentWidth - 20, footerHeight, "F");
      pdf.setDrawColor(188, 201, 224);
      pdf.rect(margin + 10, footerTop, contentWidth - 20, footerHeight);
      pdf.setTextColor(28, 35, 64);
      pdf.setFontSize(16);
      pdf.text("Наклейте этот паспорт на коробку заказа", margin + 20, footerTop + 30);
      pdf.setFontSize(18);
      pdf.text(`№ ${order.orderNumber || "-"}`, margin + 20, footerTop + 58);

      const blob = pdf.output("blob");
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.target = "_self";
      link.rel = "noopener noreferrer";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      setError(normalizeErrorMessage(err, "Ошибка формирования паспорта."));
    }
  };

  const completeOrder = async () => {
    if (!selectedOrder) return;
    if (!canComplete) {
      setError("Сначала завершите отбор товара.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${API_BASE}/orders/${selectedOrder.id}/complete`, {
        method: "POST",
        headers: authHeaders,
      });
      const data = await readJsonSafe(res);
      if (!res.ok) throw new Error(data?.message || "Ошибка завершения заказа");
      setSelectedOrder(null);
      setPickPlan([]);
      setPickPlanRaw([]);
      setCurrentIndex(0);
      setLocationScanned(false);
      setScannedQty(0);
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
        subtitle="Сборка, паспорт, завершение"
        contextLabel="Режим"
        contextValue={mineOnly ? "Мои" : "Общий"}
        onBack={() => leaveSelectedOrder(true)}
      />
      <div className="tsd-section">
        <TsdErrorAlert message={error} />
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
                    {order.orderNumber} ({getOrderStatusLabel(order.status)})
                  </div>
                  <div className="tsd-card__meta">{order.customerName}</div>
                  <div className="tsd-card__meta">{order.shippingAddress}</div>
                  <div className="tsd-card__meta">
                    {order.assignedToUser
                      ? `Исполнитель: ${order.assignedToUser.name || order.assignedToUser.email || "назначен"}`
                      : "Исполнитель: не назначен"}
                  </div>
                </div>
                <div className="tsd-action-inline">
                  <button
                    type="button"
                    className="tsd-btn tsd-btn--primary"
                    disabled={loading}
                    onClick={() => takeOrder(order.id)}
                  >
                    {["PICKED", "PACKED"].includes(String(order.status || ""))
                      ? "Открыть задание"
                      : "Взять задание"}
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
                  {selectedOrder.orderNumber} ({getOrderStatusLabel(selectedOrder.status)})
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
                    onClick={() => leaveSelectedOrder(false)}
                    disabled={loading}
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
              </div>
            )}

            {showPlanMissing && (
              <div className="tsd-alert tsd-alert--warning">
                Нет маршрута отбора. Проверьте, что у товаров есть ячейки и остатки.
              </div>
            )}
            {showPlanMissing && unresolvedItems.length > 0 && (
              <div className="tsd-alert tsd-alert--warning">
                Не хватает остатков по позициям:{" "}
                {unresolvedItems
                  .slice(0, 3)
                  .map((row) => row.itemName || row.sku || `Строка ${row.lineId}`)
                  .join(", ")}
                {unresolvedItems.length > 3 ? " и др." : ""}.
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

            {canPrintPassport && (
              <div className="tsd-card">
                <div className="tsd-card__body">
                  <div className="tsd-card__title">Паспорт и завершение</div>
                </div>
                <div className="tsd-inline">
                  <button
                    type="button"
                    className="tsd-btn tsd-btn--secondary"
                    disabled={loading || !canPrintPassport}
                    onClick={printPassport}
                  >
                    Паспорт (PDF)
                  </button>
                  {!isClosed && (
                    <button
                      type="button"
                      className="tsd-btn tsd-btn--primary"
                      disabled={loading || !canComplete}
                      onClick={completeOrder}
                    >
                      Завершить заказ
                    </button>
                  )}
                </div>
              </div>
            )}
            {!canFinalize && !isClosed && selectedOrder && (
              <div className="tsd-alert tsd-alert--info">
                Сначала выполните отбор. Паспорт и завершение станут доступны после статуса
                «Отобран».
              </div>
            )}
            {isClosed && selectedOrder && (
              <div className="tsd-alert tsd-alert--success">
                Заказ уже завершен.
              </div>
            )}

            {!hasPlan && !canFinalize && !isClosed && (
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
