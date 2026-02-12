import React, { useRef, useState, useEffect, useCallback } from "react";

export default function Scanner({
  label,
  hint,
  onScan,
  manualPlaceholder = "Ввести код вручную",
  disabled = false,
  onUserAction,
}) {
  const scannerRef = useRef(null);
  const videoRef = useRef(null);
  const startingRef = useRef(false);
  const [manualValue, setManualValue] = useState("");
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState("");

  const stopScanner = useCallback(() => {
    startingRef.current = false;
    const scanner = scannerRef.current;
    if (scanner) {
      try {
        scanner.reset();
      } catch {
        // ignore
      }
      scannerRef.current = null;
    }
    setCameraActive(false);
  }, []);

  const startScanner = useCallback(async () => {
    if (scannerRef.current || startingRef.current) return;
    startingRef.current = true;
    setCameraError("");

    try {
      if (!window.isSecureContext) {
        throw new Error("Камера работает только по HTTPS.");
      }
      if (!navigator?.mediaDevices?.getUserMedia) {
        throw new Error("Браузер не поддерживает доступ к камере.");
      }

      setCameraActive(true);

      let attempts = 0;
      while (!videoRef.current && attempts < 20) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
        attempts += 1;
      }
      if (!videoRef.current) {
        throw new Error("Не удалось подготовить область камеры.");
      }

      await new Promise((resolve) => setTimeout(resolve, 120));

      const module = await import("@zxing/browser");
      const ReaderClass =
        module.BrowserMultiFormatReader ||
        module.default?.BrowserMultiFormatReader ||
        module.default;
      if (!ReaderClass) {
        throw new Error("Сканер недоступен в этом браузере.");
      }

      const scanner = new ReaderClass();
      scannerRef.current = scanner;

      scanner
        .decodeFromVideoDevice(undefined, videoRef.current, (result) => {
          if (!result) return;
          const text =
            typeof result.getText === "function"
              ? result.getText()
              : String(result || "");
          if (!text.trim()) return;
          onScan(text);
          stopScanner();
        })
        .catch((err) => {
          if (!scannerRef.current) return;
          console.error(err);
          const reason = err?.name ? ` (${err.name})` : "";
          setCameraError(`Не удалось запустить камеру.${reason}`);
          stopScanner();
        })
        .finally(() => {
          startingRef.current = false;
        });
    } catch (err) {
      console.error(err);
      startingRef.current = false;
      const message = String(err?.message || "").trim();
      if (message) {
        setCameraError(message);
      } else {
        const reason = err?.name ? ` (${err.name})` : "";
        setCameraError(`Не удалось запустить камеру.${reason}`);
      }
      stopScanner();
    }
  }, [onScan, stopScanner]);

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
          <video
            ref={videoRef}
            className="tsd-scanner__camera"
            autoPlay
            muted
            playsInline
          />
        ) : (
          <div className="tsd-scanner__placeholder">Камера выключена</div>
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
