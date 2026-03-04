import React from "react";

export default function ItemCard({ item, qty, onRemove }) {
  const imageUrl = String(item?.imageUrl || "").trim();

  return (
    <div className="tsd-card">
      <div className="tsd-card__item">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={item?.name || "\u0422\u043e\u0432\u0430\u0440"}
            className="tsd-card__image"
            loading="lazy"
          />
        ) : null}
        <div className="tsd-card__body">
          <div className="tsd-card__title">{item?.name || "\u0422\u043e\u0432\u0430\u0440"}</div>
          <div className="tsd-card__meta">
            {[item?.sku && `SKU: ${item.sku}`, item?.barcode && `\u0428\u041a: ${item.barcode}`]
              .filter(Boolean)
              .join(" | ")}
          </div>
        </div>
      </div>
      {Number.isFinite(qty) && <div className="tsd-card__badge">{qty}</div>}
      {onRemove && (
        <button type="button" className="tsd-card__remove" onClick={onRemove}>
          x
        </button>
      )}
    </div>
  );
}
