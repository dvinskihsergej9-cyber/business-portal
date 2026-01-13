import React, { useMemo, useRef, useState, useEffect } from "react";

export default function Scanner({
  label,
  hint,
  onScan,
  manualPlaceholder = "Ввести код вручную",
  disabled = false,
  onUserAction,
}) {
  const scannerId = useMemo(
    () => `tsd-scan-${Math.random().toString(36).slice(2)}`,
    []
  );
  const scannerRef = useRef(null);
  const [manualValue, setManualValue] = useState("");
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState("");

  useEffect(() => {
    let scanner = null;
    let cancelled = false;

    const startScanner = async () => {
      try {
        const module = await import("html5-qrcode");
        const Html5Qrcode = module.Html5Qrcode;
        if (cancelled) return;

        scanner = new Html5Qrcode(scannerId);
        scannerRef.current = scanner;

        await scanner.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 240, height: 240 } },
          (decodedText) => {
            if (cancelled) return;
            onScan(decodedText);
            setCameraActive(false);
          },
          () => {}
        );
      } catch (err) {
        console.error(err);
        setCameraError("Не удалось запустить камеру.");
        setCameraActive(false);
      }
    };

    if (cameraActive) {
      setCameraError("");
      startScanner();
    }

    return () => {
      cancelled = true;
      if (scanner) {
        scanner
          .stop()
          .then(() => scanner.clear())
          .catch(() => {});
      }
      scannerRef.current = null;
    };
  }, [cameraActive, onScan, scannerId]);

  const handleManualSubmit = (event) => {
    event.preventDefault();
    const code = manualValue.trim();
    if (!code) return;
    if (onUserAction) onUserAction();
    onScan(code);
    setManualValue("");
  };

  return (
    <div className="tsd-scanner">
      <div className="tsd-scanner__header">
        <div>
          <div className="tsd-scanner__label">{label}</div>
          {hint && <div className="tsd-scanner__hint">{hint}</div>}
        </div>
        <button
          type="button"
          className="tsd-btn tsd-btn--secondary"
          onClick={() => {
            if (onUserAction) onUserAction();
            setCameraActive((prev) => !prev);
          }}
          disabled={disabled}
        >
          {cameraActive ? "Стоп" : "Камера"}
        </button>
      </div>

      <div className="tsd-scanner__viewport">
        {cameraActive ? (
          <div id={scannerId} className="tsd-scanner__camera" />
        ) : (
          <div className="tsd-scanner__placeholder">
            Камера выключена
          </div>
        )}
      </div>

      {cameraError && <div className="tsd-alert tsd-alert--error">{cameraError}</div>}

      <form className="tsd-manual" onSubmit={handleManualSubmit}>
        <input
          className="tsd-input"
          value={manualValue}
          onChange={(event) => setManualValue(event.target.value)}
          placeholder={manualPlaceholder}
          disabled={disabled}
        />
        <button
          type="submit"
          className="tsd-btn tsd-btn--primary"
          disabled={disabled}
        >
          ОК
        </button>
      </form>
    </div>
  );
}
