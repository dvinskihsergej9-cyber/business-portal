import React from "react";

export default function ItemCard({ item, qty, onRemove }) {
  return (
    <div className="tsd-card">
      <div className="tsd-card__body">
        <div className="tsd-card__title">{item?.name || "Товар"}</div>
        <div className="tsd-card__meta">
          {[item?.sku && `SKU: ${item.sku}`, item?.barcode && `ШК: ${item.barcode}`]
            .filter(Boolean)
            .join(" • ")}
        </div>
      </div>
      {Number.isFinite(qty) && (
        <div className="tsd-card__badge">{qty}</div>
      )}
      {onRemove && (
        <button type="button" className="tsd-card__remove" onClick={onRemove}>
          ✕
        </button>
      )}
    </div>
  );
}
