import { useEffect, useMemo, useState } from "react";
import { API_BASE, normalizeErrorMessage } from "../../apiConfig";
import { useCallback } from "react";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import QRCode from "qrcode";
import { ARIAL_TTF_BASE64 } from "../../utils/arialFontBase64";
import { openBlobInNewTab, prepareDocumentTab } from "../../utils/openInNewTab";
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

const ORDER_EVENT_LABELS = {
  COMPLETE: "Завершение отбора",
  SHIP: "Отгрузка",
};

const getOrderStatusLabel = (status) =>
  ORDER_STATUS_LABELS[String(status || "").trim()] || String(status || "-");
const getOrderEventLabel = (eventType) =>
  ORDER_EVENT_LABELS[String(eventType || "").trim()] || String(eventType || "-");

const makePassportFileName = (order) => {
  const safeOrderNumber = String(order?.orderNumber || "без-номера")
    .trim()
    .replace(/[^\p{L}\p{N}_-]+/gu, "_");
  return `pasport-zakaza-${safeOrderNumber}.pdf`;
};

const SKIP_REASON_OPTIONS = [
  "Товар поврежден",
  "Ячейка недоступна",
  "Товар не найден",
  "Нужна проверка администратора",
  "Другое",
];
const PICKING_MODE_SCAN_EACH = "SCAN_EACH";
const PICKING_MODE_MANUAL_QTY = "MANUAL_QTY";

const makeStepKey = (step) =>
  [
    String(step?.lineId || ""),
    String(step?.locationId || ""),
    String(step?.itemId || ""),
  ].join(":");

const buildSkippedStepList = (items, planSteps) => {
  const flatPlan = Array.isArray(planSteps) ? planSteps : [];
  const planByKey = new Map(flatPlan.map((step) => [makeStepKey(step), step]));

  const findStep = (row, stepKey) => {
    const exact = planByKey.get(stepKey);
    if (exact) return exact;
    return (
      flatPlan.find((step) => {
        const sameLine = Number(step.lineId) === Number(row?.lineId);
        const sameLocation =
          row?.locationId == null || Number(step.locationId) === Number(row.locationId);
        const sameItem =
          row?.itemId == null || Number(step.itemId) === Number(row.itemId);
        return sameLine && sameLocation && sameItem;
      }) || null
    );
  };

  return (items || []).map((row) => {
    const stepKey = makeStepKey({
      lineId: row?.lineId,
      locationId: row?.locationId,
      itemId: row?.itemId,
    });
    const step = findStep(row, stepKey);
    return {
      id: row?.id || null,
      stepKey,
      lineId: row?.lineId || step?.lineId || null,
      itemId: row?.itemId || step?.itemId || null,
      itemName:
        step?.itemName ||
        row?.item?.name ||
        (row?.itemId ? `Товар #${row.itemId}` : "Товар не указан"),
      sku: step?.sku || row?.item?.sku || null,
      locationId: row?.locationId || step?.locationId || null,
      locationCode:
        step?.locationCode ||
        step?.locationName ||
        row?.location?.code ||
        row?.location?.name ||
        (row?.locationId ? `Ячейка #${row.locationId}` : "Ячейка не указана"),
      qty: Number(row?.qty || step?.qty || 0),
      reason: String(row?.reason || "").trim(),
      comment: String(row?.comment || "").trim(),
      createdAt: row?.createdAt || null,
    };
  });
};

const getShortageReasonLabel = (row) => {
  const reason = String(row?.shortageReason || "").trim().toUpperCase();
  if (reason === "HELD_STOCK") {
    const held = toNum(row?.heldQty);
    return held > 0
      ? `остаток заблокирован (${held} шт.)`
      : "остаток заблокирован";
  }
  if (reason === "HOLDS_CALC_ERROR") return "временная ошибка расчета блокировок";
  if (reason === "BALANCE_SOURCE_ERROR") return "ошибка чтения остатков";
  if (reason === "ITEM_NOT_LINKED") return "позиция не связана с номенклатурой";
  if (reason === "NO_STOCK_ON_HAND") return "на складе нет остатка";
  if (reason === "PLAN_BUILD_ERROR") return "ошибка расчета маршрута";
  return "не хватает доступного остатка";
};

