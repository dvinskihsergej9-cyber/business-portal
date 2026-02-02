import React, { useMemo, useRef, useState, useEffect, useCallback } from "react";

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

  const stopScanner = useCallback(async () => {
    const scanner = scannerRef.current;
    if (scanner) {
      try {
        await scanner.stop();
      } catch {
        // ignore
      }
      try {
        await scanner.clear();
      } catch {
        // ignore
      }
      scannerRef.current = null;
    }
    setCameraActive(false);
  }, []);

  const startScanner = useCallback(async () => {
    if (scannerRef.current) return;
    setCameraError("");
    try {
      setCameraActive(true);

      const waitForElement = async () => {
        let tries = 0;
        while (tries < 10) {
          const el = document.getElementById(scannerId);
          if (el) return;
          await new Promise((resolve) => requestAnimationFrame(resolve));
          tries += 1;
        }
      };

      await waitForElement();

      let scanner = scannerRef.current;
      if (!scanner) {
        if (window?.Html5Qrcode) {
          scanner = new window.Html5Qrcode(scannerId);
        } else {
          const module = await import("html5-qrcode");
          const Html5Qrcode = module.Html5Qrcode || module.default?.Html5Qrcode || module.default;
          if (!Html5Qrcode) throw new Error("Html5QrcodeUnavailable");
          scanner = new Html5Qrcode(scannerId);
        }
        scannerRef.current = scanner;
      }

      await scanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 240, height: 240 } },
        (decodedText) => {
          onScan(decodedText);
          stopScanner();
        },
        () => {}
      );
    } catch (err) {
      console.error(err);
      const reason = err?.name ? ` (${err.name})` : "";
      setCameraError(`Не удалось запустить камеру.${reason}`);
      await stopScanner();
    }
  }, [onScan, scannerId, stopScanner]);

  useEffect(() => {
    return () => {
      stopScanner();
    };
  }, [stopScanner]);

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
            if (cameraActive) {
              stopScanner();
            } else {
              startScanner();
            }
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
