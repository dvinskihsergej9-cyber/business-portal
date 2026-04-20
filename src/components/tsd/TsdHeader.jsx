import React from "react";

export default function TsdHeader({
  title,
  subtitle,
  contextLabel,
  contextValue,
  onChangeContext,
  onBack,
  showBackButton = true,
  rightSlot,
}) {
  return (
    <div className="tsd-header">
      <div className="tsd-header__top">
        {showBackButton && typeof onBack === "function" ? (
          <button type="button" className="tsd-back" onClick={onBack}>
            Назад
          </button>
        ) : (
          <span />
        )}

        <div className="tsd-header__titles">
          <span className="tsd-header__chip">TSD Flow</span>
          <div className="tsd-header__title">{title}</div>
          {subtitle ? <div className="tsd-header__subtitle">{subtitle}</div> : null}
        </div>

        {rightSlot ? <div className="tsd-header__slot">{rightSlot}</div> : <span />}
      </div>

      {contextValue ? (
        <div className="tsd-header__context">
          <div className="tsd-header__context-main">
            <div className="tsd-header__context-label">{contextLabel}</div>
            <div className="tsd-header__context-value">{contextValue}</div>
          </div>
          {onChangeContext ? (
            <button
              type="button"
              className="tsd-btn tsd-btn--ghost"
              onClick={onChangeContext}
            >
              Сменить
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
