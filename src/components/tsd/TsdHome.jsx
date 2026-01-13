import React from "react";

export default function TsdHome({ modes, onSelect }) {
  return (
    <div className="tsd-home">
      <div className="tsd-home__header">
        <div className="tsd-home__title">Мобильный ТСД</div>
        <div className="tsd-home__subtitle">
          Выберите режим и следуйте шагам.
        </div>
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