export default function OrderFulfillmentFlow({
  authHeaders,
  onBack,
  showInternalBack = true,
}) {
  const [mineOnly, setMineOnly] = useState(false);
  const [orders, setOrders] = useState([]);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [pickPlan, setPickPlan] = useState([]);
  const [pickPlanRaw, setPickPlanRaw] = useState([]);
  const [skippedSteps, setSkippedSteps] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [locationScanned, setLocationScanned] = useState(false);
  const [scannedQty, setScannedQty] = useState(0);
  const [manualPickQty, setManualPickQty] = useState("");
  const [pickingMode, setPickingMode] = useState(PICKING_MODE_SCAN_EACH);
  const [skipModalOpen, setSkipModalOpen] = useState(false);
  const [skipReason, setSkipReason] = useState(SKIP_REASON_OPTIONS[0]);
  const [skipComment, setSkipComment] = useState("");
  const [previewImage, setPreviewImage] = useState(null);
  const [statusHistory, setStatusHistory] = useState([]);
  const [statusHistoryLoading, setStatusHistoryLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const skippedStepKeys = useMemo(
    () => new Set((skippedSteps || []).map((row) => row.stepKey)),
    [skippedSteps]
  );
  const activePickPlan = useMemo(
    () => (pickPlan || []).filter((step) => !skippedStepKeys.has(makeStepKey(step))),
    [pickPlan, skippedStepKeys]
  );
  const currentStep = activePickPlan[currentIndex] || null;
  const itemImageById = useMemo(() => {
    const map = new Map();
    for (const line of selectedOrder?.lines || []) {
      const itemId = Number(line?.item?.id || line?.itemId);
      if (!itemId) continue;
      const url = String(line?.item?.imageUrl || "").trim();
      if (url) map.set(itemId, url);
    }
    return map;
  }, [selectedOrder]);
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
  const hasPlan = activePickPlan.length > 0;
  const unresolvedItems = useMemo(
    () =>
      (pickPlanRaw || []).filter(
        (line) => toNum(line.remainingQty) > 0 && (!Array.isArray(line.steps) || line.steps.length === 0)
      ),
    [pickPlanRaw]
  );
  const showPlanMissing =
    selectedOrder &&
    !canFinalize &&
    !isClosed &&
    activePickPlan.length === 0 &&
    skippedSteps.length === 0;
  const isManualPickingMode = pickingMode === PICKING_MODE_MANUAL_QTY;

  const loadPickingMode = async () => {
    try {
      const res = await fetch(`${API_BASE}/settings/picking-mode`, {
        headers: authHeaders,
      });
      const data = await readJsonSafe(res);
      if (!res.ok) return;
      const mode = String(data?.mode || "").trim().toUpperCase();
      setPickingMode(
        mode === PICKING_MODE_MANUAL_QTY
          ? PICKING_MODE_MANUAL_QTY
          : PICKING_MODE_SCAN_EACH
      );
    } catch {
      setPickingMode(PICKING_MODE_SCAN_EACH);
    }
  };

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

  const loadStatusHistory = async (orderId) => {
    if (!orderId) return;
    setStatusHistoryLoading(true);
    try {
      const res = await fetch(`${API_BASE}/orders/${orderId}/status-history`, {
        headers: authHeaders,
      });
      const data = await readJsonSafe(res);
      if (!res.ok) {
        throw new Error(data?.message || "Не удалось загрузить историю статусов.");
      }
      setStatusHistory(Array.isArray(data?.items) ? data.items : []);
    } catch (err) {
      setStatusHistory([]);
      setError(normalizeErrorMessage(err, "Ошибка загрузки истории статусов."));
    } finally {
      setStatusHistoryLoading(false);
    }
  };

  const loadCurrentOrder = async (orderId) => {
    if (!orderId) return null;
    const res = await fetch(`${API_BASE}/orders/${orderId}/current`, {
      headers: authHeaders,
    });
    const data = await readJsonSafe(res);
    if (!res.ok) {
      throw new Error(data?.message || "Не удалось обновить данные заказа.");
    }
    return data?.order || null;
  };

  const loadPickPlan = async (orderId) => {
    setLoading(true);
    setError("");
    setPickPlan([]);
    setPickPlanRaw([]);
    setCurrentIndex(0);
    setLocationScanned(false);
    setScannedQty(0);
    setManualPickQty("");
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
      setManualPickQty("");
      try {
        await loadPickSkips(orderId, flat);
      } catch (skipErr) {
        setSkippedSteps([]);
        setError(normalizeErrorMessage(skipErr, "Ошибка загрузки пропусков отбора."));
      }
    } catch (err) {
      setError(normalizeErrorMessage(err, "Ошибка построения маршрута отбора."));
    } finally {
      setLoading(false);
    }
  };

  const loadPickSkips = async (orderId, planSteps) => {
    const res = await fetch(`${API_BASE}/orders/${orderId}/pick-skips`, {
      headers: authHeaders,
    });
    const data = await readJsonSafe(res);
    if (!res.ok) {
      throw new Error(data?.message || "Не удалось загрузить пропуски отбора");
    }
    setSkippedSteps(buildSkippedStepList(data?.items || [], planSteps || pickPlan));
  };

  const resolveScanEntity = async (code, options = {}) => {
    const strict = Boolean(options?.strict);
    try {
      const qs = new URLSearchParams({ code: String(code || "") });
      if (strict) qs.set("strict", "1");
      const res = await fetch(
        `${API_BASE}/warehouse/scan/resolve?${qs.toString()}`,
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

  useEffect(() => {
    loadPickingMode();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedOrder?.id) {
      setStatusHistory([]);
      return;
    }
    loadStatusHistory(selectedOrder.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedOrder?.id]);

  useEffect(() => {
    if (activePickPlan.length === 0) {
      if (currentIndex !== 0) setCurrentIndex(0);
      setLocationScanned(false);
      setScannedQty(0);
      setManualPickQty("");
      return;
    }
    if (currentIndex > activePickPlan.length - 1) {
      setCurrentIndex(activePickPlan.length - 1);
      setLocationScanned(false);
      setScannedQty(0);
      setManualPickQty("");
    }
  }, [activePickPlan.length, currentIndex]);

  useEffect(() => {
    if (!locationScanned || !isManualPickingMode) return;
    const planned = Number(currentStep?.qty || 0);
    if (planned <= 0) {
      setManualPickQty("");
      return;
    }
    setManualPickQty((prev) => {
      const normalizedPrev = String(prev || "").trim();
      if (!normalizedPrev) return String(planned);
      const parsed = Number(normalizedPrev);
      if (!Number.isFinite(parsed) || parsed <= 0) return String(planned);
      return String(Math.min(Math.floor(parsed), planned));
    });
  }, [locationScanned, isManualPickingMode, currentStep?.lineId, currentStep?.locationId, currentStep?.itemId, currentStep?.qty]);

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
      setSkippedSteps([]);
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
    setSkippedSteps([]);
    setCurrentIndex(0);
    setLocationScanned(false);
    setScannedQty(0);
    setManualPickQty("");
    setSkipModalOpen(false);
    setSkipReason(SKIP_REASON_OPTIONS[0]);
    setSkipComment("");
    setStatusHistory([]);
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
    const orderId = Number(selectedOrder?.id || 0);
    if (!orderId) return;
    if (!qty || qty <= 0) {
      setError("Укажите количество больше 0");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${API_BASE}/orders/${orderId}/pick-confirm`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ lineId, locationId, qty }),
      });
      const data = await readJsonSafe(res);
      if (!res.ok) throw new Error(data?.message || "Ошибка подтверждения отбора");
      if (data?.order) {
        setSelectedOrder(data.order);
      }
      await loadPickPlan(orderId);
      try {
        const freshOrder = await loadCurrentOrder(orderId);
        if (freshOrder) {
          setSelectedOrder(freshOrder);
        }
      } catch {
        // Keep optimistic state from pick-confirm if refresh call failed.
      }
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
    const hasCode = Boolean(code);
    const expectedToken = hasCode ? code : name;
    const locMatch = scanned.match(/^bp:(loc|location):(.*)$/i);
    const locPayload = locMatch ? normalizeScan(locMatch[2]) : "";
    const locPayloadId = locPayload && /^\d+$/.test(locPayload) ? locPayload : "";

    if (
      (expectedToken && scanned === expectedToken) ||
      (locPayload && expectedToken && locPayload === expectedToken) ||
      (locPayloadId && locPayloadId === idValue)
    ) {
      setLocationScanned(true);
      if (isManualPickingMode) {
        const planned = Number(currentStep.qty || 0);
        setManualPickQty(planned > 0 ? String(planned) : "");
      }
      setError("");
      return;
    }

    setError("Скан не совпадает с ячейкой текущего шага.");
  };

  const handleManualPickConfirm = async () => {
    if (!currentStep) return;
    const plannedQty = Number(currentStep.qty || 0);
    if (!Number.isFinite(plannedQty) || plannedQty <= 0) {
      setError("Для шага отбора не задано количество.");
      return;
    }

    const qtyRaw = String(manualPickQty || "").trim();
    const qty = Number(qtyRaw);
    if (!Number.isFinite(qty) || !Number.isInteger(qty) || qty <= 0) {
      setError("Введите целое количество больше 0.");
      return;
    }
    if (qty > plannedQty) {
      setError(`Нельзя подтвердить больше, чем в шаге: ${plannedQty} шт.`);
      return;
    }

    await confirmPick({
      lineId: currentStep.lineId,
      locationId: currentStep.locationId,
      qty,
    });
    setLocationScanned(false);
    setScannedQty(0);
    setManualPickQty("");
    setCurrentIndex(0);
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

  const buildPassportPdf = async (order) => {
    const pdf = new jsPDF("p", "pt", "a4");
    await ensurePdfFont(pdf);
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 10;
    const innerPadding = 8;
    const contentWidth = pageWidth - margin * 2;
    const innerX = margin + innerPadding;
    const innerWidth = contentWidth - innerPadding * 2;

    pdf.setDrawColor(28, 35, 64);
    pdf.setLineWidth(1.3);
    pdf.rect(margin, margin, contentWidth, pageHeight - margin * 2);

    pdf.setFillColor(241, 246, 255);
    pdf.rect(innerX, margin + 8, innerWidth, 112, "F");

    pdf.setTextColor(11, 18, 42);
    pdf.setFontSize(25);
    pdf.text(`Паспорт заказа ${order.orderNumber || "-"}`, margin + 20, margin + 44);
    pdf.setFontSize(13);
    pdf.text(`Дата: ${formatDateTime(order.createdAt)}`, margin + 20, margin + 68);
    pdf.text(`Статус: ${getOrderStatusLabel(order.status)}`, margin + 20, margin + 88);
    pdf.text(`ID заказа: ${order.id || "-"}`, margin + 20, margin + 108);

    const passportPayload = `bp:order:${order.id || ""}`;
    if (order?.id) {
      try {
        const qrDataUrl = await QRCode.toDataURL(passportPayload, {
          errorCorrectionLevel: "M",
          margin: 1,
          width: 220,
        });
        const qrSize = 98;
        const qrX = innerX + innerWidth - qrSize - 12;
        const qrY = margin + 14;
        pdf.addImage(qrDataUrl, "PNG", qrX, qrY, qrSize, qrSize);
        pdf.setFontSize(9);
        pdf.text("QR паспорта", qrX, qrY + qrSize + 11);
        const payloadLines = pdf.splitTextToSize(passportPayload, qrSize + 20);
        pdf.text(payloadLines, qrX, qrY + qrSize + 23);
      } catch {
        // If QR generation fails, keep printable text payload in the document.
      }
    }

    let y = margin + 142;
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
      margin: { left: innerX, right: innerX },
      head: [["#", "Артикул", "Товар", "Заказано", "Отобрано", "Ед."]],
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
        1: { cellWidth: 92 },
        2: { cellWidth: Math.max(180, innerWidth - (34 + 92 + 78 + 78 + 48)), minCellHeight: 24 },
        3: { cellWidth: 78, halign: "center" },
        4: { cellWidth: 78, halign: "center" },
        5: { cellWidth: 48, halign: "center" },
      },
    });

    const finalY = pdf.lastAutoTable?.finalY || y;
    const footerTop = Math.min(finalY + 14, pageHeight - 172);
    const footerHeight = Math.max(120, pageHeight - margin - footerTop - 10);

    pdf.setFillColor(248, 250, 255);
    pdf.rect(margin + 10, footerTop, contentWidth - 20, footerHeight, "F");
    pdf.setDrawColor(188, 201, 224);
    pdf.rect(margin + 10, footerTop, contentWidth - 20, footerHeight);
    pdf.setTextColor(28, 35, 64);
    pdf.setFontSize(16);
    pdf.text("Наклейте этот паспорт на коробку заказа", margin + 20, footerTop + 30);

    const orderNumberText = `№ ${order.orderNumber || "-"}`;
    const maxNumberWidth = contentWidth - 40;

    let orderNumberFontSize = 90;
    pdf.setFontSize(orderNumberFontSize);
    while (
      orderNumberFontSize > 28 &&
      pdf.getTextWidth(orderNumberText) > maxNumberWidth
    ) {
      orderNumberFontSize -= 2;
      pdf.setFontSize(orderNumberFontSize);
    }
    const numberY = footerTop + footerHeight - 24;
    pdf.setTextColor(28, 35, 64);
    pdf.text(orderNumberText, margin + contentWidth / 2, numberY, {
      align: "center",
    });

    return pdf;
  };

  const openSkipModal = () => {
    if (!currentStep) return;
    setSkipReason(SKIP_REASON_OPTIONS[0]);
    setSkipComment("");
    setSkipModalOpen(true);
    setError("");
  };

  const closeSkipModal = () => {
    setSkipModalOpen(false);
  };

  const confirmSkipCurrentStep = async () => {
    if (!currentStep) {
      setSkipModalOpen(false);
      return;
    }
    if (!selectedOrder?.id) {
      setError("Сначала выберите заказ.");
      return;
    }
    const reason = String(skipReason || "").trim();
    if (!reason) {
      setError("Выберите причину пропуска.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${API_BASE}/orders/${selectedOrder.id}/pick-skips`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          lineId: currentStep.lineId,
          itemId: currentStep.itemId,
          locationId: currentStep.locationId,
          qty: Number(currentStep.qty || 0),
          reason,
          comment: String(skipComment || "").trim(),
        }),
      });
      const data = await readJsonSafe(res);
      if (!res.ok) {
        throw new Error(data?.message || "Не удалось сохранить пропуск");
      }
      await loadPickSkips(selectedOrder.id);
      setSkipModalOpen(false);
      setLocationScanned(false);
      setScannedQty(0);
      setError("");
    } catch (err) {
      setError(normalizeErrorMessage(err, "Ошибка сохранения пропуска."));
    } finally {
      setLoading(false);
    }
  };

  const restoreSkippedStep = async (row) => {
    if (!selectedOrder?.id) return;
    if (!row?.id) {
      setSkippedSteps((prev) =>
        (prev || []).filter((entry) => entry.stepKey !== row?.stepKey)
      );
      setError("");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch(
        `${API_BASE}/orders/${selectedOrder.id}/pick-skips/${row.id}/restore`,
        {
          method: "POST",
          headers: authHeaders,
        }
      );
      const data = await readJsonSafe(res);
      if (!res.ok) {
        throw new Error(data?.message || "Не удалось вернуть позицию в маршрут");
      }
      await loadPickSkips(selectedOrder.id);
      setLocationScanned(false);
      setScannedQty(0);
    } catch (err) {
      setError(normalizeErrorMessage(err, "Ошибка восстановления пропуска."));
    } finally {
      setLoading(false);
    }
  };

  const restoreAllSkipped = async () => {
    if (!selectedOrder?.id) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${API_BASE}/orders/${selectedOrder.id}/pick-skips/restore-all`, {
        method: "POST",
        headers: authHeaders,
      });
      const data = await readJsonSafe(res);
      if (!res.ok) {
        throw new Error(data?.message || "Не удалось вернуть позиции в маршрут");
      }
      await loadPickSkips(selectedOrder.id);
      setLocationScanned(false);
      setScannedQty(0);
    } catch (err) {
      setError(normalizeErrorMessage(err, "Ошибка восстановления пропусков."));
    } finally {
      setLoading(false);
    }
  };

  const markPassportPrinted = async (orderId) => {
    try {
      const printedRes = await fetch(`${API_BASE}/orders/${orderId}/passport-printed`, {
        method: "POST",
        headers: authHeaders,
      });
      const printedData = await readJsonSafe(printedRes);
      if (printedRes.ok && printedData?.order) {
        setSelectedOrder(printedData.order);
      }
    } catch {
      // Не блокируем выдачу/печать PDF при ошибке фиксации.
    }
  };

  const trySharePdfFile = async (blob, order) => {
    if (typeof navigator === "undefined" || typeof navigator.share !== "function") {
      return false;
    }

    try {
      const file = new File([blob], makePassportFileName(order), {
        type: "application/pdf",
      });

      if (
        typeof navigator.canShare === "function" &&
        !navigator.canShare({ files: [file] })
      ) {
        return false;
      }

      await navigator.share({
        title: `Паспорт заказа ${order?.orderNumber || "-"}`,
        text: `Паспорт заказа ${order?.orderNumber || "-"}`,
        files: [file],
      });
      return true;
    } catch (err) {
      if (err?.name === "AbortError") {
        return true;
      }
      return false;
    }
  };

  const printPassport = async () => {
    if (!selectedOrder) return;
    if (!canPrintPassport) {
      setError("Сначала завершите отбор товара.");
      return;
    }
    const pdfWindow = prepareDocumentTab({ title: "Паспорт заказа" });
    if (!pdfWindow) {
      setError("Не удалось открыть документ. Разрешите всплывающие окна для портала.");
      return;
    }
    try {
      const pdf = await buildPassportPdf(selectedOrder);
      await markPassportPrinted(selectedOrder.id);
      const blob = pdf.output("blob");
      const shared = await trySharePdfFile(blob, selectedOrder);
      if (shared) {
        try {
          if (!pdfWindow.closed) pdfWindow.close();
        } catch {
          // ignore
        }
        return;
      }
      openBlobInNewTab(blob, { targetWindow: pdfWindow });
    } catch (err) {
      try {
        if (!pdfWindow.closed) pdfWindow.close();
      } catch {
        // ignore
      }
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
      resetSelection();
      await loadQueue();
    } catch (err) {
      const raw = String(err?.message || "").trim();
      if (raw === "ORDER_NOT_FOUND") {
        setError("Заказ не найден.");
      } else if (raw === "NOT_ASSIGNED_TO_YOU") {
        setError("Заказ закреплен за другим сотрудником.");
      } else if (raw === "ORDER_BAD_STATUS") {
        setError("Сначала завершите отбор.");
      } else {
        setError(normalizeErrorMessage(err, "Ошибка завершения заказа."));
      }
    } finally {
      setLoading(false);
    }
  };

  const handleHeaderBack = useCallback(() => {
    leaveSelectedOrder(true);
  }, [leaveSelectedOrder]);

  useEffect(() => {
    const handleExternalBack = (event) => {
      handleHeaderBack();
      if (typeof event?.preventDefault === "function") {
        event.preventDefault();
      }
    };

    window.addEventListener("tsd:mode-back-request", handleExternalBack);
    return () => window.removeEventListener("tsd:mode-back-request", handleExternalBack);
  }, [handleHeaderBack]);

  return (
    <>
      <TsdHeader
        title="Заказы"
        subtitle="Сборка, паспорт, завершение"
        contextLabel="Режим"
        contextValue={mineOnly ? "Мои" : "Общий"}
        onBack={handleHeaderBack}
        showBackButton={showInternalBack}
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
            className="tsd-btn tsd-btn--ghost"
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

            <div className="tsd-card">
              <div className="tsd-card__body">
                <div className="tsd-card__title">История статусов</div>
                {statusHistoryLoading ? (
                  <div className="tsd-card__meta">Загрузка...</div>
                ) : null}
                {!statusHistoryLoading && statusHistory.length === 0 ? (
                  <div className="tsd-card__meta">Событий пока нет.</div>
                ) : null}
                {!statusHistoryLoading && statusHistory.length > 0 ? (
                  <div className="tsd-list">
                    {statusHistory.map((event) => {
                      const actor =
                        event?.actorUser?.name ||
                        event?.actorUser?.email ||
                        (event?.actorUserId ? `#${event.actorUserId}` : "Система");
                      const meta = event?.metaJson && typeof event.metaJson === "object"
                        ? Object.entries(event.metaJson)
                            .filter(([, value]) => value != null && String(value).trim())
                            .map(([key, value]) => `${key}: ${value}`)
                            .join(" • ")
                        : "";
                      return (
                        <div key={event.id} className="tsd-card">
                          <div className="tsd-card__meta">
                            {formatDateTime(event.createdAt)} • {getOrderEventLabel(event.eventType)}
                          </div>
                          <div className="tsd-card__meta">
                            {getOrderStatusLabel(event.fromStatus)} {"->"} {getOrderStatusLabel(event.toStatus)}
                          </div>
                          <div className="tsd-card__meta">Кто: {actor}</div>
                          {meta ? <div className="tsd-card__meta">Данные: {meta}</div> : null}
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            </div>

            {currentStep && (
              <div className="tsd-card">
              <div className="tsd-card__body">
                  {itemImageById.get(Number(currentStep.itemId)) ? (
                    <button
                      type="button"
                      className="tsd-card__image-btn"
                      onClick={() =>
                        setPreviewImage({
                          url: itemImageById.get(Number(currentStep.itemId)),
                          alt: currentStep.itemName || "Товар",
                        })
                      }
                      style={{ marginBottom: 8 }}
                      title="Открыть фото"
                      aria-label="Открыть фото товара"
                    >
                      <img
                        src={itemImageById.get(Number(currentStep.itemId))}
                        alt={currentStep.itemName || "Товар"}
                        className="tsd-card__image"
                        loading="lazy"
                      />
                    </button>
                  ) : null}
                  <div className="tsd-card__title">Шаг {currentIndex + 1} из {activePickPlan.length}</div>
                  <div className="tsd-card__meta">
                    Ячейка: {currentStep.locationCode || currentStep.locationName || `#${currentStep.locationId}`}
                  </div>
                  <div className="tsd-card__meta">Товар: {currentStep.itemName}</div>
                  <div className="tsd-card__meta">Артикул: {currentStep.sku || "-"}</div>
                  <div className="tsd-card__meta">К отбору: {currentStep.qty}</div>
                  <div className="tsd-card__meta">
                    Режим: {isManualPickingMode ? "ручной ввод количества" : "поштучное сканирование"}
                  </div>
                  <div className="tsd-card__meta">Сканировано: {scannedQty}</div>
                </div>
                <div className="tsd-action-inline">
                  <button
                    type="button"
                    className="tsd-btn tsd-btn--secondary"
                    onClick={openSkipModal}
                    disabled={loading}
                  >
                    Пропустить позицию
                  </button>
                </div>
              </div>
            )}

            {selectedOrder && skippedSteps.length > 0 && (
              <div className="tsd-card">
                <div className="tsd-card__body">
                  <div className="tsd-card__title">
                    Пропущенные позиции: {skippedSteps.length}
                  </div>
                  <div className="tsd-card__meta">
                    Пропуск временный. Можно вернуть позицию в маршрут и продолжить отбор.
                  </div>
                </div>
                <div className="tsd-list">
                  {skippedSteps.map((row) => (
                    <div key={row.id || row.stepKey} className="tsd-card">
                      <div className="tsd-card__meta">
                        {row.locationCode || "-"} • {row.itemName || row.sku || `Товар #${row.itemId}`} • {row.qty} шт
                      </div>
                      <div className="tsd-card__meta">Причина: {row.reason}</div>
                      {row.comment ? (
                        <div className="tsd-card__meta">Комментарий: {row.comment}</div>
                      ) : null}
                      <button
                        type="button"
                        className="tsd-btn tsd-btn--ghost"
                        onClick={() => restoreSkippedStep(row)}
                        disabled={loading}
                      >
                        Вернуть в маршрут
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    className="tsd-btn tsd-btn--secondary"
                    onClick={restoreAllSkipped}
                    disabled={loading}
                  >
                    Вернуть все в маршрут
                  </button>
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
                  .map(
                    (row) =>
                      `${row.itemName || row.sku || `Строка ${row.lineId}`} (${getShortageReasonLabel(row)})`
                  )
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

            {currentStep && locationScanned && !isManualPickingMode && (
              <Scanner
                label="Сканируй товар"
                hint={`Нужно: ${currentStep.qty} шт. Сканировано: ${scannedQty}`}
                onScan={handleItemScan}
                disabled={loading}
              />
            )}

            {currentStep && locationScanned && isManualPickingMode && (
              <div className="tsd-card">
                <div className="tsd-card__body">
                  <div className="tsd-card__title">Подтверждение количества</div>
                  <div className="tsd-card__meta">
                    Введите, сколько фактически берете из ячейки.
                  </div>
                </div>
                <form
                  className="tsd-manual"
                  onSubmit={(event) => {
                    event.preventDefault();
                    handleManualPickConfirm();
                  }}
                >
                  <input
                    type="number"
                    min="1"
                    max={String(Number(currentStep.qty || 0) || 1)}
                    step="1"
                    inputMode="numeric"
                    className="tsd-input"
                    value={manualPickQty}
                    onChange={(event) => setManualPickQty(event.target.value)}
                    placeholder={`Количество (макс. ${currentStep.qty})`}
                    disabled={loading}
                  />
                  <button
                    type="submit"
                    className="tsd-btn tsd-btn--primary"
                    disabled={loading}
                  >
                    Подтвердить
                  </button>
                </form>
              </div>
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
                    Паспорт
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

      {skipModalOpen && (
        <div className="tsd-modal" role="dialog" aria-modal="true">
          <div className="tsd-modal__card">
            <div className="tsd-modal__title">Пропустить позицию</div>
            <div className="tsd-modal__text">
              Укажите причину пропуска. Позиция останется в карточке как пропущенная.
            </div>
            <div className="tsd-modal__row">
              <label className="tsd-modal__label">Причина</label>
              <select
                className="tsd-input"
                value={skipReason}
                onChange={(event) => setSkipReason(event.target.value)}
              >
                {SKIP_REASON_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </div>
            <div className="tsd-modal__row">
              <label className="tsd-modal__label">Комментарий (необязательно)</label>
              <input
                className="tsd-input"
                value={skipComment}
                onChange={(event) => setSkipComment(event.target.value)}
                placeholder="Например: брак упаковки"
              />
            </div>
            <div className="tsd-modal__actions">
              <button type="button" className="tsd-btn tsd-btn--ghost" onClick={closeSkipModal}>
                Отмена
              </button>
              <button
                type="button"
                className="tsd-btn tsd-btn--primary"
                onClick={confirmSkipCurrentStep}
              >
                Пропустить
              </button>
            </div>
          </div>
        </div>
      )}

      {previewImage?.url && (
        <div
          className="tsd-modal"
          role="dialog"
          aria-modal="true"
          onClick={() => setPreviewImage(null)}
        >
          <div className="tsd-image-preview" onClick={(event) => event.stopPropagation()}>
            <img
              src={previewImage.url}
              alt={previewImage.alt || "Товар"}
              className="tsd-image-preview__img"
            />
            <button
              type="button"
              className="tsd-btn tsd-btn--ghost"
              onClick={() => setPreviewImage(null)}
            >
              Закрыть
            </button>
          </div>
        </div>
      )}
    </>
  );
}
