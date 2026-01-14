// C:\Users\dvinskikh.sergey\Desktop\business-portal\src\components\PurchaseOrderReceiveModal.jsx

import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../apiConfig";

/**
 * Открыть окно с печатной формой акта возврата/расхождений
 * order  – заказ (number, date, supplier.name)
 * rows   – строки приёмки (orderedQty / receivedQty / name / unit / price)
 * orgInfo – реквизиты организации
 */
function openDiscrepancyActWindow(order, rows, orgInfo) {
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
  </div>
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
 * Модалка для ввода реквизитов организации (запрашивается один раз)
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
 * Модалка "Закуп по заказу" (приёмка с компа)
 */
export default function PurchaseOrderReceiveModal({ onClose }) {
  const token = localStorage.getItem("token");
  const authHeaders = {
    Authorization: `Bearer ${token}`,
  };

  const [orders, setOrders] = useState([]);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [rows, setRows] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasDiff, setHasDiff] = useState(false);

  // реквизиты организации / модалка
  const [orgInfo, setOrgInfo] = useState(null);
  const [showOrgModal, setShowOrgModal] = useState(false);
  const [pendingAct, setPendingAct] = useState(null); // { order, rows }

  // ====== загрузка реквизитов организации из localStorage ======
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

  // ====== загрузка заказов поставщику ======
  useEffect(() => {
    const loadOrders = async () => {
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
          throw new Error(
            "Ответ сервера не похож на JSON при загрузке заказов"
          );
        }

        if (!res.ok) {
          throw new Error(data?.message || "Ошибка загрузки заказов");
        }

        // показываем только заказы, которые ещё НЕ проведены по складу
        const list = Array.isArray(data)
          ? data.filter(
              (o) =>
                o.status === "DRAFT" ||
                o.status === "SENT" ||
                o.status === "PARTIAL"
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

    loadOrders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ====== выбор конкретного заказа ======
  const handleSelectOrder = async (orderId) => {
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
      setHasDiff(false);

      // ожидается, что data.items = [{ id, quantity, price, item: { name, unit } }]
      const rowsFromOrder = (data.items || []).map((row, index) => ({
        index: index + 1,
        orderItemId: row.id,
        name: row.item?.name || "",
        unit: row.item?.unit || "шт",
        orderedQty: row.quantity,
        receivedQty: row.quantity, // по умолчанию = заказанному
        price: row.price,
      }));

      setRows(rowsFromOrder);
    } catch (e) {
      console.error(e);
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleQtyChange = (rowIndex, value) => {
    setRows((prev) =>
      prev.map((row, i) =>
        i === rowIndex ? { ...row, receivedQty: value } : row
      )
    );
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

  // ====== работа с реквизитами для акта ======
  const handleOrgSave = (info) => {
    try {
      localStorage.setItem("orgInfo", JSON.stringify(info));
    } catch (e) {
      console.error("Ошибка сохранения orgInfo в localStorage", e);
    }
    setOrgInfo(info);
    setShowOrgModal(false);

    if (pendingAct) {
      openDiscrepancyActWindow(pendingAct.order, pendingAct.rows, info);
      setPendingAct(null);
      onClose();
    }
  };

  const handleOrgCancel = () => {
    setShowOrgModal(false);
    setPendingAct(null);
    // заказ уже проведён, но акт не нужен — просто закрываем модалку
    onClose();
  };

  const ensureOrgInfoAndOpenAct = (orderForAct, rowsForAct) => {
    const hasRealDiff = rowsForAct.some(
      (r) => Number(r.receivedQty) !== Number(r.orderedQty)
    );
    if (!hasRealDiff) {
      onClose();
      return;
    }

    if (orgInfo) {
      openDiscrepancyActWindow(orderForAct, rowsForAct, orgInfo);
      onClose();
    } else {
      setPendingAct({ order: orderForAct, rows: rowsForAct });
      setShowOrgModal(true);
    }
  };

  // ====== отправка на бэкенд ======
  const handleSubmit = async (e) => {
    e.preventDefault();
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

      // Открываем акт (если есть реальные расхождения).
      ensureOrgInfoAndOpenAct(orderForAct, rows);
    } catch (e) {
      console.error(e);
      setError(e.message);
      setSaving(false);
    }
  };

  // ====== Рендер ======
  return (
    <div className="modal-backdrop">
      <div className="modal modal--wide">
        <div className="modal__header">
          <h2 className="modal__title">Закуп по заказу поставщику</h2>
          <button
            type="button"
            className="modal__close"
            onClick={onClose}
            disabled={saving}
          >
            ×
          </button>
        </div>

        <div className="modal__body">
          {error && (
            <div className="alert alert--danger" style={{ marginBottom: 8 }}>
              {error}
            </div>
          )}

          {/* 1. Список заказов, пока не выбран конкретный */}
          {!selectedOrder && (
            <>
              <p style={{ marginBottom: 8 }}>
                Выберите заказ поставщику, по которому пришёл товар:
              </p>

              {loading ? (
                <p>Загрузка заказов...</p>
              ) : orders.length === 0 ? (
                <p className="text-muted">
                  Нет заказов поставщику, ожидающих приёмку.
                </p>
              ) : (
                <div className="table-wrapper">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Номер</th>
                        <th>Поставщик</th>
                        <th>Дата</th>
                        <th>Статус</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {orders.map((o) => (
                        <tr key={o.id}>
                          <td>{o.number}</td>
                          <td>{o.supplier?.name || "-"}</td>
                          <td>
                            {o.date
                              ? new Date(o.date).toLocaleString("ru-RU")
                              : "-"}
                          </td>
                          <td>{o.status}</td>
                          <td>
                            <button
                              type="button"
                              className="btn btn--secondary btn--sm"
                              onClick={() => handleSelectOrder(o.id)}
                            >
                              Выбрать
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          {/* 2. Форма приёмки по выбранному заказу */}
          {selectedOrder && (
            <form onSubmit={handleSubmit}>
              {/* Блок «шапка» в стиле 1С */}
              <div className="po-receive-block">
                <div className="po-receive-row">
                  <div className="po-receive-label">Заказ</div>
                  <div className="po-receive-value">
                    <strong>
                      {selectedOrder.number}{" "}
                      {selectedOrder.date &&
                        `от ${new Date(
                          selectedOrder.date
                        ).toLocaleString("ru-RU")}`}
                    </strong>
                  </div>
                </div>

                <div className="po-receive-row">
                  <div className="po-receive-label">Были ли расхождения?</div>

                  <div className="po-receive-field">
                    <label className="po-receive-radio">
                      <input
                        type="radio"
                        checked={!hasDiff}
                        onChange={() => {
                          setHasDiff(false);
                          setRows((prev) =>
                            prev.map((r) => ({
                              ...r,
                              receivedQty: r.orderedQty,
                            }))
                          );
                        }}
                      />
                      <span>Нет</span>
                    </label>

                    <label className="po-receive-radio">
                      <input
                        type="radio"
                        checked={hasDiff}
                        onChange={() => setHasDiff(true)}
                      />
                      <span>Да, изменю количество</span>
                    </label>
                  </div>
                </div>
              </div>

              <div className="table-wrapper">
                <table className="table">
                  <thead>
                    <tr>
                      <th>№</th>
                      <th>Номенклатура</th>
                      <th>Заказано</th>
                      <th>Получено</th>
                      <th>Ед.</th>
                      <th>Цена</th>
                      <th>Сумма</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, idx) => {
                      const ordered = Number(row.orderedQty) || 0;
                      const received = Number(row.receivedQty) || 0;
                      const price = Number(row.price) || 0;
                      const sum = received * price;

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
                                handleQtyChange(
                                  idx,
                                  hasDiff ? e.target.value : row.orderedQty
                                )
                              }
                              disabled={!hasDiff}
                              min="0"
                            />
                          </td>
                          <td>{row.unit}</td>
                          <td>{price.toFixed(2)}</td>
                          <td>{sum ? sum.toFixed(2) : "-"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="po-footer">
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={onClose}
                  disabled={saving}
                >
                  Отмена
                </button>

                <div className="po-footer__total">
                  <span>Итого по факту:</span>
                  <strong>{totalAmount.toFixed(2)} ₽</strong>
                </div>

                <button
                  type="submit"
                  className="btn btn--primary"
                  disabled={saving}
                >
                  {saving ? "Проведение..." : "Провести заказ на склад"}
                </button>
              </div>
            </form>
          )}
        </div>

        {showOrgModal && (
          <OrganizationInfoModal
            onSave={handleOrgSave}
            onCancel={handleOrgCancel}
          />
        )}
      </div>
    </div>
  );
}
