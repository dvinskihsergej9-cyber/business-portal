// C:\Users\dvinskikh.sergey\Desktop\business-portal\src\components\MobileReceiveByOrder.jsx

import { useEffect, useMemo, useRef, useState } from "react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import { apiFetch } from "../apiConfig";
import ResponsiveDataView from "./ResponsiveDataView";
import MobileCard from "./mobile/MobileCard";

/**
 * Окно акта возврата/расхождений (мобильная версия с кнопкой "Отправить")
 */
function openMobileDiscrepancyActWindow(order, rows, orgInfo) {
  if (!order || !Array.isArray(rows) || rows.length === 0) return;

  const diffs = rows.filter(
    (r) => Number(r.receivedQty) !== Number(r.orderedQty)
  );
  if (diffs.length === 0) return;

  const actDate = new Date();
  const actDateStr = actDate.toLocaleDateString("ru-RU");
  const orderDateStr = order?.date
    ? new Date(order.date).toLocaleDateString("ru-RU")
    : "";

  let totalOrdered = 0;
  let totalReceived = 0;
  let totalDiff = 0;

  const rowsHtml = diffs
    .map((r, idx) => {
      const ordered = Number(r.orderedQty) || 0;
      const received = Number(r.receivedQty) || 0;
      const diff = ordered - received;

      totalOrdered += ordered;
      totalReceived += received;
      if (diff > 0) totalDiff += diff;

      return `
        <tr>
          <td style="text-align:center;">${idx + 1}</td>
          <td>${r.name || ""}</td>
          <td style="text-align:center;">${ordered}</td>
          <td style="text-align:center;">${received}</td>
          <td style="text-align:center;">${diff > 0 ? diff : ""}</td>
          <td></td>
        </tr>
      `;
    })
    .join("");

  const phoneRow = orgInfo.phone
    ? `<tr><td>Тел.: ${orgInfo.phone}</td></tr>`
    : "";

  const html = `
<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <title>Акт возврата товара по заказу ${order?.number || ""}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 20px;
      font-family: "Times New Roman", serif;
      font-size: 12px;
      color: #000;
    }
    .a4 {
      width: 190mm;
      margin: 0 auto;
    }
    table {
      border-collapse: collapse;
      width: 100%;
    }
    .no-border td {
      border: none;
      padding: 0;
    }
    .act-table th, .act-table td {
      border: 1px solid #000;
      padding: 3px 4px;
    }
    .title {
      text-align: center;
      font-size: 14px;
      font-weight: 600;
      margin: 14px 0 8px;
    }
    .small {
      font-size: 11px;
    }
    .signs {
      margin-top: 32px;
      display: flex;
      justify-content: space-between;
      gap: 24px;
    }
    .sign {
      flex: 1;
    }
    .sign .line {
      border-bottom: 1px solid #000;
      margin: 18px 0 4px;
    }
    .print-btn {
      margin-top: 24px;
      padding: 6px 16px;
      font-size: 13px;
    }
    @media print {
      .print-btn { display: none; }
      body { margin: 0; }
      .a4 { width: auto; margin: 0; }
    }
  </style>
</head>
<body>
  <div class="a4">
    <table class="no-border">
      <tr><td>${orgInfo.name}</td></tr>
      <tr><td>Юридический адрес: ${orgInfo.legalAddress}</td></tr>
      <tr><td>Фактический адрес: ${orgInfo.actualAddress}</td></tr>
      <tr><td>ИНН ${orgInfo.inn}&nbsp;&nbsp;&nbsp;&nbsp;КПП ${orgInfo.kpp}</td></tr>
      ${phoneRow}
    </table>

    <div class="title">
      АКТ ВОЗВРАТА ТОВАРА № ${order?.number || ""} от ${actDateStr}
    </div>

    <div class="small" style="margin-bottom:4px;">
      Поставщик: ${order?.supplier?.name || ""}
    </div>
    <div class="small" style="margin-bottom:8px;">
      Документ: заказ поставщику № ${order?.number || ""} от ${orderDateStr}
    </div>

    <div class="small" style="margin-bottom:6px;">
      При оценке качества поставленного товара зафиксированы следующие недостатки:
    </div>

    <table class="act-table">
      <tr>
        <th rowspan="2" style="width:30px;">№ п/п</th>
        <th rowspan="2">Наименование товара</th>
        <th colspan="2" style="width:120px;">Количество, шт.</th>
        <th rowspan="2" style="width:90px;">Количество товара с недостатками, шт.</th>
        <th rowspan="2" style="width:130px;">Заключение, примечание</th>
      </tr>
      <tr>
        <th>по накладной</th>
        <th>фактически</th>
      </tr>
      ${rowsHtml}
      <tr>
        <td colspan="2" style="text-align:right;font-weight:bold;">Итого:</td>
        <td style="text-align:center;font-weight:bold;">${totalOrdered}</td>
        <td style="text-align:center;font-weight:bold;">${totalReceived}</td>
        <td style="text-align:center;font-weight:bold;">${totalDiff}</td>
        <td></td>
      </tr>
    </table>

    <div class="small" style="margin-top:16px;">
      Недостатки товара вызваны причинами, возникшими до момента прибытия Товара
      на склад/распределительный центр Покупателя.
    </div>

    <div class="signs">
      <div class="sign">
        <div>Получатель</div>
        <div class="line"></div>
        <div class="small">должность / подпись / Ф.И.О.</div>
        <div class="small" style="text-align:right; margin-top:4px;">М.П.</div>
      </div>
      <div class="sign">
        <div>Представитель поставщика (экспедитор)</div>
        <div class="line"></div>
        <div class="small">должность / подпись / Ф.И.О.</div>
      </div>
    </div>

    <button class="print-btn" onclick="window.print()">Печать</button>
    <button class="print-btn" onclick="handleShareAct()">Отправить</button>
  </div>

  <script>
    // Отправка акта через системное меню «Поделиться» (для мобильных)
    async function handleShareAct() {
      if (!navigator.share) {
        alert(
          "Кнопка «Отправить» работает только на телефонах. " +
          "Откройте акт на мобильном устройстве и нажмите «Отправить», " +
          "или сохраните его в PDF и отправьте вручную."
        );
        return;
      }

      if (window.__actSharingInProgress) {
        return;
      }
      window.__actSharingInProgress = true;

      try {
        await navigator.share({
          title: document.title || "Акт возврата товара",
          text: "Акт возврата товара",
        });
      } catch (err) {
        if (!err || err.name === "AbortError") {
          return;
        }
        console.error(err);
        alert("Не удалось открыть меню отправки на этом устройстве.");
      } finally {
        window.__actSharingInProgress = false;
      }
    }
  </script>
</body>
</html>
  `;

  const win = window.open("", "_blank");
  if (!win) {
    alert(
      "Браузер заблокировал всплывающее окно с актом. Разрешите всплывающие окна и попробуйте ещё раз."
    );
    return;
  }

  win.document.write(html);
  win.document.close();
}

