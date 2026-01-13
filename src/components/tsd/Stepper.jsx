import React from "react";

export default function Stepper({ steps, activeIndex }) {
  return (
    <div className="tsd-stepper">
      {steps.map((step, index) => {
        const isActive = index === activeIndex;
        const isDone = index < activeIndex;
        return (
          <div
            key={step}
            className={
              "tsd-stepper__step" +
              (isActive ? " tsd-stepper__step--active" : "") +
              (isDone ? " tsd-stepper__step--done" : "")
            }
          >
            <div className="tsd-stepper__dot">
              {isDone ? "✓" : index + 1}
            </div>
            <div className="tsd-stepper__label">{step}</div>
          </div>
        );
      })}
    </div>
  );
}
