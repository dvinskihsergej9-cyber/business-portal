import { useMemo, useState } from "react";
import { apiFetch } from "../apiConfig";
import ResponsiveDataView from "./ResponsiveDataView";
import MobileActions from "./mobile/MobileActions";
import MobileCard from "./mobile/MobileCard";

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

  const handleFormChange = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

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
    const src = items.find((it) => it.id === itemId);

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

  // === СОЗДАНИЕ ЗАКАЗА + СКАЧИВАНИЕ EXCEL ===
  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    if (!form.supplierId) {
      setError("Выберите поставщика.");
      return;
    }

    const supplierId = Number(form.supplierId);

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

      // ---------- 1. СОЗДАЁМ ЗАКАЗ В БАЗЕ ----------
      const createRes = await apiFetch("/purchase-orders", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          supplierId,
          plannedDate: form.plannedDate || null,
          comment: form.comment?.trim() || null,
          items: dbItems,
        }),
      });

      const createData = await createRes.json();
      if (!createRes.ok) {
        throw new Error(
          createData?.message || "Ошибка создания заказа поставщику"
        );
      }

      // ---------- 2. ФОРМИРУЕМ EXCEL-ФАЙЛ (как раньше) ----------
      const excelRes = await apiFetch("/purchase-orders/excel-file", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          supplierId,
          plannedDate: form.plannedDate || null,
          comment: form.comment?.trim() || null,
          items: excelItems,
        }),
      });

      if (!excelRes.ok) {
        let message = "Ошибка при формировании Excel-заказа поставщику";
        try {
          const data = await excelRes.json();
          if (data?.message) message = data.message;
        } catch (_) {
          // тело не JSON – оставляем дефолтное сообщение
        }
        throw new Error(message);
      }

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

      if (onSuccess) onSuccess(); // родитель перезагрузит список заказов
    } catch (e2) {
      console.error(e2);
      setError(e2.message || "Ошибка при формировании заказа поставщику");
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
                      onChange={(e) =>
                        handleFormChange("supplierId", e.target.value)
                      }
                    >
                      <option value="">-- Выберите поставщика --</option>
                      {suppliers.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
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
            <ResponsiveDataView
              rows={rows}
              columns={[
                { key: "index", label: "#" },
                { key: "itemId", label: "Item" },
                { key: "quantity", label: "Qty" },
                { key: "unit", label: "Unit" },
                { key: "price", label: "Price" },
                { key: "total", label: "Total" },
                { key: "actions", label: "" },
              ]}
              renderRowDesktop={(row, index) => {
                const qty = Number(row.quantity) || 0;
                const price = Number(String(row.price || "").replace(",", "."));
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
                        <option value="">-- Select item --</option>
                        {items.map((it) => (
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
                        type="text"
                        className="form__input form__input--sm"
                        value={row.price}
                        onChange={(e) =>
                          handleRowChange(index, "price", e.target.value)
                        }
                        placeholder="0"
                      />
                    </td>
                    <td style={{ textAlign: "right" }}>
                      {lineTotal.toLocaleString("ru-RU", {
                        minimumFractionDigits: 0,
                        maximumFractionDigits: 2,
                      })}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn btn--ghost btn--icon"
                        onClick={() => handleRemoveRow(index)}
                      >
                        x
                      </button>
                    </td>
                  </tr>
                );
              }}
              renderCardMobile={({ row, index }) => {
                const qty = Number(row.quantity) || 0;
                const price = Number(String(row.price || "").replace(",", "."));
                const lineTotal =
                  !Number.isNaN(price) && price >= 0 ? qty * price : 0;
                const selectedItem = items.find(
                  (it) => String(it.id) === String(row.itemId)
                );

                return (
                  <MobileCard>
                    <div className="mobile-card__title">
                      {selectedItem?.name || `Line ${index + 1}`}
                    </div>
                    <div className="mobile-card__fields">
                      <label style={{ display: "grid", gap: 6 }}>
                        Item
                        <select
                          className="form__select form__select--sm"
                          value={row.itemId || ""}
                          onChange={(e) =>
                            handleSelectItem(index, e.target.value)
                          }
                        >
                          <option value="">-- Select item --</option>
                          {items.map((it) => (
                            <option key={it.id} value={it.id}>
                              {it.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label style={{ display: "grid", gap: 6 }}>
                        Qty
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
                      </label>
                      <label style={{ display: "grid", gap: 6 }}>
                        Unit
                        <input
                          type="text"
                          className="form__input form__input--sm"
                          value={row.unit}
                          onChange={(e) =>
                            handleRowChange(index, "unit", e.target.value)
                          }
                        />
                      </label>
                      <label style={{ display: "grid", gap: 6 }}>
                        Price
                        <input
                          type="text"
                          className="form__input form__input--sm"
                          value={row.price}
                          onChange={(e) =>
                            handleRowChange(index, "price", e.target.value)
                          }
                          placeholder="0"
                        />
                      </label>
                      <div style={{ fontSize: 14, fontWeight: 600 }}>
                        Total: {lineTotal.toLocaleString("ru-RU", {
                          minimumFractionDigits: 0,
                          maximumFractionDigits: 2,
                        })}
                      </div>
                    </div>
                    <MobileActions>
                      <button
                        type="button"
                        className="btn btn--ghost"
                        onClick={() => handleRemoveRow(index)}
                      >
                        Remove
                      </button>
                    </MobileActions>
                  </MobileCard>
                );
              }}
              wrapperClassName="table-wrapper po-table-wrapper"
            />

            <div style={{ marginTop: 8 }}>
              <button
                type="button"
                className="btn btn--secondary btn--sm"
                onClick={handleAddRow}
              >
                + Add line
              </button>
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