import React from "react";

export default function TsdHome({ modes, onSelect }) {
  return (
    <div className="tsd-home">
      <div className="tsd-home__hero">
        <span className="tsd-home__chip">Mobile WMS</span>
        <h1 className="tsd-home__title">Мобильный ТСД</h1>
        <p className="tsd-home__subtitle">
          Выберите рабочий режим. Дизайн и структура унифицированы для всех TSD-функций.
        </p>
      </div>

      <div className="tsd-home__grid">
        {modes.map((mode) => (
          <button
            key={mode.id}
            type="button"
            className="tsd-tile"
            onClick={() => onSelect(mode.id)}
          >
            <div className="tsd-tile__icon">{mode.icon}</div>
            <div className="tsd-tile__title">{mode.title}</div>
            <div className="tsd-tile__subtitle">{mode.subtitle}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
