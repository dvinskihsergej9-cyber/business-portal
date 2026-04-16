import { useMemo, useState } from "react";
import { API_BASE, normalizeErrorMessage } from "../../apiConfig";
import Scanner from "./Scanner";
import TsdErrorAlert from "./TsdErrorAlert";
import TsdHeader from "./TsdHeader";

const STATUS_LABELS = {
  NEW: "РќРѕРІС‹Р№",
  IN_PICKING: "Р’ РѕС‚Р±РѕСЂРµ",
  PICKED: "РћС‚РѕР±СЂР°РЅ",
  PACKED: "РЈРїР°РєРѕРІР°РЅ",
  READY_TO_SHIP: "Р“РѕС‚РѕРІ Рє РѕС‚РіСЂСѓР·РєРµ",
  SHIPPED: "РћС‚РіСЂСѓР¶РµРЅ",
  CANCELLED: "РћС‚РјРµРЅРµРЅ",
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

export default function ShipmentByPassport({
  authHeaders,
  onBack,
  showInternalBack = true,
}) {
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
      throw new Error("РќРµРІРµСЂРЅС‹Р№ РєРѕРґ. РСЃРїРѕР»СЊР·СѓР№С‚Рµ QR РїР°СЃРїРѕСЂС‚Р° РёР»Рё ID Р·Р°РєР°Р·Р°.");
    }

    const res = await fetch(`${API_BASE}/orders/${orderId}`, {
      headers: authHeaders,
    });
    const data = await readJsonSafe(res);
    if (!res.ok) {
      if (data?.message === "ORDER_NOT_FOUND") {
        throw new Error("Р—Р°РєР°Р· РЅРµ РЅР°Р№РґРµРЅ.");
      }
      throw new Error(data?.message || "РќРµ СѓРґР°Р»РѕСЃСЊ Р·Р°РіСЂСѓР·РёС‚СЊ Р·Р°РєР°Р·.");
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
        throw new Error("Р—Р°РєР°Р· РЅРµ РЅР°Р№РґРµРЅ.");
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
        setSuccess(`Р—Р°РєР°Р· ${nextOrder.orderNumber || `#${nextOrder.id}`} СѓР¶Рµ РѕС‚РіСЂСѓР¶РµРЅ.`);
      } else {
        setError(
          `Р—Р°РєР°Р· ${nextOrder.orderNumber || `#${nextOrder.id}`} РЅРµ РІ СЃС‚Р°С‚СѓСЃРµ В«Р“РѕС‚РѕРІ Рє РѕС‚РіСЂСѓР·РєРµВ».`
        );
      }
    } catch (err) {
      setError(normalizeErrorMessage(err, "РћС€РёР±РєР° РѕР±СЂР°Р±РѕС‚РєРё СЃРєР°РЅР°."));
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
          throw new Error("Р—Р°РєР°Р· СѓР¶Рµ РѕС‚РіСЂСѓР¶РµРЅ.");
        }
        if (data?.message === "ORDER_BAD_STATUS") {
          throw new Error("Р—Р°РєР°Р· РЅРµ РІ СЃС‚Р°С‚СѓСЃРµ В«Р“РѕС‚РѕРІ Рє РѕС‚РіСЂСѓР·РєРµВ».");
        }
        if (data?.message === "ORDER_NOT_FOUND") {
          throw new Error("Р—Р°РєР°Р· РЅРµ РЅР°Р№РґРµРЅ.");
        }
        throw new Error(data?.message || "РќРµ СѓРґР°Р»РѕСЃСЊ РїРѕРґС‚РІРµСЂРґРёС‚СЊ РѕС‚РіСЂСѓР·РєСѓ.");
      }

      const shippedOrder = data?.order || null;
      setOrder(shippedOrder);
      setModalOpen(false);
      setSuccess(`РћС‚РіСЂСѓР¶РµРЅРѕ: ${shippedOrder?.orderNumber || `#${order.id}`}.`);
      resetForm();
    } catch (err) {
      setError(normalizeErrorMessage(err, "РћС€РёР±РєР° РїРѕРґС‚РІРµСЂР¶РґРµРЅРёСЏ РѕС‚РіСЂСѓР·РєРё."));
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <TsdHeader
        title="РћС‚РіСЂСѓР·РєР°"
        subtitle="РЎРєР°РЅ РїР°СЃРїРѕСЂС‚Р° Рё РїРѕРґС‚РІРµСЂР¶РґРµРЅРёРµ"
        contextLabel="РЎС‚Р°С‚СѓСЃ"
        contextValue={order ? getStatusLabel(order.status) : "РћР¶РёРґР°РЅРёРµ СЃРєР°РЅР°"}
        onBack={onBack}
        showBackButton={showInternalBack}
      />

      <div className="tsd-section">
        <TsdErrorAlert message={error} />
        {success ? <div className="tsd-alert tsd-alert--success">{success}</div> : null}

        <Scanner
          label="РЎРєР°РЅРёСЂСѓР№ QR РїР°СЃРїРѕСЂС‚Р°"
          hint="РћР¶РёРґР°РµС‚СЃСЏ РєРѕРґ С„РѕСЂРјР°С‚Р° bp:order:<id>"
          manualPlaceholder="bp:order:123 РёР»Рё ID Р·Р°РєР°Р·Р°"
          onScan={handleScan}
          disabled={loading}
          scanKind="qr"
        />

        {order ? (
          <div className="tsd-card">
            <div className="tsd-card__body">
              <div className="tsd-card__title">{order.orderNumber || `Р—Р°РєР°Р· #${order.id}`}</div>
              <div className="tsd-card__meta">РЎС‚Р°С‚СѓСЃ: {getStatusLabel(order.status)}</div>
              <div className="tsd-card__meta">РџРѕР»СѓС‡Р°С‚РµР»СЊ: {order.customerName || "-"}</div>
              <div className="tsd-card__meta">РђРґСЂРµСЃ: {order.shippingAddress || "-"}</div>
              {order.shippedAt ? (
                <div className="tsd-card__meta">
                  РЈР¶Рµ РѕС‚РіСЂСѓР¶РµРЅ: {new Date(order.shippedAt).toLocaleString("ru-RU")}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      {modalOpen ? (
        <div className="tsd-modal" role="dialog" aria-modal="true">
          <div className="tsd-modal__card">
            <div className="tsd-modal__title">РџРѕРґС‚РІРµСЂР¶РґРµРЅРёРµ РѕС‚РіСЂСѓР·РєРё</div>
            <div className="tsd-modal__text">
              РџРѕРґС‚РІРµСЂРґРёС‚СЊ РёР»Рё РїСЂРѕРїСѓСЃС‚РёС‚СЊ РІРІРѕРґ РґР°РЅРЅС‹С…. Р’ РѕР±РѕРёС… РІР°СЂРёР°РЅС‚Р°С… Р·Р°РєР°Р· Р±СѓРґРµС‚ РѕС‚РіСЂСѓР¶РµРЅ.
            </div>

            <div className="tsd-modal__row">
              <label className="tsd-modal__label">РџРµСЂРµРІРѕР·С‡РёРє (РЅРµРѕР±СЏР·Р°С‚РµР»СЊРЅРѕ)</label>
              <input
                className="tsd-input"
                value={carrier}
                onChange={(event) => setCarrier(event.target.value)}
                placeholder="РќР°РїСЂРёРјРµСЂ: РЎР”Р­Рљ"
                disabled={loading}
              />
            </div>
            <div className="tsd-modal__row">
              <label className="tsd-modal__label">РўСЂРµРє-РЅРѕРјРµСЂ (РЅРµРѕР±СЏР·Р°С‚РµР»СЊРЅРѕ)</label>
              <input
                className="tsd-input"
                value={trackingNumber}
                onChange={(event) => setTrackingNumber(event.target.value)}
                placeholder="РќР°РїСЂРёРјРµСЂ: 123456789"
                disabled={loading}
              />
            </div>
            <div className="tsd-modal__row">
              <label className="tsd-modal__label">РљРѕРјРјРµРЅС‚Р°СЂРёР№ (РЅРµРѕР±СЏР·Р°С‚РµР»СЊРЅРѕ)</label>
              <textarea
                className="tsd-input"
                rows={3}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="РљРѕРјРјРµРЅС‚Р°СЂРёР№ Рє РѕС‚РіСЂСѓР·РєРµ"
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
                РћС‚РјРµРЅР°
              </button>
              <button
                type="button"
                className="tsd-btn tsd-btn--secondary"
                onClick={() => submitShip("SKIP")}
                disabled={loading || !canSubmit}
              >
                РџСЂРѕРїСѓСЃС‚РёС‚СЊ
              </button>
              <button
                type="button"
                className="tsd-btn tsd-btn--primary"
                onClick={() => submitShip("CONFIRM")}
                disabled={loading || !canSubmit}
              >
                РџРѕРґС‚РІРµСЂРґРёС‚СЊ
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

