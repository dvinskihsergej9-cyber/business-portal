import { useEffect, useMemo, useState } from "react";
import { API_BASE, normalizeErrorMessage } from "../apiConfig";

const API = API_BASE;

function filterItemsBySupplier(items, supplierIdRaw) {
  const supplierId = Number(supplierIdRaw);
  if (!supplierId || Number.isNaN(supplierId)) return [];
  return items.filter(
    (it) => Number(it?.autoReorderSupplierId || 0) === supplierId
  );
}

export default function PurchaseOrderModal({
  items = [], // [{ id, name, unit, orderQty, price }]
  suppliers = [], // [{ id, name, ... }]
  onClose,
  onSuccess,
}) {
  const token = localStorage.getItem("token");
  const authHeaders = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  const today = new Date();

  const [form, setForm] = useState({
    supplierId: suppliers[0]?.id ? String(suppliers[0].id) : "",
    plannedDate: "",
    comment: "",
  });

  // Строки заказа – сразу заполняем товарами «к дозаказу»
  const [rows, setRows] = useState(
    items.map((it) => ({
      itemId: it.id,
      name: it.name,
      unit: it.unit || "шт",
      quantity: it.orderQty || "",
      price: it.price || "",
    }))
  );

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const supplierItems = useMemo(
    () => filterItemsBySupplier(items, form.supplierId),
    [items, form.supplierId]
  );
  const supplierItemIds = useMemo(
    () => new Set(supplierItems.map((it) => Number(it.id)).filter(Boolean)),
    [supplierItems]
  );

  const handleFormChange = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSupplierChange = (supplierIdValue) => {
    handleFormChange("supplierId", supplierIdValue);
    const scopedItemIds = new Set(
      filterItemsBySupplier(items, supplierIdValue)
        .map((it) => Number(it.id))
        .filter(Boolean)
    );

    setRows((prev) => {
      const kept = prev.filter((row) => {
        const itemId = Number(row?.itemId || 0);
        return !itemId || scopedItemIds.has(itemId);
      });
      if (kept.length > 0) return kept;

      const fallback = prev[0] || {};
      return [
        {
          ...fallback,
          itemId: "",
          name: "",
          quantity: "",
          price: "",
        },
      ];
    });
  };

  useEffect(() => {
    if (!form.supplierId) return;
    handleSupplierChange(form.supplierId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRowChange = (index, field, value) => {
    setRows((prev) =>
      prev.map((row, i) =>
        i === index
          ? {
              ...row,
              [field]: value,
            }
          : row
      )
    );
  };

  const handleSelectItem = (index, itemIdStr) => {
    const itemId = Number(itemIdStr) || null;
    const src = supplierItems.find((it) => it.id === itemId);

    setRows((prev) =>
      prev.map((row, i) =>
        i === index
          ? {
              ...row,
              itemId,
              name: src?.name || "",
              unit: src?.unit || row.unit || "шт",
              // если цена/количество пустые – подставим дефолты
              quantity: row.quantity || src?.orderQty || "",
              price:
                row.price !== "" && row.price != null
                  ? row.price
                  : src?.price || "",
            }
          : row
      )
    );
  };

  const handleAddRow = () => {
    setRows((prev) => [
      ...prev,
      {
        itemId: "",
        name: "",
        unit: "шт",
        quantity: "",
        price: "",
      },
    ]);
  };

  const handleRemoveRow = (index) => {
    setRows((prev) => prev.filter((_, i) => i !== index));
  };

  const totalAmount = useMemo(() => {
    return rows.reduce((sum, r) => {
      const q = Number(r.quantity) || 0;
      const p = Number(String(r.price || "").replace(",", ".")) || 0;
      return sum + q * p;
    }, 0);
  }, [rows]);

  const readErrorMessage = async (res, fallback) => {
    try {
      const data = await res.clone().json();
      if (data && typeof data.message === "string") return data.message;
    } catch {
      // ignore
    }
    try {
      const text = await res.clone().text();
      if (text) return text.slice(0, 300);
    } catch {
      // ignore
    }
    return fallback;
  };

  const readJsonSafe = async (res) => {
    try {
      return await res.clone().json();
    } catch {
      return null;
    }
  };

  const notifyExcelWarning = (message) => {
    if (typeof window === "undefined") return;
    window.alert(
      `Заказ поставщику создан, но файл Excel не удалось получить. ${message}`
    );
  };

  // === СОЗДАНИЕ ЗАКАЗА + СКАЧИВАНИЕ EXCEL ===
  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    if (!form.supplierId) {
      setError("Выберите поставщика.");
      return;
    }

    const supplierId = Number(form.supplierId);
    const plannedDateRaw = String(form.plannedDate || "").trim();
    let plannedDatePayload = null;
    if (plannedDateRaw) {
      const parsed = new Date(plannedDateRaw);
      if (Number.isNaN(parsed.getTime())) {
        setError("Некорректная дата приемки.");
        return;
      }
      plannedDatePayload = parsed.toISOString();
    }

    // 1) Позиции для БД (обязательно itemId, quantity, price)
    const dbItems = rows
      .map((row) => {
        const itemId = Number(row.itemId);
        const quantity = Number(row.quantity);
        const price = Number(
          String(row.price ?? "")
            .toString()
            .replace(",", ".")
        );

        if (!itemId) return null;
        if (!Number.isFinite(quantity) || quantity <= 0) return null;
        if (!Number.isFinite(price) || price < 0) return null;

        return { itemId, quantity, price };
      })
      .filter(Boolean);

    const hasForeignItems = dbItems.some(
      (row) => !supplierItemIds.has(Number(row.itemId))
    );
    if (hasForeignItems) {
      setError("В заказ можно добавить только товар выбранного поставщика.");
      return;
    }

    if (dbItems.length === 0) {
      setError(
        "Добавьте хотя бы одну строку с выбранным товаром, количеством и ценой."
      );
      return;
    }

    // 2) Позиции для Excel (как и раньше, но без itemId)
    const excelItems = rows
      .map((row) => {
        const baseItem = items.find(
          (it) => it.id === Number(row.itemId)
        );

        const name = (row.name || baseItem?.name || "").trim();
        const unit = (row.unit || baseItem?.unit || "шт").trim();
        const quantity = Number(row.quantity);
        const price = Number(
          String(row.price ?? "")
            .toString()
            .replace(",", ".")
        );

        return { name, unit, quantity, price };
      })
      .filter(
        (r) =>
          r.name &&
          Number.isFinite(r.quantity) &&
          r.quantity > 0 &&
          Number.isFinite(r.price) &&
          r.price >= 0
      );

    try {
      setSaving(true);

      const createRes = await fetch(`${API}/purchase-orders`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          supplierId,
          plannedDate: plannedDatePayload,
          comment: form.comment?.trim() || null,
          items: dbItems,
        }),
      });

      if (!createRes.ok) {
        const message = await readErrorMessage(
          createRes,
          `\u041e\u0448\u0438\u0431\u043a\u0430 \u0441\u043e\u0437\u0434\u0430\u043d\u0438\u044f \u0437\u0430\u043a\u0430\u0437\u0430 \u043f\u043e\u0441\u0442\u0430\u0432\u0449\u0438\u043a\u0443 (HTTP ${createRes.status})`
        );
        throw new Error(message);
      }

      const createdOrder = await readJsonSafe(createRes);

      try {
        const excelRes = await fetch(`${API}/purchase-orders/excel-file`, {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            supplierId,
            plannedDate: plannedDatePayload,
            comment: form.comment?.trim() || null,
            items: excelItems,
          }),
        });

        if (!excelRes.ok) {
          const message = await readErrorMessage(
            excelRes,
            "\u041e\u0448\u0438\u0431\u043a\u0430 \u043f\u0440\u0438 \u0444\u043e\u0440\u043c\u0438\u0440\u043e\u0432\u0430\u043d\u0438\u0438 Excel-\u0437\u0430\u043a\u0430\u0437\u0430 \u043f\u043e\u0441\u0442\u0430\u0432\u0449\u0438\u043a\u0443."
          );
          notifyExcelWarning(
            normalizeErrorMessage(message, "\u041e\u0448\u0438\u0431\u043a\u0430 \u0441\u0435\u0440\u0432\u0435\u0440\u0430.")
          );
        } else {
          const blob = await excelRes.blob();
          const url = window.URL.createObjectURL(blob);

          const supplier = suppliers.find((s) => s.id === supplierId);
          const safeName = (supplier?.name || "supplier")
            .toString()
            .replace(/[\\/:*?"<>|]/g, "_")
            .slice(0, 40);

          const link = document.createElement("a");
          link.href = url;
          link.download = `order_${safeName}.xlsx`;
          document.body.appendChild(link);
          link.click();
          link.remove();
          window.URL.revokeObjectURL(url);
        }
      } catch (excelErr) {
        console.error("excel purchase order error:", excelErr);
        notifyExcelWarning(
          normalizeErrorMessage(
            excelErr,
            "\u041e\u0448\u0438\u0431\u043a\u0430 \u043f\u0440\u0438 \u0441\u043a\u0430\u0447\u0438\u0432\u0430\u043d\u0438\u0438 \u0444\u0430\u0439\u043b\u0430."
          )
        );
      }

      if (onSuccess) onSuccess(createdOrder);
    } catch (e2) {
      console.error(e2);
      setError(
        normalizeErrorMessage(
          e2,
          "\u041e\u0448\u0438\u0431\u043a\u0430 \u043f\u0440\u0438 \u0444\u043e\u0440\u043c\u0438\u0440\u043e\u0432\u0430\u043d\u0438\u0438 \u0437\u0430\u043a\u0430\u0437\u0430 \u043f\u043e\u0441\u0442\u0430\u0432\u0449\u0438\u043a\u0443."
        )
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop">
      <div className="modal modal--wide">
        <div className="modal__header">
          <h2 className="modal__title">Заказ поставщику</h2>
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
            <div className="alert alert--danger" style={{ marginBottom: 12 }}>
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit}>
            {/* Верхний блок как в МойСклад */}
            <div className="po-header-grid">
              <div className="po-header-grid__col">
                <div className="po-header-grid__row">
                  <div className="po-header-grid__label">Поставщик</div>
                  <div className="po-header-grid__field">
                    <select
                      className="form__select"
                      value={form.supplierId}
                      onChange={(e) => handleSupplierChange(e.target.value)}
                    >
                      <option value="">-- Выберите поставщика --</option>
                      {suppliers.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                    {form.supplierId && supplierItems.length === 0 && (
                      <div className="text-muted" style={{ marginTop: 6 }}>
                        У выбранного поставщика нет привязанных товаров.
                      </div>
                    )}
                  </div>
                </div>

                <div className="po-header-grid__row">
                  <div className="po-header-grid__label">
                    План. дата приёмки
                  </div>
                  <div className="po-header-grid__field">
                    <input
                      type="date"
                      className="form__input"
                      value={form.plannedDate}
                      onChange={(e) =>
                        handleFormChange("plannedDate", e.target.value)
                      }
                    />
                  </div>
                </div>

                <div className="po-header-grid__row po-header-grid__row--comment">
                  <div className="po-header-grid__label">Комментарий</div>
                  <div className="po-header-grid__field">
                    <input
                      type="text"
                      className="form__input"
                      value={form.comment}
                      onChange={(e) =>
                        handleFormChange("comment", e.target.value)
                      }
                      placeholder="Условия поставки, номер счёта, и т.п."
                    />
                  </div>
                </div>
              </div>

              <div className="po-header-grid__col po-header-grid__col--right">
                <div className="po-header-meta">
                  <div className="po-header-meta__row">
                    <span className="po-header-meta__label">
                      Дата заказа:
                    </span>
                    <span className="po-header-meta__value">
                      {today.toLocaleDateString("ru-RU")}
                    </span>
                  </div>
                  <div className="po-header-meta__row">
                    <span className="po-header-meta__label">Статус:</span>
                    <span className="po-header-meta__value po-header-meta__value--status">
                      Черновик
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Таблица позиций */}
            <div className="table-wrapper po-table-wrapper">
              <table className="table po-lines-table">
                <thead>
                  <tr>
                    <th style={{ width: 40 }}>№</th>
                    <th>Номенклатура</th>
                    <th style={{ width: 110 }}>Кол-во</th>
                    <th style={{ width: 70 }}>Ед.</th>
                    <th style={{ width: 130 }}>Цена</th>
                    <th style={{ width: 130 }}>Сумма</th>
                    <th style={{ width: 40 }} />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, index) => {
                    const qty = Number(row.quantity) || 0;
                    const price = Number(
                      String(row.price || "").replace(",", ".")
                    );
                    const lineTotal =
                      !Number.isNaN(price) && price >= 0 ? qty * price : 0;

                    return (
                      <tr key={index}>
                        <td>{index + 1}</td>
                        <td>
                          <select
                            className="form__select form__select--sm"
                            value={row.itemId || ""}
                            onChange={(e) =>
                              handleSelectItem(index, e.target.value)
                            }
                          >
                            <option value="">-- выберите товар --</option>
                            {supplierItems.map((it) => (
                              <option key={it.id} value={it.id}>
                                {it.name}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <input
                            type="number"
                            className="form__input form__input--sm"
                            value={row.quantity}
                            onChange={(e) =>
                              handleRowChange(index, "quantity", e.target.value)
                            }
                            min="0"
                            step="0.01"
                            placeholder="0"
                          />
                        </td>
                        <td>
                          <input
                            type="text"
                            className="form__input form__input--sm"
                            value={row.unit}
                            onChange={(e) =>
                              handleRowChange(index, "unit", e.target.value)
                            }
                          />
                        </td>
                        <td>
                          <input
                            type="number"
                            className="form__input form__input--sm"
                            value={row.price}
                            onChange={(e) =>
                              handleRowChange(index, "price", e.target.value)
                            }
                            min="0"
                            step="0.01"
                            placeholder="0.00"
                          />
                        </td>
                        <td>
                          {lineTotal > 0 ? lineTotal.toFixed(2) : "-"}
                        </td>
                        <td>
                          <button
                            type="button"
                            className="btn btn--icon"
                            onClick={() => handleRemoveRow(index)}
                            title="Удалить строку"
                          >
                            ×
                          </button>
                        </td>
                      </tr>
                    );
                  })}

                  <tr>
                    <td colSpan={7}>
                      <button
                        type="button"
                        className="btn btn--secondary btn--sm"
                        onClick={handleAddRow}
                      >
                        + Добавить позицию
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Низ формы: итого + кнопки */}
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
                <span>Итого:</span>
                <strong>{totalAmount.toFixed(2)} ₽</strong>
              </div>

              <button
                type="submit"
                className="btn btn--primary"
                disabled={saving}
              >
                {saving
                  ? "Формирование файла..."
                  : "Создать заказ по конкретному поставщику"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}



