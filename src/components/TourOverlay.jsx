import { useEffect, useMemo, useState } from "react";

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export default function TourOverlay({ steps, onFinish, onSkip }) {
  const [index, setIndex] = useState(0);
  const step = steps[index];

  const targetRect = useMemo(() => {
    if (!step || !step.selector) return null;
    const el = document.querySelector(step.selector);
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return rect.width && rect.height ? rect : null;
  }, [step]);

  useEffect(() => {
    if (!step) return;
    if (step.selector && !targetRect) {
      const id = window.setTimeout(() => {
        setIndex((prev) => Math.min(prev + 1, steps.length - 1));
      }, 300);
      return () => window.clearTimeout(id);
    }
  }, [step, targetRect, steps.length]);

  if (!step) return null;

  const handleNext = () => {
    if (index >= steps.length - 1) {
      onFinish?.();
      return;
    }
    setIndex((prev) => prev + 1);
  };

  const tooltipWidth = Math.min(window.innerWidth - 24, 340);
  const tooltipHeight = 180;
  const margin = 12;

  let tooltipTop = window.innerHeight / 2 - tooltipHeight / 2;
  let tooltipLeft = (window.innerWidth - tooltipWidth) / 2;

  if (targetRect) {
    const below = targetRect.bottom + 12;
    const above = targetRect.top - tooltipHeight - 12;
    tooltipTop = below + tooltipHeight < window.innerHeight
      ? below
      : Math.max(above, margin);
    tooltipLeft = clamp(
      targetRect.left,
      margin,
      window.innerWidth - tooltipWidth - margin
    );
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 2000,
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(15, 23, 42, 0.55)",
        }}
      />

      {targetRect && (
        <div
          style={{
            position: "absolute",
            top: targetRect.top - 6,
            left: targetRect.left - 6,
            width: targetRect.width + 12,
            height: targetRect.height + 12,
            borderRadius: 12,
            boxShadow: "0 0 0 9999px rgba(15, 23, 42, 0.55)",
            border: "2px solid rgba(59, 130, 246, 0.8)",
            background: "rgba(255,255,255,0.02)",
            pointerEvents: "none",
          }}
        />
      )}

      <div
        style={{
          position: "fixed",
          top: tooltipTop,
          left: tooltipLeft,
          width: tooltipWidth,
          background: "#ffffff",
          borderRadius: 14,
          padding: "14px 16px",
          boxShadow: "0 18px 40px rgba(15, 23, 42, 0.28)",
          zIndex: 2001,
          display: "grid",
          gap: 8,
        }}
      >
        <div style={{ fontWeight: 700 }}>{step.title}</div>
        <div style={{ fontSize: 13, color: "#475569" }}>{step.text}</div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={onSkip}
            style={{
              background: "transparent",
              color: "#64748b",
              border: "1px solid #e2e8f0",
            }}
          >
            {"\u041f\u0440\u043e\u043f\u0443\u0441\u0442\u0438\u0442\u044c"}
          </button>
          <button
            type="button"
            onClick={handleNext}
            style={{
              background: "#2563eb",
              color: "#ffffff",
              border: "none",
            }}
          >
            {index >= steps.length - 1
              ? "\u0413\u043e\u0442\u043e\u0432\u043e"
              : "\u0414\u0430\u043b\u0435\u0435"}
          </button>
        </div>
      </div>
    </div>
  );
}