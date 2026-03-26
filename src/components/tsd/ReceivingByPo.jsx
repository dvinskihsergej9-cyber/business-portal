import { useEffect, useMemo, useRef, useState } from "react";
import { API_BASE, normalizeErrorMessage } from "../../apiConfig";
import {
  openHtmlDocumentInNewTab,
  prepareDocumentTab,
} from "../../utils/openInNewTab";
import Scanner from "./Scanner";
import Stepper from "./Stepper";
import TsdHeader from "./TsdHeader";
import TsdErrorAlert from "./TsdErrorAlert";

const STEPS = ["Заказ", "Товары"];
const QUEUE_STATUS_LABELS = {
  IN_QUEUE: "В очереди",
  UNLOADING: "На разгрузке",
  DONE: "Закрыта",
};

const emptyState = {
  step: 0,
  loading: false,
  error: "",
  done: false,
};

export default function ReceivingByPo({ authHeaders, makeOpId, onBack }) {
  const [state, setState] = useState(emptyState);
  const [poList, setPoList] = useState([]);
  const [poSearch, setPoSearch] = useState("");
  const [selectedPo, setSelectedPo] = useState(null);
  const [takingPoId, setTakingPoId] = useState(null);
  const [localAccepted, setLocalAccepted] = useState({});
  const [highlightedItemId, setHighlightedItemId] = useState(null);
  const [toast, setToast] = useState(null);
  const [orgModalOpen, setOrgModalOpen] = useState(false);
  const [orgForm, setOrgForm] = useState({
    orgName: "",
    legalAddress: "",
    actualAddress: "",
    inn: "",
    kpp: "",
    phone: "",
  });
  const [orgFormError, setOrgFormError] = useState("");
  const [orgSaving, setOrgSaving] = useState(false);
  const [pendingPrintPoId, setPendingPrintPoId] = useState(null);
  const pendingPrintWindowRef = useRef(null);
  const [signalsEnabled, setSignalsEnabled] = useState(() => {
    const saved = localStorage.getItem("tsdSignalsEnabled");
    return saved === null ? true : saved === "true";
  });

  const audioCtxRef = useRef(null);
  const rowRefs = useRef({});
  const qtyInputRefs = useRef({});
  const toastTimerRef = useRef(null);
  const highlightTimerRef = useRef(null);
  const userActivatedRef = useRef(false);
  const confirmFlowRef = useRef({ poId: null, opId: null, saved: false });

  const poItemsById = useMemo(() => {
    const map = new Map();
    if (!selectedPo?.items) return map;
    selectedPo.items.forEach((row) => {
      map.set(row.itemId, row);
    });
    return map;
  }, [selectedPo]);

  const filteredPos = useMemo(() => {
    const query = poSearch.trim().toLowerCase();
    if (!query) return poList;
    return poList.filter((po) => {
      const number = String(po.number || "").toLowerCase();
      const supplier = String(po.supplier?.name || "").toLowerCase();
      return number.includes(query) || supplier.includes(query);
    });
  }, [poList, poSearch]);

  const orderRows = useMemo(() => {
    if (!selectedPo?.items) return [];
    return selectedPo.items.map((row) => {
      const item =
        row.item || {
          id: row.itemId,
          name: row.name,
          sku: row.sku,
          barcode: row.barcode,
          unit: row.unit,
        };
      const orderedQty = Number(row.orderedQty ?? row.quantity) || 0;
      const receivedQty = Number(row.receivedQty) || 0;
      const hasLocalAccepted = Object.prototype.hasOwnProperty.call(
        localAccepted,
        row.itemId
      );
      const localAcceptedInput = hasLocalAccepted
        ? localAccepted[row.itemId]
        : "";
      const localAcceptedQty = Number(localAccepted[row.itemId]) || 0;
      const expectedRemaining = Math.max(0, orderedQty - receivedQty);
      const acceptedTotal = receivedQty + localAcceptedQty;
      const remaining = Math.max(0, orderedQty - acceptedTotal);
      const status =
        acceptedTotal <= 0
          ? "NEW"
          : remaining <= 0
            ? "DONE"
            : "PARTIAL";

      return {
        item,
        itemId: row.itemId,
        orderedQty,
        receivedQty,
        localAcceptedInput,
        localAcceptedQty,
        acceptedTotal,
        expectedRemaining,
        remaining,
        status,
      };
    });
  }, [selectedPo, localAccepted]);

  const remainingRowsCount = useMemo(
    () => orderRows.filter((row) => row.remaining > 0).length,
    [orderRows]
  );
  const unfilledRowsCount = useMemo(
    () =>
      orderRows.filter((row) => {
        if (row.expectedRemaining <= 0) return false;
        return !Object.prototype.hasOwnProperty.call(localAccepted, row.itemId);
      }).length,
    [orderRows, localAccepted]
  );
  const canFinishReceiving = useMemo(
    () =>
      Boolean(selectedPo) &&
      orderRows.length > 0 &&
      unfilledRowsCount === 0,
    [orderRows.length, unfilledRowsCount, selectedPo]
  );

  const progressSummary = useMemo(() => {
    const totalLines = orderRows.length;
    const acceptedLines = orderRows.filter((row) => row.acceptedTotal > 0).length;
    const qtyAccepted = orderRows.reduce(
      (sum, row) => sum + row.acceptedTotal,
      0
    );
    const qtyOrdered = orderRows.reduce((sum, row) => sum + row.orderedQty, 0);
    return {
      totalLines,
      acceptedLines,
      qtyAccepted,
      qtyOrdered,
    };
  }, [orderRows]);

  useEffect(() => {
    localStorage.setItem("tsdSignalsEnabled", String(signalsEnabled));
  }, [signalsEnabled]);

  useEffect(() => {
    if (!toast) return;
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = setTimeout(() => {
      setToast(null);
    }, 1700);
    return () => {
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current);
      }
    };
  }, [toast]);

  const reloadOpenPos = async () => {
    try {
      setState((prev) => ({ ...prev, loading: true, error: "" }));
      const res = await fetch(`${API_BASE}/warehouse/receiving/open-pos`, {
        headers: authHeaders,
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || "Не удалось загрузить заказы");
      }
      setPoList(Array.isArray(data) ? data : []);
      setState((prev) => ({ ...prev, loading: false }));
    } catch (err) {
      setState((prev) => ({
        ...prev,
        loading: false,
        error: toUiError(err, "Не удалось загрузить заказы для приёмки."),
      }));
    }
  };

  useEffect(() => {
    reloadOpenPos();
  }, [authHeaders]);

  useEffect(() => {
    if (!selectedPo) return;
    setState((prev) => ({ ...prev, step: 1, error: "", done: false }));
    setLocalAccepted({});
    setHighlightedItemId(null);
    setToast(null);
    confirmFlowRef.current = { poId: selectedPo.id, opId: null, saved: false };
  }, [selectedPo]);

  const safeVibrate = (pattern) => {
    if (!signalsEnabled) return;
    if (navigator?.vibrate) {
      navigator.vibrate(pattern);
    }
  };

  const unlockAudio = () => {
    if (userActivatedRef.current) return;
    userActivatedRef.current = true;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      if (!audioCtxRef.current) {
        audioCtxRef.current = new AudioContext();
      }
      if (audioCtxRef.current.state === "suspended") {
        audioCtxRef.current.resume();
      }
    } catch (err) {
      // ignore audio init errors
    }
  };

  const playBeep = (frequency, durationMs, startAt = 0) => {
    if (!signalsEnabled) return;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    if (!audioCtxRef.current) {
      audioCtxRef.current = new AudioContext();
    }
    const ctx = audioCtxRef.current;
    const now = ctx.currentTime + startAt;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.2, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + durationMs / 1000);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + durationMs / 1000 + 0.02);
  };

  const playBeepSuccess = () => {
    playBeep(920, 120);
  };

  const playBeepError = () => {
    playBeep(220, 120);
    playBeep(180, 120, 0.16);
  };

  const pulseHighlight = (itemId) => {
    if (highlightTimerRef.current) {
      clearTimeout(highlightTimerRef.current);
    }
    setHighlightedItemId(itemId);
    highlightTimerRef.current = setTimeout(() => {
      setHighlightedItemId(null);
    }, 1500);
  };

  const resolveScan = async (code) => {
    const res = await fetch(
      `${API_BASE}/warehouse/scan/resolve?code=${encodeURIComponent(code)}`,
      { headers: authHeaders }
    );
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.message || "Код не найден");
    }
    return data;
  };

  const toUiError = (err, fallback) => normalizeErrorMessage(err, fallback);

  const handleSelectPo = async (po) => {
    try {
      setTakingPoId(po.id);
      setState((prev) => ({ ...prev, loading: true, error: "" }));
      const res = await fetch(`${API_BASE}/warehouse/receiving/${po.id}/take`, {
        method: "POST",
        headers: authHeaders,
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.message || "Не удалось взять заказ в приёмку.");
      }
      const nextPo = {
        ...po,
        queue: data?.queue || po.queue || null,
      };
      setPoList((prev) =>
        prev.map((row) => (row.id === po.id ? nextPo : row))
      );
      setSelectedPo(nextPo);
      setState((prev) => ({ ...prev, loading: false, error: "" }));
    } catch (err) {
      setState((prev) => ({
        ...prev,
        loading: false,
        error: toUiError(err, "Не удалось взять заказ в приёмку."),
      }));
    } finally {
      setTakingPoId(null);
    }
  };

  const handleItemScan = async (code) => {
    try {
      unlockAudio();
      setState((prev) => ({ ...prev, loading: true, error: "" }));
      const data = await resolveScan(code);
      if (data.type !== "item") {
        setToast({
          type: "error",
          message: "Товар не найден",
        });
        playBeepError();
        safeVibrate([80, 40, 80]);
        throw new Error("Это не товар.");
      }
      const item = data.entity;
      if (!poItemsById.has(item.id)) {
        setToast({
          type: "error",
          message: "Товар не входит в заказ",
        });
        playBeepError();
        safeVibrate([80, 40, 80]);
        setState((prev) => ({ ...prev, loading: false }));
        return;
      }
      pulseHighlight(item.id);
      setToast({
        type: "success",
        message: `Товар найден: ${item.name}. Укажите количество.`,
      });
      playBeepSuccess();
      safeVibrate(40);
      setTimeout(() => {
        rowRefs.current[item.id]?.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
        const input = qtyInputRefs.current[item.id];
        if (input) {
          input.focus();
          input.select();
        }
      }, 50);
      setState((prev) => ({ ...prev, loading: false }));
    } catch (err) {
      setState((prev) => ({
        ...prev,
        loading: false,
        error: toUiError(err, "Ошибка сканирования товара."),
      }));
    }
  };

  const handleQtyChange = (itemId, rawValue) => {
    const value = String(rawValue ?? "").trim();
    setLocalAccepted((prev) => {
      if (!value.length) {
        const next = { ...prev };
        delete next[itemId];
        return next;
      }
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed < 0) {
        return prev;
      }
      return {
        ...prev,
        [itemId]: parsed,
      };
    });
  };


  const closeTabSafe = (tab) => {
    try {
      if (tab && tab !== window && !tab.closed) {
        tab.close();
      }
    } catch {
      // ignore
    }
  };

  const openPrintAct = async (
    poId,
    { required = false, targetWindow = null } = {}
  ) => {
    const printRes = await fetch(
      `${API_BASE}/purchase-orders/${poId}/print-receive-act`,
      { headers: authHeaders }
    );
    if (printRes.status === 204) {
      closeTabSafe(targetWindow);
      if (required) {
        throw new Error(
          "Недостача зафиксирована, но акт не сформирован. Обновите экран и повторите печать."
        );
      }
      return;
    }
    if (!printRes.ok) {
      let message = "PRINT_ACT_ERROR";
      try {
        const errData = await printRes.json();
        message = errData.message || message;
      } catch (e) {
        // ignore
      }
      throw new Error(message);
    }
    const html = await printRes.text();
    openHtmlDocumentInNewTab(html, {
      targetWindow,
    });
  };

  const openOrgProfileModalForAct = async (poId, targetWindow = null) => {
    const emptyProfile = {
      orgName: "",
      legalAddress: "",
      actualAddress: "",
      inn: "",
      kpp: "",
      phone: "",
    };
    setPendingPrintPoId(poId);
    pendingPrintWindowRef.current = targetWindow;
    setOrgFormError("");
    setOrgForm(emptyProfile);

    try {
      const profileRes = await fetch(`${API_BASE}/settings/org-profile`, {
        headers: authHeaders,
      });
      let profileData = null;
      try {
        profileData = await profileRes.json();
      } catch (parseErr) {
        profileData = null;
      }
      if (profileRes.status === 403) {
        throw new Error(
          "Для акта заполните реквизиты организации под администратором."
        );
      }
      if (!profileRes.ok) {
        throw new Error(profileData?.message || "ORG_PROFILE_GET_ERROR");
      }
      const profile = profileData?.profile || null;
      if (profile) {
        setOrgForm({
          orgName: profile.orgName || "",
          legalAddress: profile.legalAddress || "",
          actualAddress: profile.actualAddress || "",
          inn: profile.inn || "",
          kpp: profile.kpp || "",
          phone: profile.phone || "",
        });
      }
      setOrgModalOpen(true);
    } catch (err) {
      setPendingPrintPoId(null);
      pendingPrintWindowRef.current = null;
      closeTabSafe(targetWindow);
      throw err;
    }
  };

  const ensureOrgProfileAndPrint = async (poId, options = {}) => {
    try {
      await openPrintAct(poId, options);
      return true;
    } catch (err) {
      const code = String(err?.message || "");
      if (code === "ORG_PROFILE_REQUIRED") {
        await openOrgProfileModalForAct(poId, options?.targetWindow || null);
        return false;
      }
      throw err;
    }
  };

  const handleConfirm = async () => {
    if (!selectedPo) {
      setState((prev) => ({
        ...prev,
        error: "Сначала выберите заказ.",
      }));
      return;
    }
    const payloadLines = orderRows
      .filter((row) => row.localAcceptedQty > 0)
      .map((row) => ({
        productId: row.itemId,
        qty: Number(row.localAcceptedQty),
      }))
      .filter((row) => Number.isFinite(row.qty) && row.qty > 0);

    if (!payloadLines.length) {
      setState((prev) => ({
        ...prev,
        error: "Добавьте товары и количество.",
      }));
      return;
    }
    let actWindow = null;
    try {
      actWindow = prepareDocumentTab({ title: "Акт расхождений" });
      setState((prev) => ({ ...prev, loading: true, error: "" }));
      const flow = confirmFlowRef.current || {};
      const opId =
        flow.poId === selectedPo.id && flow.opId ? flow.opId : makeOpId("POREC");
      const isAlreadySaved =
        flow.poId === selectedPo.id && flow.opId === opId && flow.saved;

      let confirmData = null;
      if (!isAlreadySaved) {
        const confirmRes = await fetch(
          `${API_BASE}/warehouse/receiving/${selectedPo.id}/confirm`,
          {
            method: "POST",
            headers: authHeaders,
            body: JSON.stringify({
              opId,
              lines: payloadLines,
            }),
          }
        );
        try {
          confirmData = await confirmRes.json();
        } catch (parseErr) {
          confirmData = null;
        }
        if (!confirmRes.ok) {
          if (
            confirmData?.message === "PO_RECEIVING_CONFIRM_ERROR" &&
            confirmData?.detail
          ) {
            throw new Error(
              `Ошибка сервера при сохранении приемки: ${String(confirmData.detail)}`
            );
          }
          throw new Error(confirmData?.message || "Не удалось сохранить приемку");
        }
        confirmFlowRef.current = { poId: selectedPo.id, opId, saved: true };
      }

      const finalizeRes = await fetch(
        `${API_BASE}/warehouse/receiving/${selectedPo.id}/finalize`,
        {
          method: "POST",
          headers: authHeaders,
        }
      );
      let finalizeData = null;
      try {
        finalizeData = await finalizeRes.json();
      } catch (parseErr) {
        finalizeData = null;
      }
      if (!finalizeRes.ok) {
        if (
          finalizeData?.message === "PO_RECEIVING_FINALIZE_ERROR" &&
          finalizeData?.detail
        ) {
          throw new Error(
            `Ошибка сервера при завершении приемки: ${String(finalizeData.detail)}`
          );
        }
        throw new Error(
          finalizeData?.message || "Не удалось завершить приемку"
        );
      }

      const hasLocalShortage = orderRows.some(
        (row) => Number(row.acceptedTotal) < Number(row.orderedQty)
      );
      const hasDiscrepancies =
        hasLocalShortage ||
        (Array.isArray(confirmData?.discrepancies) &&
          confirmData.discrepancies.length > 0) ||
        String(finalizeData?.order?.status || "").toUpperCase() === "PARTIAL";
      let shouldLeaveScreen = true;

      if (hasDiscrepancies) {
        try {
          const printedNow = await ensureOrgProfileAndPrint(selectedPo.id, {
            required: true,
            targetWindow: actWindow,
          });
          if (!printedNow) {
            shouldLeaveScreen = false;
          }
        } catch (actErr) {
          closeTabSafe(actWindow);
          shouldLeaveScreen = false;
          setToast({
            type: "error",
            message: toUiError(actErr, "Акт не удалось открыть."),
          });
          setState((prev) => ({
            ...prev,
            error: toUiError(actErr, "Акт не удалось открыть."),
          }));
        }
      } else {
        closeTabSafe(actWindow);
      }

      confirmFlowRef.current = { poId: null, opId: null, saved: false };

      setState((prev) => ({
        ...prev,
        loading: false,
        done: shouldLeaveScreen,
      }));
      if (shouldLeaveScreen) {
        onBack?.();
      }

    } catch (err) {
      closeTabSafe(actWindow);
      setState((prev) => ({
        ...prev,
        loading: false,
        error: toUiError(err, "Не удалось подтвердить приёмку."),
      }));
    }
  };

  const resetFlow = () => {
    confirmFlowRef.current = { poId: null, opId: null, saved: false };
    setSelectedPo(null);
    setLocalAccepted({});
    setHighlightedItemId(null);
    setToast(null);
    setState(emptyState);
    reloadOpenPos();
  };

  return (
    <>
      <TsdHeader
        title="Приемка поставщиков"
        subtitle="Приемка по заказам поставщику"
        contextLabel="Заказ"
        contextValue={
          selectedPo
            ? `№${selectedPo.number}${selectedPo.supplier?.name ? ` · ${selectedPo.supplier.name}` : ""}`
            : null
        }
        onChangeContext={selectedPo ? resetFlow : null}
        onBack={onBack}
      />
      <Stepper steps={STEPS} activeIndex={state.step} />

      <div className="tsd-section">
        <TsdErrorAlert message={state.error} />

        {state.step === 0 && (
          <>
            <div className="tsd-card">
              <div className="tsd-card__body">
                <div className="tsd-card__title">Открытые заказы</div>
                <div className="tsd-card__meta">
                  Выберите заказ и нажмите «Взять в приёмку».
                </div>
              </div>
              <input
                className="tsd-input"
                placeholder="Поиск по номеру или поставщику"
                value={poSearch}
                onChange={(event) => setPoSearch(event.target.value)}
              />
            </div>

            {state.loading && (
              <div className="tsd-alert tsd-alert--success">Загрузка...</div>
            )}

            {!state.loading && filteredPos.length === 0 && (
              <div className="tsd-alert tsd-alert--success">
                Нет открытых заказов.
              </div>
            )}

            <div className="tsd-list">
              {filteredPos.map((po) => {
                const percent = Math.round((po.progress || 0) * 100);
                return (
                  <div key={po.id} className="tsd-card">
                    <div className="tsd-card__body">
                      <div className="tsd-card__title">Заказ №{po.number}</div>
                      <div className="tsd-card__meta">
                        {po.supplier?.name || "Поставщик не указан"}
                      </div>
                      <div className="tsd-card__meta">
                        {po.items?.length || 0} позиций ? {percent}% принято
                      </div>
                      <div className="tsd-card__meta">
                        Очередь:{" "}
                        {QUEUE_STATUS_LABELS[po.queue?.status] ||
                          po.queue?.status ||
                          "не указана"}
                      </div>
                    </div>
                    <div className="tsd-action-inline">
                      <button
                        type="button"
                        className="tsd-btn tsd-btn--primary"
                        onClick={() => handleSelectPo(po)}
                        disabled={state.loading || takingPoId === po.id}
                      >
                        {takingPoId === po.id ? "Берём..." : "Взять в приёмку"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {state.step === 1 && (
          <>
            <div className="tsd-inline tsd-inline--tight">
              <span className="tsd-muted">Сигналы</span>
              <button
                type="button"
                className="tsd-btn tsd-btn--ghost"
                onClick={() => {
                  unlockAudio();
                  setSignalsEnabled((prev) => !prev);
                }}
              >
                {signalsEnabled ? "ВКЛ" : "ВЫКЛ"}
              </button>
            </div>

            {toast && (
              <div
                className={
                  "tsd-toast" +
                  (toast.type === "error"
                    ? " tsd-toast--error"
                    : " tsd-toast--success")
                }
              >
                {toast.message}
              </div>
            )}

            <div
              className={
                "tsd-receiving-scan" +
                (toast?.type === "error" ? " tsd-receiving-scan--error" : "")
              }
            >
              <Scanner
                label="Сканируй товары"
                hint="Принимаем позиции из заказа"
                onScan={handleItemScan}
                disabled={state.loading}
                onUserAction={unlockAudio}
              />
            </div>

            <div className="tsd-card tsd-receiving-summary">
              <div className="tsd-card__body">
                <div className="tsd-card__title">Позиции заказа</div>
                <div className="tsd-card__meta">
                  Принято {progressSummary.acceptedLines} / {progressSummary.totalLines} (позиций), количество: {progressSummary.qtyAccepted} / {progressSummary.qtyOrdered}
                </div>
              </div>
            </div>

            <div className="tsd-list">
              {orderRows.map((row) => (
                <div
                  key={row.itemId}
                  className={
                    "tsd-card tsd-receiving-line" +
                    (highlightedItemId === row.itemId
                      ? " tsd-receiving-line--highlight"
                      : "")
                  }
                  ref={(node) => {
                    if (node) rowRefs.current[row.itemId] = node;
                  }}
                >
                  <div className="tsd-card__body">
                    <div className="tsd-card__title">
                      {row.item?.name || `Товар #${row.itemId}`}
                    </div>
                    <div className="tsd-card__meta">
                      {[row.item?.sku && `Артикул: ${row.item.sku}`, row.item?.barcode]
                        .filter(Boolean)
                        .join(" ? ")}
                    </div>
                    <div className="tsd-card__meta">
                      Заказано: {row.orderedQty} ? Принято: {row.acceptedTotal} ? Осталось: {row.remaining}
                    </div>
                  </div>
                  <div
                    className={
                      "tsd-receiving-status" +
                      (row.status === "DONE"
                        ? " tsd-receiving-status--done"
                        : row.status === "PARTIAL"
                          ? " tsd-receiving-status--partial"
                          : " tsd-receiving-status--new")
                    }
                  >
                    {row.status}
                  </div>
                  {highlightedItemId === row.itemId && (
                    <div className="tsd-receiving-line__pulse">Найдено</div>
                  )}
                  <input
                    className="tsd-input"
                    type="number"
                    min="0"
                    ref={(node) => {
                      if (node) qtyInputRefs.current[row.itemId] = node;
                    }}
                    value={row.localAcceptedInput}
                    onChange={(event) =>
                      handleQtyChange(row.itemId, event.target.value)
                    }
                  />
                </div>
              ))}
            </div>
            {canFinishReceiving ? (
              <div className="tsd-action-inline">
                <button
                  type="button"
                  className="tsd-btn tsd-btn--primary tsd-btn--center"
                  onClick={handleConfirm}
                  disabled={state.loading}
                >
                  {state.loading
                    ? "Сохранение..."
                    : "Завершить приемку"}
                </button>
              </div>
            ) : (
              <div className="tsd-alert tsd-alert--info">
                Осталось заполнить позиций: {unfilledRowsCount}
              </div>
            )}
          </>
        )}
      </div>


      {orgModalOpen && (
        <div className="tsd-modal">
          <div className="tsd-modal__card">
            <div className="tsd-modal__title">
              Реквизиты получателя
            </div>
            <div className="tsd-modal__text">
              Заполните данные один раз — они будут подставляться в акт.
            </div>
            <TsdErrorAlert message={orgFormError} />
            <div className="tsd-modal__grid">
              <div className="tsd-modal__row">
                <span className="tsd-modal__label">Организация</span>
                <input
                  className="tsd-input"
                  value={orgForm.orgName}
                  onChange={(event) =>
                    setOrgForm((prev) => ({
                      ...prev,
                      orgName: event.target.value,
                    }))
                  }
                />
              </div>
              <div className="tsd-modal__row">
                <span className="tsd-modal__label">Юридический адрес</span>
                <input
                  className="tsd-input"
                  value={orgForm.legalAddress}
                  onChange={(event) =>
                    setOrgForm((prev) => ({
                      ...prev,
                      legalAddress: event.target.value,
                    }))
                  }
                />
              </div>
              <div className="tsd-modal__row">
                <span className="tsd-modal__label">Фактический адрес</span>
                <input
                  className="tsd-input"
                  value={orgForm.actualAddress}
                  onChange={(event) =>
                    setOrgForm((prev) => ({
                      ...prev,
                      actualAddress: event.target.value,
                    }))
                  }
                />
              </div>
              <div className="tsd-modal__row">
                <span className="tsd-modal__label">ИНН</span>
                <input
                  className="tsd-input"
                  value={orgForm.inn}
                  onChange={(event) =>
                    setOrgForm((prev) => ({
                      ...prev,
                      inn: event.target.value,
                    }))
                  }
                />
              </div>
              <div className="tsd-modal__row">
                <span className="tsd-modal__label">КПП</span>
                <input
                  className="tsd-input"
                  value={orgForm.kpp}
                  onChange={(event) =>
                    setOrgForm((prev) => ({
                      ...prev,
                      kpp: event.target.value,
                    }))
                  }
                />
              </div>
              <div className="tsd-modal__row">
                <span className="tsd-modal__label">Телефон</span>
                <input
                  className="tsd-input"
                  value={orgForm.phone}
                  onChange={(event) =>
                    setOrgForm((prev) => ({
                      ...prev,
                      phone: event.target.value,
                    }))
                  }
                />
              </div>
            </div>
            <div className="tsd-modal__actions">
              <button
                type="button"
                className="tsd-btn tsd-btn--secondary"
                onClick={() => {
                  closeTabSafe(pendingPrintWindowRef.current);
                  setOrgModalOpen(false);
                  setPendingPrintPoId(null);
                  pendingPrintWindowRef.current = null;
                }}
                disabled={orgSaving}
              >
                Отмена
              </button>
              <button
                type="button"
                className="tsd-btn tsd-btn--primary"
                onClick={async () => {
                  if (
                    !orgForm.orgName ||
                    !orgForm.legalAddress ||
                    !orgForm.actualAddress ||
                    !orgForm.inn ||
                    !orgForm.kpp
                  ) {
                    setOrgFormError("Заполните обязательные поля.");
                    return;
                  }
                  try {
                    const printWindow = pendingPrintPoId
                      ? pendingPrintWindowRef.current && !pendingPrintWindowRef.current.closed
                        ? pendingPrintWindowRef.current
                        : prepareDocumentTab({ title: "Акт расхождений" })
                      : null;
                    if (pendingPrintPoId && !printWindow) {
                      setOrgFormError("Не удалось открыть документ. Разрешите всплывающие окна для портала.");
                      return;
                    }
                    pendingPrintWindowRef.current = printWindow;

                    setOrgSaving(true);
                    setOrgFormError("");
                    const res = await fetch(`${API_BASE}/settings/org-profile`, {
                      method: "PUT",
                      headers: authHeaders,
                      body: JSON.stringify(orgForm),
                    });
                    const data = await res.json();
                    if (!res.ok) {
                      throw new Error(data.message || "ORG_PROFILE_SAVE_ERROR");
                    }
                    if (pendingPrintPoId) {
                      await openPrintAct(pendingPrintPoId, {
                        targetWindow: pendingPrintWindowRef.current || null,
                      });
                    }
                    setPendingPrintPoId(null);
                    pendingPrintWindowRef.current = null;
                    setOrgSaving(false);
                    setOrgModalOpen(false);
                  } catch (saveErr) {
                    setOrgSaving(false);
                    setOrgFormError(
                      toUiError(
                        saveErr,
                        "Не удалось сохранить реквизиты организации."
                      )
                    );
                  }
                }}
                disabled={orgSaving}
              >
                {orgSaving
                  ? "Сохранение..."
                  : "Сохранить"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
