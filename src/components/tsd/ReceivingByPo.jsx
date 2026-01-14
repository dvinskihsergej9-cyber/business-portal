import { useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "../../apiConfig";
import Scanner from "./Scanner";
import Stepper from "./Stepper";
import TsdHeader from "./TsdHeader";

const STEPS = ["Заказ", "Товары", "Подтверждение"];

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
  const [itemSearch, setItemSearch] = useState("");
  const [filterMode, setFilterMode] = useState("remaining");
  const [selectedPo, setSelectedPo] = useState(null);
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
  const [signalsEnabled, setSignalsEnabled] = useState(() => {
    const saved = localStorage.getItem("tsdSignalsEnabled");
    return saved === null ? true : saved === "true";
  });

  const audioCtxRef = useRef(null);
  const rowRefs = useRef({});
  const toastTimerRef = useRef(null);
  const highlightTimerRef = useRef(null);
  const userActivatedRef = useRef(false);

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
        localAcceptedQty,
        acceptedTotal,
        expectedRemaining,
        remaining,
        status,
      };
    });
  }, [selectedPo, localAccepted]);

  const filteredRows = useMemo(() => {
    const query = itemSearch.trim().toLowerCase();
    return orderRows.filter((row) => {
      if (filterMode === "remaining" && row.remaining <= 0) return false;
      if (filterMode === "accepted" && row.acceptedTotal <= 0) return false;
      if (!query) return true;
      const name = String(row.item?.name || "").toLowerCase();
      const sku = String(row.item?.sku || "").toLowerCase();
      const barcode = String(row.item?.barcode || "").toLowerCase();
      return (
        name.includes(query) ||
        sku.includes(query) ||
        barcode.includes(query)
      );
    });
  }, [orderRows, itemSearch, filterMode]);

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

  const hasAccepted = useMemo(
    () => orderRows.some((row) => row.localAcceptedQty > 0),
    [orderRows]
  );

  const discrepancies = useMemo(() => {
    return orderRows.filter(
      (row) =>
        row.localAcceptedQty > 0 &&
        row.localAcceptedQty !== row.expectedRemaining
    );
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
      const res = await apiFetch("/warehouse/receiving/open-pos", {
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
        error: err.message,
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
    setItemSearch("");
    setFilterMode("remaining");
    setHighlightedItemId(null);
    setToast(null);
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
    const res = await apiFetch(
      `/warehouse/scan/resolve?code=${encodeURIComponent(code)}`,
      { headers: authHeaders }
    );
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.message || "Код не найден");
    }
    return data;
  };

  const handleSelectPo = (po) => {
    setSelectedPo(po);
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
      setLocalAccepted((prev) => ({
        ...prev,
        [item.id]: (Number(prev[item.id]) || 0) + 1,
      }));
      pulseHighlight(item.id);
      setToast({
        type: "success",
        message: `Принято: ${item.name} +1`,
      });
      playBeepSuccess();
      safeVibrate(40);
      setTimeout(() => {
        rowRefs.current[item.id]?.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
      }, 50);
      setState((prev) => ({ ...prev, loading: false }));
    } catch (err) {
      setState((prev) => ({ ...prev, loading: false, error: err.message }));
    }
  };

  const handleQtyChange = (itemId, nextQty) => {
    setLocalAccepted((prev) => ({
      ...prev,
      [itemId]: Number.isFinite(nextQty) && nextQty >= 0 ? nextQty : 0,
    }));
  };


  const openPrintAct = async (poId) => {
    const printRes = await apiFetch(
      `/purchase-orders/${poId}/print-receive-act`,
      { headers: authHeaders }
    );
    if (printRes.status === 204) return;
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
    const win = window.open("", "_blank");
    if (win) {
      win.document.write(html);
      win.document.close();
    }
  };

  const ensureOrgProfileAndPrint = async (poId) => {
    const res = await apiFetch("/settings/org-profile", {
      headers: authHeaders,
    });
    if (res.status === 403) {
      const data = await res.json();
      throw new Error(data.message || "NO_ACCESS");
    }
    const data = await res.json();
    if (res.ok && data?.profile) {
      await openPrintAct(poId);
      return;
    }
    setOrgForm({
      orgName: "",
      legalAddress: "",
      actualAddress: "",
      inn: "",
      kpp: "",
      phone: "",
    });
    setOrgFormError("");
    setPendingPrintPoId(poId);
    setOrgModalOpen(true);
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
    try {
      setState((prev) => ({ ...prev, loading: true, error: "" }));
      const opId = makeOpId("POREC");
      const res = await apiFetch(
        `/warehouse/receiving/${selectedPo.id}/confirm`,
        {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            opId,
            lines: payloadLines,
          }),
        }
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || "Не удалось подтвердить приемку");
      }
      const updatedOrder = data.order || selectedPo;
      setSelectedPo(updatedOrder);
      setToast({ type: "success", message: "Приемка завершена." });

      const shortageRows = (updatedOrder?.items || []).filter(
        (row) => Number(row.quantity) > Number(row.receivedQty || 0)
      );

      if (shortageRows.length > 0) {
        try {
          await ensureOrgProfileAndPrint(updatedOrder.id);
        } catch (printErr) {
          setState((prev) => ({
            ...prev,
            error: printErr.message || "PRINT_ACT_ERROR",
          }));
        }
      }

      setState((prev) => ({
        ...prev,
        loading: false,
        done: true,
        step: 2,
      }));

    } catch (err) {
      setState((prev) => ({ ...prev, loading: false, error: err.message }));
    }
  };

  const resetFlow = () => {
    setSelectedPo(null);
    setLocalAccepted({});
    setItemSearch("");
    setFilterMode("remaining");
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
        {state.error && (
          <div className="tsd-alert tsd-alert--error">{state.error}</div>
        )}

        {state.step === 0 && (
          <>
            <div className="tsd-card">
              <div className="tsd-card__body">
                <div className="tsd-card__title">Открытые заказы</div>
                <div className="tsd-card__meta">
                  Выберите заказ поставщику для приемки.
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
                  <button
                    key={po.id}
                    type="button"
                    className="tsd-card"
                    onClick={() => handleSelectPo(po)}
                  >
                    <div className="tsd-card__body">
                      <div className="tsd-card__title">Заказ №{po.number}</div>
                      <div className="tsd-card__meta">
                        {po.supplier?.name || "Поставщик не указан"}
                      </div>
                      <div className="tsd-card__meta">
                        {po.items?.length || 0} позиций ? {percent}% принято
                      </div>
                    </div>
                  </button>
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

              <div className="tsd-scan-actions">
                <button
                  type="button"
                  className="tsd-btn tsd-btn--primary"
                  onClick={() => {
                    if (!hasAccepted) {
                      setState((prev) => ({
                        ...prev,
                        error: "Добавь хотя бы одну позицию.",
                      }));
                      return;
                    }
                    setState((prev) => ({ ...prev, step: 2 }));
                  }}
                >
                  Далее
                </button>
              </div>

            </div>

            <div className="tsd-card tsd-receiving-summary">
              <div className="tsd-card__body">
                <div className="tsd-card__title">Позиции заказа</div>
                <div className="tsd-card__meta">
                  Принято {progressSummary.acceptedLines} / {progressSummary.totalLines} (позиций), количество: {progressSummary.qtyAccepted} / {progressSummary.qtyOrdered}
                </div>
              </div>
              <div className="tsd-receiving-controls">
                <input
                  className="tsd-input"
                  placeholder="Поиск по названию, SKU или штрихкоду"
                  value={itemSearch}
                  onChange={(event) => setItemSearch(event.target.value)}
                />
                <div className="tsd-receiving-filters">
                  <button
                    type="button"
                    className={
                      "tsd-chip" +
                      (filterMode === "all" ? " tsd-chip--active" : "")
                    }
                    onClick={() => setFilterMode("all")}
                  >
                    Все
                  </button>
                  <button
                    type="button"
                    className={
                      "tsd-chip" +
                      (filterMode === "remaining" ? " tsd-chip--active" : "")
                    }
                    onClick={() => setFilterMode("remaining")}
                  >
                    Осталось принять
                  </button>
                  <button
                    type="button"
                    className={
                      "tsd-chip" +
                      (filterMode === "accepted" ? " tsd-chip--active" : "")
                    }
                    onClick={() => setFilterMode("accepted")}
                  >
                    Уже принято
                  </button>
                </div>
              </div>
            </div>

            <div className="tsd-list">
              {filteredRows.map((row) => (
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
                      {[row.item?.sku && `SKU: ${row.item.sku}`, row.item?.barcode]
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
                    <div className="tsd-receiving-line__pulse">+1</div>
                  )}
                  <input
                    className="tsd-input"
                    type="number"
                    min="0"
                    value={row.localAcceptedQty}
                    onChange={(event) =>
                      handleQtyChange(row.itemId, Number(event.target.value))
                    }
                  />
                </div>
              ))}
            </div>
          </>
        )}

        {state.step === 2 && (
          <>
            <div className="tsd-list">
              {orderRows.map((row) => (
                <div key={row.itemId} className="tsd-card">
                  <div className="tsd-card__body">
                    <div className="tsd-card__title">{row.item?.name || `Товар #${row.itemId}`}</div>
                    <div className="tsd-card__meta">Заказано: {row.orderedQty} ? Принято: {row.acceptedTotal} ? Осталось: {row.remaining}</div>
                  </div>
                </div>
              ))}
            </div>
            {discrepancies.length > 0 && (
              <div className="tsd-alert tsd-alert--error">Расхождения: {discrepancies.length} позиций.</div>
            )}
            {!state.done && (
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
            )}
            {state.done && (
              <div className="tsd-alert tsd-alert--success">Приемка завершена.</div>
            )}
          </>
        )}
      </div>

      {state.done && (
        <div className="tsd-action-bar">
          <button
            type="button"
            className="tsd-btn tsd-btn--primary"
            onClick={resetFlow}
          >
            Следующий заказ
          </button>
        </div>
      )}


      {orgModalOpen && (
        <div className="tsd-modal">
          <div className="tsd-modal__card">
            <div className="tsd-modal__title">
              Реквизиты получателя
            </div>
            <div className="tsd-modal__text">
              Заполните данные один раз — они будут подставляться в акт.
            </div>
            {orgFormError && (
              <div className="tsd-alert tsd-alert--error">{orgFormError}</div>
            )}
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
                  setOrgModalOpen(false);
                  setPendingPrintPoId(null);
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
                    setOrgSaving(true);
                    setOrgFormError("");
                    const res = await apiFetch("/settings/org-profile", {
                      method: "PUT",
                      headers: authHeaders,
                      body: JSON.stringify(orgForm),
                    });
                    const data = await res.json();
                    if (!res.ok) {
                      throw new Error(data.message || "ORG_PROFILE_SAVE_ERROR");
                    }
                    setOrgSaving(false);
                    setOrgModalOpen(false);
                    if (pendingPrintPoId) {
                      await openPrintAct(pendingPrintPoId);
                      setPendingPrintPoId(null);
                    }
                  } catch (saveErr) {
                    setOrgSaving(false);
                    setOrgFormError(saveErr.message || "ORG_PROFILE_SAVE_ERROR");
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