/**
 * Та же модалка реквизитов, что и в приёмке с компа
 */
function OrganizationInfoModal({ onSave, onCancel }) {
  const [form, setForm] = useState({
    name: "",
    legalAddress: "",
    actualAddress: "",
    inn: "",
    kpp: "",
    phone: "",
  });

  const handleChange = (field) => (e) => {
    setForm((prev) => ({ ...prev, [field]: e.target.value }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();

    if (!form.name.trim()) {
      alert("Укажите наименование организации");
      return;
    }
    if (!form.legalAddress.trim()) {
      alert("Укажите юридический адрес");
      return;
    }

    const info = {
      name: form.name.trim(),
      legalAddress: form.legalAddress.trim(),
      actualAddress:
        form.actualAddress.trim() || form.legalAddress.trim(),
      inn: form.inn.trim(),
      kpp: form.kpp.trim(),
      phone: form.phone.trim(),
    };

    onSave(info);
  };

  return (
    <div className="modal-backdrop" style={{ zIndex: 1100 }}>
      <div className="modal" style={{ maxWidth: 700, width: "100%" }}>
        <div className="modal__header">
          <h2 className="modal__title">Реквизиты организации</h2>
        </div>
        <div className="modal__body">
          <form onSubmit={handleSubmit} className="request-form-1c">
            <div className="form__group">
              <label className="form__label">Наименование</label>
              <input
                className="form__input"
                value={form.name}
                onChange={handleChange("name")}
              />
            </div>
            <div className="form__group">
              <label className="form__label">Юр. адрес</label>
              <input
                className="form__input"
                value={form.legalAddress}
                onChange={handleChange("legalAddress")}
              />
            </div>
            <div className="form__group">
              <label className="form__label">Факт. адрес</label>
              <input
                className="form__input"
                placeholder="если совпадает — можно оставить пустым"
                value={form.actualAddress}
                onChange={handleChange("actualAddress")}
              />
            </div>
            <div className="form__group">
              <label className="form__label">ИНН</label>
              <input
                className="form__input"
                value={form.inn}
                onChange={handleChange("inn")}
              />
            </div>
            <div className="form__group">
              <label className="form__label">КПП</label>
              <input
                className="form__input"
                value={form.kpp}
                onChange={handleChange("kpp")}
              />
            </div>
            <div className="form__group">
              <label className="form__label">Телефон</label>
              <input
                className="form__input"
                value={form.phone}
                onChange={handleChange("phone")}
              />
            </div>

            <div className="request-form-1c__actions">
              <button type="submit" className="btn">
                Сохранить
              </button>
              <button
                type="button"
                className="btn btn--ghost"
                style={{ marginLeft: 8 }}
                onClick={onCancel}
              >
                Отмена
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

/**
 * Приёмка по заказу (мобильный ТСД)
 */
export default function MobileReceiveByOrder({ authToken, onBack }) {
  const token = authToken || localStorage.getItem("token");
  const authHeaders = {
    Authorization: `Bearer ${token}`,
  };

  const [orders, setOrders] = useState([]);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [rows, setRows] = useState([]);
  const [barcode, setBarcode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // камера
  const [isScannerOn, setIsScannerOn] = useState(false);
  const videoRef = useRef(null);
  const scannerRef = useRef(null);

  // реквизиты / акт
  const [orgInfo, setOrgInfo] = useState(null);
  const [showOrgModal, setShowOrgModal] = useState(false);
  const [pendingAct, setPendingAct] = useState(null); // { order, rows }

  // --- загрузка реквизитов из localStorage ---
  useEffect(() => {
    try {
      const raw = localStorage.getItem("orgInfo");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.name) {
          setOrgInfo(parsed);
        }
      }
    } catch (e) {
      console.error("Ошибка чтения orgInfo из localStorage", e);
    }
  }, []);

  // --- загрузка заказов (только не полученные) ---
  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        setError("");

        const res = await apiFetch("/purchase-orders", {
          headers: authHeaders,
        });
        let data;
        try {
          data = await res.json();
        } catch {
          throw new Error("Ответ сервера не похож на JSON при загрузке заказов");
        }

        if (!res.ok) {
          throw new Error(data?.message || "Ошибка загрузки заказов");
        }

        // показываем все заказы, которые ещё НЕ получены
        const list = Array.isArray(data)
          ? data.filter(
              (o) => o.status !== "RECEIVED" && o.status !== "CLOSED"
            )
          : [];

        setOrders(list);
      } catch (e) {
        console.error(e);
        setError(e.message);
      } finally {
        setLoading(false);
      }
    };

    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- запуск / остановка камеры ---
  useEffect(() => {
    if (!isScannerOn) {
      if (scannerRef.current) {
        scannerRef.current.reset();
        scannerRef.current = null;
      }
      return;
    }

    const reader = new BrowserMultiFormatReader();
    scannerRef.current = reader;

    reader
      .decodeFromVideoDevice(null, videoRef.current, (result, err) => {
        if (result) {
          const text = result.getText();
          handleBarcode(text);
          setIsScannerOn(false);
        }
      })
      .catch((err) => {
        console.error(err);
        setError(
          "Не удалось запустить камеру. Разрешите доступ к камере в браузере."
        );
        setIsScannerOn(false);
      });

    return () => {
      if (scannerRef.current) {
        scannerRef.current.reset();
        scannerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isScannerOn]);

  const handleSelectOrder = async (orderId) => {
    if (!orderId) {
      setSelectedOrder(null);
      setRows([]);
      return;
    };

    try {
      setError("");
      setLoading(true);

      const res = await apiFetch(`/purchase-orders/${orderId}`, {
        headers: authHeaders,
      });

      let data;
      try {
        data = await res.json();
      } catch {
        throw new Error("Ответ сервера не похож на JSON при загрузке заказа");
      }

      if (!res.ok) {
        throw new Error(data?.message || "Ошибка загрузки заказа");
      }

      setSelectedOrder(data);

      const rowsFromOrder = (data.items || []).map((row, index) => ({
        index: index + 1,
        orderItemId: row.id,
        name: row.item?.name || "",
        unit: row.item?.unit || "шт",
        orderedQty: row.quantity,
        receivedQty: 0,
        price: row.price,
        barcode: row.item?.barcode || "",
      }));

      setRows(rowsFromOrder);
      setBarcode("");
    } catch (e) {
      console.error(e);
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleBarcode = (code) => {
    const trimmed = (code || "").trim();
    if (!trimmed) return;

    setRows((prev) => {
      const idx = prev.findIndex(
        (r) => r.barcode && r.barcode === trimmed
      );
      if (idx === -1) {
        setError(`Товар со штрихкодом ${trimmed} не найден в заказе.`);
        return prev;
      }
      setError("");

      return prev.map((r, i) =>
        i === idx
          ? {
              ...r,
              receivedQty: Number(r.receivedQty || 0) + 1,
            }
          : r
      );
    });
  };

  const handleProcessBarcodeClick = () => {
    handleBarcode(barcode);
    setBarcode("");
  };

  const handleChangeReceived = (rowIndex, value) => {
    setRows((prev) =>
      prev.map((row, i) =>
        i === rowIndex ? { ...row, receivedQty: value } : row
      )
    );
  };

  const handleResetAll = () => {
    setRows((prev) => prev.map((r) => ({ ...r, receivedQty: 0 })));
  };

  const totalAmount = useMemo(
    () =>
      rows.reduce((sum, r) => {
        const q = Number(r.receivedQty) || 0;
        const p = Number(r.price) || 0;
        return sum + q * p;
      }, 0),
    [rows]
  );

  // ====== работа с реквизитами и актом ======
  const handleOrgSave = (info) => {
    try {
      localStorage.setItem("orgInfo", JSON.stringify(info));
    } catch (e) {
      console.error("Ошибка сохранения orgInfo в localStorage", e);
    }
    setOrgInfo(info);
    setShowOrgModal(false);

    if (pendingAct) {
      openMobileDiscrepancyActWindow(pendingAct.order, pendingAct.rows, info);
      setPendingAct(null);
    }
  };

  const handleOrgCancel = () => {
    setShowOrgModal(false);
    setPendingAct(null);
  };

  const ensureOrgInfoAndOpenAct = (orderForAct, rowsForAct) => {
    const hasRealDiff = rowsForAct.some(
      (r) => Number(r.receivedQty) !== Number(r.orderedQty)
    );
    if (!hasRealDiff) return;

    if (orgInfo) {
      openMobileDiscrepancyActWindow(orderForAct, rowsForAct, orgInfo);
    } else {
      setPendingAct({ order: orderForAct, rows: rowsForAct });
      setShowOrgModal(true);
    }
  };

  const handleFinish = async () => {
    if (!selectedOrder) return;

    try {
      setSaving(true);
      setError("");

      const payloadItems = rows.map((r) => ({
        orderItemId: r.orderItemId,
        receivedQuantity: Number(r.receivedQty),
      }));

      const res = await apiFetch(
        `/purchase-orders/${selectedOrder.id}/receive`,
        {
          method: "POST",
          headers: {
            ...authHeaders,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ items: payloadItems }),
        }
      );

      let data;
      try {
        data = await res.json();
      } catch {
        data = null;
      }

      if (!res.ok) {
        throw new Error(
          (data && data.message) ||
            "Ошибка сервера при приёмке заказа по складу"
        );
      }

      const orderForAct = data?.order || selectedOrder;
      ensureOrgInfoAndOpenAct(orderForAct, rows);

      // Сбрасываем состояние
      setSelectedOrder(null);
      setRows([]);
      setBarcode("");
    } catch (e) {
      console.error(e);
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card card--1c">
      <div
        className="card1c__header"
        style={{ display: "flex", alignItems: "center", gap: 8 }}
      >
        {onBack && (
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={onBack}
          >
            ← Назад
          </button>
        )}
        <span>Приёмка по заказу (мобильный ТСД)</span>
      </div>

      <div className="card1c__body">
        {error && (
          <div className="alert alert--danger" style={{ marginBottom: 8 }}>
            {error}
          </div>
        )}

        {/* выбор заказа */}
        <div className="form__group">
          <label className="form__label">Заказ поставщику</label>
          {loading ? (
            <p>Загрузка заказов...</p>
          ) : orders.length === 0 ? (
            <p className="text-muted">
              Нет заказов поставщику, которые ещё не получены.
            </p>
          ) : (
            <select
              className="form__select"
              value={selectedOrder?.id || ""}
              onChange={(e) => handleSelectOrder(e.target.value)}
            >
              <option value="">Выберите заказ...</option>
              {orders.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.number} — {o.supplier?.name || "-"}
                </option>
              ))}
            </select>
          )}
        </div>

        {selectedOrder && (
          <>
            <div
              style={{
                marginBottom: 8,
                padding: 8,
                borderRadius: 6,
                background: "#fff7ed",
                fontSize: 13,
              }}
            >
              Заказ: {selectedOrder.number} от{" "}
              {selectedOrder.date
                ? new Date(selectedOrder.date).toLocaleString("ru-RU")
                : "-"}
              <br />
              Сканируйте штрихкод — каждое сканирование добавляет +1 к колонке{" "}
              «Принято».
            </div>

            <div style={{ marginBottom: 8 }}>
              <button
                type="button"
                className="btn btn--secondary btn--sm"
                onClick={() => setIsScannerOn((v) => !v)}
              >
                {isScannerOn ? "Остановить сканер" : "Открыть камеру"}
              </button>
            </div>

            {isScannerOn && (
              <div style={{ marginBottom: 8 }}>
                <video
                  ref={videoRef}
                  style={{
                    width: "100%",
                    maxHeight: 260,
                    borderRadius: 8,
                    border: "1px solid #e5e7eb",
                  }}
                />
              </div>
            )}

            <div className="form__group">
              <label className="form__label">Штрихкод</label>
              <input
                className="form__input"
                value={barcode}
                onChange={(e) => setBarcode(e.target.value)}
                placeholder="Сканируйте или введите штрихкод"
              />
            </div>

            <div
              className="request-form-1c__actions"
              style={{ marginBottom: 12 }}
            >
              <button
                type="button"
                className="btn btn--primary btn--sm"
                onClick={handleProcessBarcodeClick}
                disabled={!barcode}
              >
                Обработать штрихкод
              </button>
            </div>

            {/* таблица строк заказа */}
            <ResponsiveDataView
              rows={rows}
              columns={[
                { key: "index", label: "#" },
                { key: "name", label: "Item" },
                { key: "orderedQty", label: "Ordered" },
                { key: "receivedQty", label: "Received" },
                { key: "diff", label: "Diff" },
              ]}
              renderRowDesktop={(row, idx) => {
                const ordered = Number(row.orderedQty) || 0;
                const received = Number(row.receivedQty) || 0;
                const diff = received - ordered;

                return (
                  <tr key={row.orderItemId}>
                    <td>{row.index}</td>
                    <td>{row.name}</td>
                    <td>{ordered}</td>
                    <td>
                      <input
                        type="number"
                        className="form__input form__input--sm"
                        value={row.receivedQty}
                        onChange={(e) =>
                          handleChangeReceived(idx, e.target.value)
                        }
                        min="0"
                      />
                    </td>
                    <td
                      style={{
                        color:
                          diff < 0 ? "#b91c1c" : diff > 0 ? "#92400e" : "",
                        fontWeight: diff != 0 ? 600 : 400,
                      }}
                    >
                      {diff == 0 ? "0" : diff}
                    </td>
                  </tr>
                );
              }}
              renderCardMobile={({ row, index }) => {
                const ordered = Number(row.orderedQty) || 0;
                const received = Number(row.receivedQty) || 0;
                const diff = received - ordered;

                return (
                  <MobileCard>
                    <div className="mobile-card__title">{row.name}</div>
                    <div className="mobile-card__fields">
                      <div className="mobile-field">
                        <div className="mobile-field__label">Ordered</div>
                        <div className="mobile-field__value">{ordered}</div>
                      </div>
                      <label style={{ display: "grid", gap: 6 }}>
                        Received
                        <input
                          type="number"
                          className="form__input form__input--sm"
                          value={row.receivedQty}
                          onChange={(e) =>
                            handleChangeReceived(index, e.target.value)
                          }
                          min="0"
                        />
                      </label>
                      <div className="mobile-field">
                        <div className="mobile-field__label">Diff</div>
                        <div
                          className="mobile-field__value"
                          style={{
                            color:
                              diff < 0 ? "#b91c1c" : diff > 0 ? "#92400e" : "",
                            fontWeight: diff != 0 ? 600 : 400,
                          }}
                        >
                          {diff == 0 ? "0" : diff}
                        </div>
                      </div>
                    </div>
                  </MobileCard>
                );
              }}
              wrapperClassName="table-wrapper"
            />


            <div
              style={{
                marginTop: 8,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                flexWrap: "wrap",
                gap: 8,
              }}
            >
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={handleResetAll}
              >
                Сбросить всё в 0
              </button>

              <div style={{ fontWeight: 600 }}>
                Итого по факту: {totalAmount.toFixed(2)} ₽
              </div>
            </div>

            <div
              className="request-form-1c__actions"
              style={{ marginTop: 12 }}
            >
              <button
                type="button"
                className="btn btn--primary"
                onClick={handleFinish}
                disabled={saving}
              >
                {saving ? "Проведение..." : "Завершить приёмку"}
              </button>
            </div>
          </>
        )}
      </div>

      {showOrgModal && (
        <OrganizationInfoModal
          onSave={handleOrgSave}
          onCancel={handleOrgCancel}
        />
      )}
    </div>
  );
}
