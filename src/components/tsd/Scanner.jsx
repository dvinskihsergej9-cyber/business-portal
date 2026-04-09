import React, { useMemo, useRef, useState, useEffect, useCallback } from "react";
import {
  Html5Qrcode as Html5QrcodeLib,
  Html5QrcodeSupportedFormats as Html5QrcodeSupportedFormatsLib,
} from "html5-qrcode";
import TsdErrorAlert from "./TsdErrorAlert";

const CAMERA_MISSING_SUPPRESS_KEY = "tsd:scanner:no-camera:auto-suppressed";

function readNoCameraAutoSuppressFlag() {
  try {
    if (typeof window === "undefined" || !window.sessionStorage) return false;
    return window.sessionStorage.getItem(CAMERA_MISSING_SUPPRESS_KEY) === "1";
  } catch {
    return false;
  }
}

function writeNoCameraAutoSuppressFlag(value) {
  try {
    if (typeof window === "undefined" || !window.sessionStorage) return;
    if (value) {
      window.sessionStorage.setItem(CAMERA_MISSING_SUPPRESS_KEY, "1");
    } else {
      window.sessionStorage.removeItem(CAMERA_MISSING_SUPPRESS_KEY);
    }
  } catch {
    // ignore storage errors
  }
}

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
  const [manualValue, setManualValue] = useState("");
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [suppressAutoNoCamera, setSuppressAutoNoCamera] = useState(readNoCameraAutoSuppressFlag);
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
      typeof window !== "undefined" ? Math.max(320, Math.floor(window.innerWidth * 0.96)) : 380;
    const fallbackHeight =
      typeof window !== "undefined" ? Math.max(300, Math.floor(window.innerHeight * 0.52)) : 360;
    const viewportWidth = Math.max(280, Math.floor(viewportRect?.width || fallbackWidth));
    const viewportHeight = Math.max(260, Math.floor(viewportRect?.height || fallbackHeight));

    const barcodeBox = {
      width: Math.min(640, Math.floor(viewportWidth * 0.96)),
      height: Math.max(180, Math.min(360, Math.floor(viewportHeight * 0.72))),
    };
    const mixedBox = {
      width: Math.min(620, Math.floor(viewportWidth * 0.94)),
      height: Math.max(220, Math.min(420, Math.floor(viewportHeight * 0.86))),
    };
    const qrSize = Math.max(260, Math.min(440, Math.floor(viewportWidth * 0.92)));

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
  }, []);

  const startScanner = useCallback(async ({ manual = false } = {}) => {
    if (!manual && suppressAutoNoCamera) return;
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

      if (suppressAutoNoCamera) {
        writeNoCameraAutoSuppressFlag(false);
        setSuppressAutoNoCamera(false);
      }
      await applyContinuousAutofocus();
    } catch (err) {
      console.error(err);
      const errCode = String(err?.message || err?.name || "").toLowerCase();
      const noCameraDetected =
        errCode.includes("notfound") ||
        errCode.includes("device not found") ||
        errCode.includes("devicesnotfound") ||
        errCode.includes("no camera");
      if (noCameraDetected) {
        writeNoCameraAutoSuppressFlag(true);
        setSuppressAutoNoCamera(true);
        if (manual || !suppressAutoNoCamera) {
          setCameraError("Камера не найдена на устройстве.");
        }
      } else if (errCode.includes("camera_unsupported")) {
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
    suppressAutoNoCamera,
    stopScanner,
  ]);

  useEffect(() => {
    return () => {
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
    startScanner({ manual: false });
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
              startScanner({ manual: true });
            }
          }}
          disabled={disabled}
        >
          {cameraActive ? "Стоп" : "Камера"}
        </button>
      </div>

      <div
        ref={viewportRef}
        className={`tsd-scanner__viewport ${cameraActive ? "tsd-scanner__viewport--camera" : ""}`}
      >
        {cameraActive ? (
          <>
            <div id={scannerId} className="tsd-scanner__camera" />
            <div className="tsd-scanner__frame" />
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
