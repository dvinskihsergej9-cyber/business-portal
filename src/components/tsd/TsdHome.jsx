import React from "react";

export default function TsdHome({ modes, onSelect }) {
  return (
    <div className="tsd-home">

      <div className="tsd-home__grid">
        {modes.map((mode) => (
          <button
            key={mode.id}
            type="button"
            className="tsd-tile"
            onClick={() => onSelect(mode.id)}
          >
            <div className="tsd-tile__title">{mode.title}</div>
            <div className="tsd-tile__subtitle">{mode.subtitle}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
