import React from "react";

export default function TsdHeader({
  title,
  subtitle,
  contextLabel,
  contextValue,
  onChangeContext,
  onBack,
  rightSlot,
}) {
  return (
    <div className="tsd-header">
      <div className="tsd-header__top">
        <button type="button" className="tsd-back" onClick={onBack}>
          Назад
        </button>
        <div className="tsd-header__titles">
          <div className="tsd-header__title">{title}</div>
          {subtitle && <div className="tsd-header__subtitle">{subtitle}</div>}
        </div>
        {rightSlot && <div className="tsd-header__slot">{rightSlot}</div>}
      </div>

      {contextValue && (
        <div className="tsd-header__context">
          <div className="tsd-header__context-label">{contextLabel}</div>
          <div className="tsd-header__context-value">{contextValue}</div>
          {onChangeContext && (
            <button
              type="button"
              className="tsd-btn tsd-btn--ghost"
              onClick={onChangeContext}
            >
              Сменить
            </button>
          )}
        </div>
      )}
    </div>
  );
}
