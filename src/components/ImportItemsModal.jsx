import { useRef, useState } from "react";
import * as XLSX from "xlsx";
import { API_BASE } from "../apiConfig";

const ITEM_HEADER_ALIASES = {
  name: "name",
  наименование: "name",
  товар: "name",
  sku: "sku",
  артикул: "sku",
  barcode: "barcode",
  штрихкод: "barcode",
  unit: "unit",
  единица: "unit",
  ед: "unit",
  едизм: "unit",
  minstock: "minStock",
  min: "minStock",
  мин: "minStock",
  миностаток: "minStock",
  maxstock: "maxStock",
  max: "maxStock",
  макс: "maxStock",
  максостаток: "maxStock",
  price: "defaultPrice",
  цена: "defaultPrice",
};

function normalizeHeader(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^a-z0-9а-яё]/gi, "");
}

function normalizeOptionalNumber(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  if (!text) return null;
  const parsed = Number(text.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : value;
}

export default function ImportItemsModal({ onClose, onImportSuccess }) {
  const [step, setStep] = useState(1);
  const [items, setItems] = useState([]);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState(null);
  const fileInputRef = useRef(null);

  const handleFileChange = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data);
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
      const headerRow = jsonData[0] || [];
      const headerMap = headerRow.map((cell) => {
        const normalized = normalizeHeader(cell);
        return ITEM_HEADER_ALIASES[normalized] || null;
      });
      const hasKnownHeaders = headerMap.some(Boolean);
      const rows = jsonData.slice(1);

      const parsedItems = rows
        .map((row, index) => {
          const rowNum = index + 2;
          const record = {};

          if (hasKnownHeaders) {
            headerMap.forEach((key, idx) => {
              if (!key) return;
              record[key] = row[idx];
            });
          } else {
            // Fallback for older templates without recognizable headers.
            record.name = row[0];
            record.sku = row[1];
            record.barcode = row[2];
            record.unit = row[3];
            record.minStock = row[5];
            record.maxStock = row[8];
            record.defaultPrice = row[9];
          }

          const item = {
            row: rowNum,
            name: record.name ? String(record.name).trim() : "",
            sku: record.sku ? String(record.sku).trim() : "",
            barcode: record.barcode ? String(record.barcode).trim() : "",
            unit: record.unit ? String(record.unit).trim() : "",
            minStock: normalizeOptionalNumber(record.minStock),
            maxStock: normalizeOptionalNumber(record.maxStock),
            defaultPrice: normalizeOptionalNumber(record.defaultPrice),
            isValid: true,
            validationError: "",
          };

          if (!item.name) {
            item.isValid = false;
            item.validationError = "Нет наименования";
          } else if (!item.sku) {
            item.isValid = false;
            item.validationError = "Нет артикула";
          }

          return item;
        })
        .filter((item) => item.name || item.sku || item.barcode);

      setItems(parsedItems);
      setStep(2);
    } catch (err) {
      console.error(err);
      alert("Ошибка чтения файла.");
    }
  };

  const handleImport = async () => {
    const validItems = items.filter((item) => item.isValid);
    if (validItems.length === 0) {
      alert("Нет валидных позиций для импорта.");
      return;
    }

    setImporting(true);
    try {
      const token = localStorage.getItem("token");
      const res = await fetch(`${API_BASE}/inventory/items/batch`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ items: validItems }),
      });

      let data = null;
      try {
        data = await res.json();
      } catch {
        data = null;
      }

      if (!res.ok) {
        throw new Error(data?.message || "Ошибка импорта номенклатуры.");
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
            <div className="admin-modal__title">Импорт номенклатуры</div>
            <div className="admin-modal__subtitle">Excel .xlsx</div>
          </div>
          <button type="button" className="admin-btn admin-btn--ghost" onClick={onClose}>
            Отмена
          </button>
        </div>

        {step === 1 && (
          <div className="admin-form">
            <div className="admin-muted">
              Колонки: Наименование, Артикул, Штрихкод, Ед. изм., Мин. остаток, Макс.
              остаток, Цена.
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
                href="/templates/items-import-template.xlsx"
                download
              >
                Скачать шаблон
              </a>
            </div>
            <input
              type="file"
              accept=".xlsx,.xls"
              ref={fileInputRef}
              style={{ display: "none" }}
              onChange={handleFileChange}
            />
          </div>
        )}

        {step === 2 && (
          <>
            <div className="admin-muted">
              Найдено строк: {items.length}. Готово: {items.filter((item) => item.isValid).length}.
              Ошибок: {items.filter((item) => !item.isValid).length}.
            </div>

            <div className="admin-table-wrapper" style={{ maxHeight: 360, overflow: "auto" }}>
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Строка</th>
                    <th>Статус</th>
                    <th>Наименование</th>
                    <th>Артикул</th>
                    <th>Штрихкод</th>
                    <th>Ед.</th>
                    <th>Цена</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.row}>
                      <td>{item.row}</td>
                      <td style={{ color: item.isValid ? "#0f766e" : "#b91c1c", fontWeight: 600 }}>
                        {item.isValid ? "OK" : item.validationError}
                      </td>
                      <td>{item.name}</td>
                      <td>{item.sku}</td>
                      <td>{item.barcode || "—"}</td>
                      <td>{item.unit || "шт"}</td>
                      <td>{item.defaultPrice ?? "—"}</td>
                    </tr>
                  ))}
                  {!items.length && (
                    <tr>
                      <td colSpan="7" className="admin-muted">
                        В файле нет строк для импорта.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="admin-modal__actions">
              <button type="button" className="admin-btn admin-btn--ghost" onClick={() => setStep(1)}>
                Назад
              </button>
              <button
                type="button"
                className="admin-btn admin-btn--primary"
                onClick={handleImport}
                disabled={importing || items.filter((item) => item.isValid).length === 0}
              >
                {importing ? "Импорт..." : "Импортировать"}
              </button>
            </div>
          </>
        )}

        {step === 3 && result && (
          <div className="admin-form">
            <div className="admin-muted">Импорт завершен.</div>
            <div>Создано: {result.created || 0}</div>
            <div>Обновлено: {result.updated || 0}</div>
            <div>Лимит SKU: {result.skuLimit ?? "—"}</div>
            {Array.isArray(result.errors) && result.errors.length > 0 && (
              <div className="admin-alert admin-alert--warning" style={{ marginTop: 10 }}>
                Необработанных строк: {result.errors.length}
              </div>
            )}
            <div className="admin-modal__actions">
              <button type="button" className="admin-btn admin-btn--primary" onClick={onClose}>
                Закрыть
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
