import { useState, useRef } from "react";
import { apiFetch } from "../apiConfig";
import * as XLSX from "xlsx";
import ResponsiveDataView from "./ResponsiveDataView";

export default function ImportItemsModal({ onClose, onImportSuccess }) {
    const [step, setStep] = useState(1); // 1: Upload, 2: Preview, 3: Result
    const [items, setItems] = useState([]);
    const [errors, setErrors] = useState([]);
    const [importing, setImporting] = useState(false);
    const [result, setResult] = useState(null);
    const fileInputRef = useRef(null);

    const handleFileChange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        try {
            const data = await file.arrayBuffer();
            const workbook = XLSX.read(data);
            const worksheet = workbook.Sheets[workbook.SheetNames[0]];
            const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

            // Ожидаем заголовки в первой строке, данные со второй
            // Формат: Name, SKU, Barcode, Unit, Min, Max, Price
            const rows = jsonData.slice(1);
            const parsedItems = rows.map((row, index) => {
                const rowNum = index + 2;
                const item = {
                    row: rowNum,
                    name: row[0],
                    sku: row[1],
                    barcode: row[2],
                    unit: row[3],
                    // F=5 (Min), I=8 (Max), J=9 (Price)
                    minStock: row[5],
                    maxStock: row[8],
                    defaultPrice: row[9],
                    isValid: true,
                    validationError: null,
                };

                // Валидация
                if (!item.name || !String(item.name).trim()) {
                    item.isValid = false;
                    item.validationError = "Нет названия";
                } else if (!item.sku || !String(item.sku).trim()) {
                    item.isValid = false;
                    item.validationError = "Нет артикула (SKU)";
                }

                return item;
            }).filter(it => it.name || it.sku); // убираем совсем пустые строки

            setItems(parsedItems);
            setStep(2);
        } catch (err) {
            console.error(err);
            alert("Ошибка чтения файла");
        }
    };

    const handleImport = async () => {
        const validItems = items.filter((it) => it.isValid);
        if (validItems.length === 0) {
            alert("Нет валидных записей для импорта");
            return;
        }

        setImporting(true);
        try {
            const token = localStorage.getItem("token");
            const res = await apiFetch("/inventory/items/batch", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({ items: validItems }),
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.message || "Ошибка импорта");

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
        <div className="modal-overlay">
            <div className="modal-content" style={{ maxWidth: 900, width: "90%" }}>
                <div className="modal-header">
                    <h2>Импорт товаров</h2>
                    <button onClick={onClose} className="close-btn">×</button>
                </div>

                <div className="modal-body">
                    {step === 1 && (
                        <div style={{ textAlign: "center", padding: 40, border: "2px dashed #ccc", borderRadius: 8 }}>
                            <p>Загрузите Excel файл (.xlsx)</p>
                            <p style={{ fontSize: 12, color: "#666", marginBottom: 20 }}>
                                Колонки: Наименование, Артикул, Штрихкод, Ед.изм., Мин.остаток, Макс.остаток, Цена
                            </p>
                            <input
                                type="file"
                                accept=".xlsx, .xls"
                                onChange={handleFileChange}
                                ref={fileInputRef}
                                style={{ display: "none" }}
                            />
                            <button onClick={() => fileInputRef.current.click()} className="btn btn-primary">
                                Выбрать файл
                            </button>
                        </div>
                    )}

                    {step === 2 && (
                        <div>
                            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
                                <strong>Найдено строк: {items.length}</strong>
                                <div>
                                    <span style={{ color: "green", marginRight: 10 }}>
                                        Готовы: {items.filter(i => i.isValid).length}
                                    </span>
                                    <span style={{ color: "red" }}>
                                        Ошибки: {items.filter(i => !i.isValid).length}
                                    </span>
                                </div>
                            </div>

                            <div style={{ maxHeight: 400, overflow: "auto", border: "1px solid #eee" }}>
                                <ResponsiveDataView
                                    rows={items}
                                    columns={[
                                        { key: "row", label: "#" },
                                        {
                                            key: "status",
                                            label: "Status",
                                            render: (it) =>
                                                it.isValid ? (
                                                    <span style={{ color: "green" }}>OK</span>
                                                ) : (
                                                    <span style={{ color: "red" }}>
                                                        {it.validationError}
                                                    </span>
                                                ),
                                        },
                                        { key: "name", label: "Name" },
                                        { key: "sku", label: "SKU" },
                                        { key: "barcode", label: "Barcode" },
                                        { key: "unit", label: "Unit" },
                                        { key: "defaultPrice", label: "Price" },
                                    ]}
                                    renderRowDesktop={(it) => (
                                        <tr key={it.row} style={{ background: it.isValid ? "white" : "#fff0f0" }}>
                                            <td style={{ padding: 6, borderBottom: "1px solid #eee" }}>{it.row}</td>
                                            <td style={{ padding: 6, borderBottom: "1px solid #eee" }}>
                                                {it.isValid ? (
                                                    <span style={{ color: "green" }}>OK</span>
                                                ) : (
                                                    <span style={{ color: "red" }}>
                                                        {it.validationError}
                                                    </span>
                                                )}
                                            </td>
                                            <td style={{ padding: 6, borderBottom: "1px solid #eee" }}>{it.name}</td>
                                            <td style={{ padding: 6, borderBottom: "1px solid #eee" }}>{it.sku}</td>
                                            <td style={{ padding: 6, borderBottom: "1px solid #eee" }}>{it.barcode}</td>
                                            <td style={{ padding: 6, borderBottom: "1px solid #eee" }}>{it.unit}</td>
                                            <td style={{ padding: 6, borderBottom: "1px solid #eee" }}>{it.defaultPrice}</td>
                                        </tr>
                                    )}
                                    tableClassName=""
                                    wrapperClassName=""
                                />
                            </div>


                            <div style={{ marginTop: 20, display: "flex", justifyContent: "flex-end", gap: 10 }}>
                                <button onClick={() => setStep(1)} className="btn">Назад</button>
                                <button
                                    onClick={handleImport}
                                    className="btn btn-primary"
                                    disabled={importing || items.filter(i => i.isValid).length === 0}
                                >
                                    {importing ? "Импорт..." : `Импортировать (${items.filter(i => i.isValid).length})`}
                                </button>
                            </div>
                        </div>
                    )}

                    {step === 3 && result && (
                        <div style={{ textAlign: "center", padding: 20 }}>
                            <h3 style={{ color: "green" }}>Импорт завершён!</h3>
                            <p>Создано новых: <strong>{result.created}</strong></p>
                            <p>Обновлено: <strong>{result.updated}</strong></p>
                            {result.errors && result.errors.length > 0 && (
                                <div style={{ marginTop: 20, textAlign: "left" }}>
                                    <h4 style={{ color: "red" }}>Ошибки при сохранении ({result.errors.length}):</h4>
                                    <ul style={{ maxHeight: 100, overflow: "auto", fontSize: 12 }}>
                                        {result.errors.map((e, i) => (
                                            <li key={i}>Строка {e.row}: {e.error}</li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                            <button onClick={onClose} className="btn btn-primary" style={{ marginTop: 20 }}>
                                Закрыть
                            </button>
                        </div>
                    )}
                </div>
            </div>
            <style>{`
        .modal-overlay {
          position: fixed; top: 0; left: 0; right: 0; bottom: 0;
          background: rgba(0,0,0,0.5);
          display: flex; align-items: center; justify-content: center;
          z-index: 1000;
        }
        .modal-content {
          background: white; padding: 20px; border-radius: 8px;
          box-shadow: 0 2px 10px rgba(0,0,0,0.1);
          max-height: 90vh; display: flex; flex-direction: column;
          position: relative;
        }
        .modal-header {
          display: flex; justifyContent: space-between; align-items: center;
          margin-bottom: 20px;
        }
        .close-btn {
          background: none; border: none; font-size: 24px; cursor: pointer;
        }
        .btn {
          padding: 8px 16px; border-radius: 4px; border: 1px solid #ddd;
          background: white; cursor: pointer;
        }
        .btn-primary {
          background: #2563eb; color: white; border: none;
        }
        .btn-primary:disabled {
          background: #93c5fd; cursor: not-allowed;
        }
      `}</style>
        </div>
    );
}
