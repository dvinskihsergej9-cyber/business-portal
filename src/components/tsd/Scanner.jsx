import React, { useMemo, useRef, useState, useEffect, useCallback } from "react";
import { Html5Qrcode as Html5QrcodeLib } from "html5-qrcode";
import TsdErrorAlert from "./TsdErrorAlert";

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

  const getHtml5QrcodeClass = useCallback(() => {
    if (typeof window !== "undefined" && window?.Html5Qrcode) {
      return window.Html5Qrcode;
    }
    return Html5QrcodeLib;
  }, []);

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
      if (!navigator?.mediaDevices?.getUserMedia) {
        throw new Error("CAMERA_UNSUPPORTED");
      }
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
      await new Promise((resolve) => setTimeout(resolve, 200));

      let scanner = scannerRef.current;
      const Html5QrcodeClass = getHtml5QrcodeClass();
      if (!Html5QrcodeClass) throw new Error("Html5QrcodeUnavailable");

      if (!scanner) {
        scanner = new Html5QrcodeClass(scannerId);
        scannerRef.current = scanner;
      }

      const handleSuccess = (decodedText) => {
        onScan(decodedText);
        stopScanner();
      };
      const handleError = () => {};
      const scanConfig = { fps: 10, qrbox: { width: 240, height: 240 } };

      const tryStart = async (cameraConfig) => {
        await scanner.start(cameraConfig, scanConfig, handleSuccess, handleError);
      };

      let started = false;
      let lastError = null;
      const attempts = [
        { facingMode: { exact: "environment" } },
        { facingMode: "environment" },
        { facingMode: "user" },
      ];

      for (const attempt of attempts) {
        try {
          await tryStart(attempt);
          started = true;
          break;
        } catch (err) {
          lastError = err;
        }
      }

      if (!started && typeof Html5QrcodeClass.getCameras === "function") {
        try {
          const cameras = await Html5QrcodeClass.getCameras();
          const preferredCameraId =
            cameras?.find((cam) =>
              /back|rear|environment/i.test(String(cam?.label || ""))
            )?.id || cameras?.[0]?.id;
          if (preferredCameraId) {
            await tryStart(preferredCameraId);
            started = true;
          }
        } catch (err) {
          lastError = err;
        }
      }

      if (!started) {
        throw lastError || new Error("CAMERA_START_FAILED");
      }
    } catch (err) {
      console.error(err);
      const errCode = String(err?.message || err?.name || "").toLowerCase();
      if (errCode.includes("camera_unsupported")) {
        setCameraError("Камера не поддерживается в этом браузере.");
      } else if (errCode.includes("notallowed")) {
        setCameraError("Нет доступа к камере. Разрешите доступ в настройках Safari.");
      } else if (errCode.includes("secure")) {
        setCameraError("Камера работает только по защищенному HTTPS-соединению.");
      } else {
        const reason = err?.name ? ` (${err.name})` : "";
        setCameraError(`Не удалось запустить камеру.${reason}`);
      }
      await stopScanner();
    }
  }, [getHtml5QrcodeClass, onScan, scannerId, stopScanner]);

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
          <div className="tsd-scanner__placeholder">Камера выключена</div>
        )}
      </div>

      <TsdErrorAlert message={cameraError} />

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
