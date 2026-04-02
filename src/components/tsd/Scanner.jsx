import React, { useMemo, useRef, useState, useEffect, useCallback } from "react";
import {
  Html5Qrcode as Html5QrcodeLib,
  Html5QrcodeSupportedFormats as Html5QrcodeSupportedFormatsLib,
} from "html5-qrcode";
import TsdErrorAlert from "./TsdErrorAlert";

export default function Scanner({
  label,
  hint,
  onScan,
  manualPlaceholder = "Ввести код вручную",
  disabled = false,
  autoStart = false,
  onUserAction,
  scanKind = "mixed",
  showManual = true,
}) {
  const scannerId = useMemo(
    () => `tsd-scan-${Math.random().toString(36).slice(2)}`,
    []
  );
  const scannerRef = useRef(null);
  const viewportRef = useRef(null);
  const focusBusyRef = useRef(false);
  const focusUnsupportedRef = useRef(false);
  const focusPulseTimeoutRef = useRef(null);
  const [manualValue, setManualValue] = useState("");
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [focusPulse, setFocusPulse] = useState(false);
  const autoStartAttemptedRef = useRef(false);

  const getHtml5QrcodeClass = useCallback(() => {
    if (typeof window !== "undefined" && window?.Html5Qrcode) {
      return window.Html5Qrcode;
    }
    return Html5QrcodeLib;
  }, []);

  const getSupportedFormatsEnum = useCallback(() => {
    if (typeof window !== "undefined" && window?.Html5QrcodeSupportedFormats) {
      return window.Html5QrcodeSupportedFormats;
    }
    return Html5QrcodeSupportedFormatsLib;
  }, []);

  const normalizeDecodedText = useCallback((value) => {
    const raw = String(value || "");
    return raw
      .replace(/^\]C1/i, "")
      .replace(/\u001d/g, "")
      .trim();
  }, []);

  const buildScanConfig = useCallback(() => {
    const formatsEnum = getSupportedFormatsEnum();
    const resolveFormat = (key) =>
      formatsEnum && Object.prototype.hasOwnProperty.call(formatsEnum, key)
        ? formatsEnum[key]
        : null;

    const qrFormats = ["QR_CODE"];
    const barcodeFormats = [
      "EAN_13",
      "EAN_8",
      "UPC_A",
      "UPC_E",
      "CODE_128",
      "CODE_39",
      "CODE_93",
      "ITF",
      "CODABAR",
      "UPC_EAN_EXTENSION",
    ];

    const requestedKeys =
      scanKind === "qr"
        ? qrFormats
        : scanKind === "barcode"
          ? barcodeFormats
          : [...qrFormats, ...barcodeFormats];

    const formatsToSupport = requestedKeys
      .map(resolveFormat)
      .filter((value) => Number.isInteger(value));

    const viewportRect = viewportRef.current?.getBoundingClientRect?.() || null;
    const fallbackWidth =
      typeof window !== "undefined" ? Math.max(300, Math.floor(window.innerWidth * 0.92)) : 360;
    const fallbackHeight =
      typeof window !== "undefined" ? Math.max(260, Math.floor(window.innerHeight * 0.36)) : 320;
    const viewportWidth = Math.max(260, Math.floor(viewportRect?.width || fallbackWidth));
    const viewportHeight = Math.max(220, Math.floor(viewportRect?.height || fallbackHeight));

    const barcodeBox = {
      width: Math.min(520, Math.floor(viewportWidth * 0.9)),
      height: Math.max(140, Math.min(220, Math.floor(viewportHeight * 0.38))),
    };
    const mixedBox = {
      width: Math.min(460, Math.floor(viewportWidth * 0.86)),
      height: Math.max(180, Math.min(300, Math.floor(viewportHeight * 0.7))),
    };
    const qrSize = Math.max(220, Math.min(360, Math.floor(viewportWidth * 0.76)));

    const scanConfig = {
      fps: 14,
      qrbox:
        scanKind === "barcode"
          ? barcodeBox
          : scanKind === "mixed"
            ? mixedBox
            : { width: qrSize, height: qrSize },
      experimentalFeatures: { useBarCodeDetectorIfSupported: true },
      rememberLastUsedCamera: true,
    };

    if (formatsToSupport.length) {
      scanConfig.formatsToSupport = formatsToSupport;
    }

    return scanConfig;
  }, [getSupportedFormatsEnum, scanKind]);

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
    focusUnsupportedRef.current = false;
  }, []);

  const requestCameraFocus = useCallback(async (clientX, clientY) => {
    if (focusBusyRef.current) return;
    const viewport = viewportRef.current;
    if (!viewport) return;

    const rect = viewport.getBoundingClientRect();
    if (!rect?.width || !rect?.height) return;

    const pointX = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const pointY = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height));
    setFocusPulse(true);
    if (focusPulseTimeoutRef.current) {
      clearTimeout(focusPulseTimeoutRef.current);
    }
    focusPulseTimeoutRef.current = setTimeout(() => setFocusPulse(false), 260);

    const videoElement = viewport.querySelector("video");
    const mediaStream = videoElement?.srcObject;
    const track = mediaStream?.getVideoTracks?.()?.[0] || null;
    if (!track) return;

    const capabilities = typeof track.getCapabilities === "function" ? track.getCapabilities() : {};
    const focusModes = Array.isArray(capabilities?.focusMode) ? capabilities.focusMode : [];

    const advanced = [];
    if (focusModes.includes("single-shot")) {
      advanced.push({ focusMode: "single-shot" });
    } else if (focusModes.includes("continuous")) {
      advanced.push({ focusMode: "continuous" });
    } else if (focusModes.includes("manual")) {
      advanced.push({ focusMode: "manual" });
    }

    const canUsePointOfInterest =
      Object.prototype.hasOwnProperty.call(capabilities || {}, "pointsOfInterest") ||
      Object.prototype.hasOwnProperty.call(capabilities || {}, "pointOfInterest");

    const focusConstraints = {};
    if (advanced.length) {
      focusConstraints.advanced = advanced;
    }
    if (canUsePointOfInterest) {
      focusConstraints.pointsOfInterest = [{ x: pointX, y: pointY }];
    }

    if (!Object.keys(focusConstraints).length) {
      if (!focusUnsupportedRef.current) {
        setCameraError("Фокус по касанию не поддерживается этой камерой.");
        focusUnsupportedRef.current = true;
      }
      return;
    }

    focusBusyRef.current = true;
    try {
      await track.applyConstraints(focusConstraints);
      if (
        cameraError === "Фокус по касанию не поддерживается этой камерой." ||
        cameraError === "Не удалось изменить фокус камеры."
      ) {
        setCameraError("");
      }
    } catch {
      if (!focusUnsupportedRef.current) {
        setCameraError("Не удалось изменить фокус камеры.");
        focusUnsupportedRef.current = true;
      }
    } finally {
      focusBusyRef.current = false;
    }
  }, [cameraError]);

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
        const normalizedCode = normalizeDecodedText(decodedText);
        if (!normalizedCode) return;
        onScan(normalizedCode);
        stopScanner();
      };
      const handleError = () => {};
      const scanConfig = buildScanConfig();
      const applyContinuousAutofocus = async () => {
        try {
          const viewport = viewportRef.current;
          const videoElement = viewport?.querySelector("video");
          const mediaStream = videoElement?.srcObject;
          const track = mediaStream?.getVideoTracks?.()?.[0] || null;
          if (!track || typeof track.getCapabilities !== "function") return;
          const capabilities = track.getCapabilities() || {};
          const focusModes = Array.isArray(capabilities.focusMode) ? capabilities.focusMode : [];
          if (!focusModes.includes("continuous")) return;
          await track.applyConstraints({
            advanced: [{ focusMode: "continuous" }],
          });
        } catch {
          // ignore autofocus unsupported errors
        }
      };

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

      await applyContinuousAutofocus();
    } catch (err) {
      console.error(err);
      const errCode = String(err?.message || err?.name || "").toLowerCase();
      if (errCode.includes("camera_unsupported")) {
        setCameraError("Камера не поддерживается в этом браузере.");
      } else if (errCode.includes("notallowed")) {
        setCameraError("Нет доступа к камере. Разрешите доступ в настройках браузера.");
      } else if (errCode.includes("secure")) {
        setCameraError("Камера работает только по защищенному HTTPS-соединению.");
      } else {
        const reason = err?.name ? ` (${err.name})` : "";
        setCameraError(`Не удалось запустить камеру.${reason}`);
      }
      await stopScanner();
    }
  }, [
    buildScanConfig,
    getHtml5QrcodeClass,
    normalizeDecodedText,
    onScan,
    scannerId,
    stopScanner,
  ]);

  useEffect(() => {
    return () => {
      if (focusPulseTimeoutRef.current) {
        clearTimeout(focusPulseTimeoutRef.current);
      }
      stopScanner();
    };
  }, [stopScanner]);

  useEffect(() => {
    if (!autoStart) {
      autoStartAttemptedRef.current = false;
      return;
    }
    if (disabled || cameraActive || scannerRef.current) return;
    if (autoStartAttemptedRef.current) return;
    autoStartAttemptedRef.current = true;
    startScanner();
  }, [autoStart, disabled, cameraActive, startScanner]);

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

      <div
        ref={viewportRef}
        className={`tsd-scanner__viewport ${cameraActive ? "tsd-scanner__viewport--camera" : ""} ${
          focusPulse ? "tsd-scanner__viewport--focus-pulse" : ""
        }`}
        onClick={
          cameraActive
            ? (event) => {
                void requestCameraFocus(event.clientX, event.clientY);
              }
            : undefined
        }
        title={cameraActive ? "Нажмите для фокусировки" : undefined}
      >
        {cameraActive ? (
          <>
            <div id={scannerId} className="tsd-scanner__camera" />
            <div className="tsd-scanner__frame" />
            <div className="tsd-scanner__focus-tip">Нажмите для фокуса</div>
          </>
        ) : (
          <div className="tsd-scanner__placeholder">Камера выключена</div>
        )}
      </div>

      <TsdErrorAlert message={cameraError} />

      {showManual ? (
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
            Ввести
          </button>
        </form>
      ) : null}
    </div>
  );
}
