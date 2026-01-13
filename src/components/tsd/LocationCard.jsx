import React from "react";

export default function LocationCard({ location }) {
  return (
    <div className="tsd-card tsd-card--location">
      <div className="tsd-card__body">
        <div className="tsd-card__title">{location?.name || "Ячейка"}</div>
        <div className="tsd-card__meta">
          {[location?.code && `Код: ${location.code}`, location?.qrCode]
            .filter(Boolean)
            .join(" • ")}
        </div>
      </div>
    </div>
  );
}
