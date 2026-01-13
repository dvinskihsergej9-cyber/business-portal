// src/pages/Hr/Templates.jsx
import React from "react";

export default function Templates() {
  return (
    <div className="content-block">
      <h2>Шаблоны табеля</h2>

      <p className="muted" style={{ marginBottom: 16 }}>
        Шаблоны Excel с макросами. Откройте файл в Excel и сохраните себе
        локальную копию.
      </p>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 10,
          maxWidth: 420,
        }}
      >
        <a
          className="btn"
          href="/templates/tabel_ktu.xlsm"
          download="tabel_ktu.xlsm"
        >
          ⬇ Табель (КТУ)
        </a>

        <a
          className="btn"
          href="/templates/Табель Фин.Отдела.xlsm"
          download="Табель Фин.Отдела.xlsm"
        >
          ⬇ Табель (фин. отдел / денежный)
        </a>
      </div>
    </div>
  );
}
