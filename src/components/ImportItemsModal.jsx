import { useRef, useState } from "react";
import { createPortal } from "react-dom";
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
  едизм: "unit",
  единица: "unit",
  ед: "unit",
  minstock: "minStock",
  min: "minStock",
  мин: "minStock",
  миностаток: "minStock",
  миност: "minStock",
  maxstock: "maxStock",
  max: "maxStock",
  макс: "maxStock",
  максостаток: "maxStock",
  максост: "maxStock",
  price: "defaultPrice",
  цена: "defaultPrice",
};

function normalizeHeader(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^a-z0-9а-яё]/gi, "");
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
            // Legacy fallback by index if headers are unknown.
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
            name: record.name,
            sku: record.sku,
            barcode: record.barcode,
            unit: record.unit,
            minStock: record.minStock,
            maxStock: record.maxStock,
            defaultPrice: record.defaultPrice,
            isValid: true,
            validationError: null,
          };

          if (!item.name || !String(item.name).trim()) {
            item.isValid = false;
            item.validationError = "Нет названия";
          } else if (!item.sku || !String(item.sku).trim()) {
            item.isValid = false;
            item.validationError = "Нет артикула";
          }

          return item;
        })
        .filter((item) => item.name || item.sku);

      setItems(parsedItems);
      setStep(2);
    } catch (err) {
      console.error(err);
      alert("Ошибка чтения файла");
    }
  };

  const handleImport = async () => {
    const validItems = items.filter((item) => item.isValid);
    if (validItems.length === 0) {
      alert("Нет валидных записей для импорта");
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
        throw new Error(data?.message || "Ошибка импорта");
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

  const modal = (
    <div className="modal-overlay">
      <div className="modal-content" style={{ maxWidth: 900, width: "90%" }}>
        <div className="modal-header">
          <h2>Импорт товаров</h2>
          <button type="button" onClick={onClose} className="close-btn" aria-label="Закрыть">
            ×
          </button>
        </div>

        <div className="modal-body">
          {step === 1 && (
            <div
              style={{
                textAlign: "center",
                padding: 40,
                border: "2px dashed #ccc",
                borderRadius: 8,
              }}
            >
              <p>Загрузите Excel файл (.xlsx)</p>
              <p style={{ fontSize: 12, color: "#666", marginBottom: 20 }}>
                Колонки: Наименование, Артикул, Штрихкод, Ед.изм., Мин.остаток,
                Макс.остаток, Цена (необязательно)
              </p>
              <input
                type="file"
                accept=".xlsx, .xls"
                onChange={handleFileChange}
                ref={fileInputRef}
                style={{ display: "none" }}
              />
              <div style={{ display: "flex", justifyContent: "center", gap: 10, flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="btn btn-primary"
                >
                  Выбрать файл
                </button>
                <a href="/templates/items-import-template.xlsx" download className="btn">
                  Скачать шаблон
                </a>
              </div>
            </div>
          )}

          {step === 2 && (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
                <strong>Найдено строк: {items.length}</strong>
                <div>
                  <span style={{ color: "green", marginRight: 10 }}>
                    Готовы: {items.filter((item) => item.isValid).length}
                  </span>
                  <span style={{ color: "red" }}>
                    Ошибки: {items.filter((item) => !item.isValid).length}
                  </span>
                </div>
              </div>

              <div style={{ maxHeight: 400, overflow: "auto", border: "1px solid #eee" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead style={{ position: "sticky", top: 0, background: "#f9f9f9" }}>
                    <tr>
                      <th style={{ padding: 8, borderBottom: "1px solid #ddd" }}>№</th>
                      <th style={{ padding: 8, borderBottom: "1px solid #ddd" }}>Статус</th>
                      <th style={{ padding: 8, borderBottom: "1px solid #ddd" }}>Название</th>
                      <th style={{ padding: 8, borderBottom: "1px solid #ddd" }}>Артикул</th>
                      <th style={{ padding: 8, borderBottom: "1px solid #ddd" }}>Штрихкод</th>
                      <th style={{ padding: 8, borderBottom: "1px solid #ddd" }}>Ед.</th>
                      <th style={{ padding: 8, borderBottom: "1px solid #ddd" }}>Цена</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item) => (
                      <tr key={item.row} style={{ background: item.isValid ? "white" : "#fff0f0" }}>
                        <td style={{ padding: 6, borderBottom: "1px solid #eee" }}>{item.row}</td>
                        <td style={{ padding: 6, borderBottom: "1px solid #eee" }}>
                          {item.isValid ? (
                            <span style={{ color: "green" }}>OK</span>
                          ) : (
                            <span style={{ color: "red" }}>{item.validationError}</span>
                          )}
                        </td>
                        <td style={{ padding: 6, borderBottom: "1px solid #eee" }}>{item.name}</td>
                        <td style={{ padding: 6, borderBottom: "1px solid #eee" }}>{item.sku}</td>
                        <td style={{ padding: 6, borderBottom: "1px solid #eee" }}>{item.barcode}</td>
                        <td style={{ padding: 6, borderBottom: "1px solid #eee" }}>{item.unit}</td>
                        <td style={{ padding: 6, borderBottom: "1px solid #eee" }}>{item.defaultPrice}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div style={{ marginTop: 20, display: "flex", justifyContent: "flex-end", gap: 10 }}>
                <button type="button" onClick={() => setStep(1)} className="btn">
                  Назад
                </button>
                <button
                  type="button"
                  onClick={handleImport}
                  className="btn btn-primary"
                  disabled={importing || items.filter((item) => item.isValid).length === 0}
                >
                  {importing ? "Импорт..." : `Импортировать (${items.filter((item) => item.isValid).length})`}
                </button>
              </div>
            </div>
          )}

          {step === 3 && result && (
            <div style={{ textAlign: "center", padding: 20 }}>
              <h3 style={{ color: "green" }}>Импорт завершён!</h3>
              <p>
                Создано новых: <strong>{result.created}</strong>
              </p>
              <p>
                Обновлено: <strong>{result.updated}</strong>
              </p>
              {result.errors && result.errors.length > 0 && (
                <div style={{ marginTop: 20, textAlign: "left" }}>
                  <h4 style={{ color: "red" }}>Ошибки при сохранении ({result.errors.length}):</h4>
                  <ul style={{ maxHeight: 100, overflow: "auto", fontSize: 12 }}>
                    {result.errors.map((error, index) => (
                      <li key={index}>
                        Строка {error.row}: {error.error}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <button type="button" onClick={onClose} className="btn btn-primary" style={{ marginTop: 20 }}>
                Закрыть
              </button>
            </div>
          )}
        </div>
      </div>
      <style>{`
        .modal-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0,0,0,0.5);
          display: flex;
          align-items: flex-start;
          justify-content: center;
          padding-top: 48px;
          z-index: 8000;
          overflow-y: auto;
        }
        .modal-content {
          background: white;
          padding: 20px;
          border-radius: 8px;
          box-shadow: 0 2px 10px rgba(0,0,0,0.1);
          max-height: calc(100vh - 96px);
          display: flex;
          flex-direction: column;
          position: relative;
          margin-bottom: 24px;
        }
        .modal-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 20px;
        }
        .close-btn {
          background: none;
          border: none;
          font-size: 24px;
          cursor: pointer;
          line-height: 1;
        }
        .btn {
          padding: 8px 16px;
          border-radius: 4px;
          border: 1px solid #ddd;
          background: white;
          cursor: pointer;
          text-decoration: none;
          color: inherit;
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }
        .btn-primary {
          background: #2563eb;
          color: white;
          border: none;
        }
        .btn-primary:disabled {
          background: #93c5fd;
          cursor: not-allowed;
        }
      `}</style>
    </div>
  );

  if (typeof document === "undefined") return modal;
  return createPortal(modal, document.body);
}
