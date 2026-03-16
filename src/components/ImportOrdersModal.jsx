import { useRef, useState } from "react";
import * as XLSX from "xlsx";
import { API_BASE } from "../apiConfig";

const HEADER_ALIASES = {
  ordernumber: "orderNumber",
  order: "orderNumber",
  номерзаказа: "orderNumber",
  заказ: "orderNumber",
  customername: "customerName",
  получатель: "customerName",
  клиент: "customerName",
  customerphone: "customerPhone",
  телефон: "customerPhone",
  phone: "customerPhone",
  shippingaddress: "shippingAddress",
  адрес: "shippingAddress",
  address: "shippingAddress",
  deliverycomment: "deliveryComment",
  комментарий: "deliveryComment",
  comment: "deliveryComment",
  sku: "sku",
  артикул: "sku",
  barcode: "barcode",
  штрихкод: "barcode",
  name: "name",
  наименование: "name",
  товар: "name",
  qty: "qty",
  количество: "qty",
  externalorderid: "externalOrderId",
  externalid: "externalOrderId",
  внешнийid: "externalOrderId",
  внешнийзаказ: "externalOrderId",
};

function normalizeHeader(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^a-z0-9а-яё]/gi, "");
}

export default function ImportOrdersModal({ onClose, onImportSuccess }) {
  const [step, setStep] = useState(1);
  const [orders, setOrders] = useState([]);
  const [errors, setErrors] = useState([]);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState(null);
  const fileInputRef = useRef(null);
  const localStorageKey = "orders_import_local";

  const saveLocalImport = (payload) => {
    try {
      const existing = JSON.parse(localStorage.getItem(localStorageKey) || "[]");
      const next = Array.isArray(existing) ? existing.concat(payload) : payload;
      localStorage.setItem(localStorageKey, JSON.stringify(next));
      return true;
    } catch (err) {
      console.error("local import save error:", err);
      return false;
    }
  };

  const handleFileChange = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data);
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
      const headerRow = jsonData[0] || [];
      const rows = jsonData.slice(1);

      const headerMap = headerRow.map((cell) => {
        const key = HEADER_ALIASES[normalizeHeader(cell)];
        return key || null;
      });

      const grouped = new Map();
      const importErrors = [];

      rows.forEach((row, index) => {
        const record = {};
        headerMap.forEach((key, idx) => {
          if (!key) return;
          record[key] = row[idx];
        });

        const orderNumber = record.orderNumber ? String(record.orderNumber).trim() : "";
        const externalOrderId = record.externalOrderId ? String(record.externalOrderId).trim() : "";
        const customerName = record.customerName ? String(record.customerName).trim() : "";
        const shippingAddress = record.shippingAddress ? String(record.shippingAddress).trim() : "";
        const qty = Math.trunc(Number(record.qty));
        const sku = record.sku ? String(record.sku).trim() : "";
        const name = record.name ? String(record.name).trim() : "";
        const barcode = record.barcode ? String(record.barcode).trim() : "";

        const orderKey = externalOrderId || orderNumber;
        if (!orderKey) {
          importErrors.push({ row: index + 2, error: "Нет номера заказа." });
          return;
        }
        if (!customerName || !shippingAddress) {
          importErrors.push({ row: index + 2, error: "Нет получателя или адреса." });
          return;
        }
        if (!Number.isFinite(qty) || qty <= 0) {
          importErrors.push({ row: index + 2, error: "Некорректное количество." });
          return;
        }
        if (!sku && !name && !barcode) {
          importErrors.push({ row: index + 2, error: "Нет артикула или наименования." });
          return;
        }

        const entry =
          grouped.get(orderKey) ||
          {
            externalOrderId: externalOrderId || null,
            orderNumber: orderNumber || externalOrderId,
            customerName,
            customerPhone: record.customerPhone ? String(record.customerPhone).trim() : "",
            shippingAddress,
            deliveryComment: record.deliveryComment ? String(record.deliveryComment).trim() : "",
            items: [],
            rows: [],
          };

        entry.items.push({
          sku: sku || null,
          name: name || null,
          barcode: barcode || null,
          qty,
        });
        entry.rows.push(index + 2);
        grouped.set(orderKey, entry);
      });

      setOrders(Array.from(grouped.values()));
      setErrors(importErrors);
      setStep(2);
    } catch (err) {
      console.error(err);
      alert("Ошибка чтения файла.");
    }
  };

  const handleImport = async () => {
    if (orders.length === 0) {
      alert("Нет валидных заказов для импорта.");
      return;
    }
    setImporting(true);
    try {
      const token = localStorage.getItem("token");
      if (!token) {
        alert("Нет авторизации. Перезайдите в систему.");
        return;
      }
      const res = await fetch(`${API_BASE}/orders/import-batch`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ orders }),
      });
      if (res.status === 404) {
        const ok = saveLocalImport(orders);
        if (!ok) {
          throw new Error("Импорт не удался. Сервер недоступен, локальное сохранение не удалось.");
        }
        setResult({
          created: orders.length,
          updated: 0,
          errors: [],
          localOnly: true,
        });
        setStep(3);
        if (onImportSuccess) onImportSuccess();
        return;
      }

      let data = null;
      try {
        data = await res.json();
      } catch {
        data = null;
      }
      if (!res.ok) {
        const statusInfo = res.status ? ` (HTTP ${res.status})` : "";
        const message =
          data?.message || `Ошибка импорта. Сервер не принял данные${statusInfo}.`;
        throw new Error(message);
      }
      setResult(data);
      setStep(3);
      if (onImportSuccess) onImportSuccess();
    } catch (err) {
      console.error(err);
      alert(err.message);
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="admin-modal">
      <div className="admin-modal__panel" style={{ maxWidth: 900, width: "90%" }}>
        <div className="admin-modal__header">
          <div>
            <div className="admin-modal__title">Импорт заказов</div>
            <div className="admin-modal__subtitle">Excel .xlsx</div>
          </div>
          <button type="button" className="admin-btn admin-btn--ghost" onClick={onClose}>
            Отмена
          </button>
        </div>

        {step === 1 && (
          <div className="admin-form">
            <div className="admin-muted">
              Колонки: номер заказа, получатель, телефон, адрес, комментарий, артикул, наименование, количество.
            </div>
            <div className="admin-form__row" style={{ marginTop: 12 }}>
              <button
                type="button"
                className="admin-btn admin-btn--primary"
                onClick={() => fileInputRef.current?.click()}
              >
                Выбрать файл
              </button>
              <a
                className="admin-btn admin-btn--secondary"
                href="/templates/orders-import-template.xlsx"
                download
              >
                Скачать шаблон
              </a>
            </div>
            <input
              type="file"
              accept=".xlsx, .xls"
              onChange={handleFileChange}
              ref={fileInputRef}
              style={{ display: "none" }}
            />
          </div>
        )}

        {step === 2 && (
          <>
            <div className="admin-muted">
              Найдено заказов: {orders.length}. Ошибок строк: {errors.length}.
            </div>
            <div className="admin-table-wrapper" style={{ maxHeight: 320, overflow: "auto" }}>
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Заказ</th>
                    <th>Получатель</th>
                    <th>Адрес</th>
                    <th>Позиции</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((order) => (
                    <tr key={order.orderNumber}>
                      <td>{order.orderNumber}</td>
                      <td>{order.customerName}</td>
                      <td>{order.shippingAddress}</td>
                      <td>{order.items.length}</td>
                    </tr>
                  ))}
                  {!orders.length && (
                    <tr>
                      <td colSpan="4" className="admin-muted">
                        Нет валидных заказов.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {errors.length > 0 && (
              <div className="admin-alert admin-alert--error" style={{ marginTop: 12 }}>
                Ошибки: {errors.length}
              </div>
            )}

            <div className="admin-modal__actions">
              <button type="button" className="admin-btn admin-btn--ghost" onClick={() => setStep(1)}>
                Назад
              </button>
              <button
                type="button"
                className="admin-btn admin-btn--primary"
                onClick={handleImport}
                disabled={importing || orders.length === 0}
              >
                {importing ? "Импорт..." : "Импортировать"}
              </button>
              {errors.length > 0 && (
                <div className="admin-muted" style={{ marginLeft: "auto" }}>
                  Есть ошибки строк, но валидные заказы можно импортировать.
                </div>
              )}
            </div>
          </>
        )}

        {step === 3 && result && (
          <div className="admin-form">
            <div className="admin-muted">Импорт завершен.</div>
            {result.localOnly && (
              <div className="admin-alert admin-alert--warning" style={{ marginTop: 8 }}>
                Сервер заказов не настроен. Данные сохранены локально на этом устройстве.
              </div>
            )}
            <div>Создано: {result.created}</div>
            <div>Обновлено: {result.updated}</div>
            {result.errors && result.errors.length > 0 && (
              <div className="admin-alert admin-alert--error" style={{ marginTop: 12 }}>
                Ошибки: {result.errors.length}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}




