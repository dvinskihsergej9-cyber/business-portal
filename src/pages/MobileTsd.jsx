import { useEffect, useMemo, useState } from "react";
import { API_BASE } from "../apiConfig";
import TsdHome from "../components/tsd/TsdHome";
import TsdHeader from "../components/tsd/TsdHeader";
import Stepper from "../components/tsd/Stepper";
import Scanner from "../components/tsd/Scanner";
import ItemCard from "../components/tsd/ItemCard";
import LocationCard from "../components/tsd/LocationCard";
import StockDiscrepanciesTab from "../components/StockDiscrepanciesTab";
import "../components/tsd/tsd.css";

const MODES = [
  {
    id: "receiving",
    title: "Приемка",
    subtitle: "Поставки от поставщиков",
    icon: "RCV",
  },
  {
    id: "putaway",
    title: "Размещение",
    subtitle: "От приемки в ячейку",
    icon: "PUT",
  },
  {
    id: "move",
    title: "Перемещение",
    subtitle: "Между ячейками",
    icon: "MOVE",
  },
  {
    id: "count",
    title: "Инвентаризация",
    subtitle: "Проверка остатков по ячейке",
    icon: "INV",
  },
  {
    id: "bin",
    title: "Контроль ячейки",
    subtitle: "Список остатков",
    icon: "BIN",
  },
  {
    id: "replenish",
    title: "Подпитка",
    subtitle: "Перемещение в ячейки отбора",
    icon: "REP",
  },
  {
    id: "pick",
    title: "Отбор",
    subtitle: "Списание из ячейки",
    icon: "PCK",
  },
  {
    id: "discrepancies",
    title: "Косяки",
    subtitle: "Расхождения и проблемы",
    icon: "ERR",
  },
];

const COUNT_STEPS = ["Ячейка", "Товар", "Количество", "Подтверждение"];
const RECEIVING_STEPS = ["Товар", "Даты", "Подтверждение"];
const BIN_STEPS = ["Ячейка", "Остатки", "Расхождения"];
const MOVE_STEPS = ["Откуда", "Товар", "Кол-во", "Куда", "Подтверждение"];
const PUTAWAY_STEPS = ["Товар", "Ячейка", "Подтверждение"];
const REPLENISH_STEPS = ["Откуда", "Товар", "Кол-во", "Куда", "Подтверждение"];
const PICK_STEPS = ["Ячейка", "Товар", "Кол-во", "Подтверждение"];

  const emptyCountState = {
    step: 0,
    location: null,
    item: null,
    qty: "",
    mode: "AUTO",
    manufacturedAt: "",
    expiresAt: "",
    allowDifferentDate: false,
    delta: null,
    receivingLineId: null,
    placing: false,
    placeDone: false,
    placeError: "",
    loading: false,
    error: "",
    done: false,
  };

const emptyReceivingState = {
  step: 0,
  lines: [],
  loading: false,
  error: "",
  done: false,
};

const emptyBinState = {
  step: 0,
  sessionId: null,
  location: null,
  items: [],
  counts: {},
  loading: false,
  error: "",
  done: false,
  discrepancySaved: false,
};

const emptyMoveState = {
  step: 0,
  from: null,
  item: null,
  qty: "",
  to: null,
  loading: false,
  error: "",
  done: false,
};

const emptyPutawayState = {
  step: 0,
  pending: [],
  selected: null,
  selectedQty: "",
  to: null,
  loading: false,
  error: "",
  done: false,
};

const emptyReplenState = {
  step: 0,
  from: null,
  item: null,
  qty: "",
  to: null,
  loading: false,
  error: "",
  done: false,
};

const emptyPickState = {
  step: 0,
  from: null,
  item: null,
  qty: "",
  loading: false,
  error: "",
  done: false,
};

export default function MobileTsd() {
  const [mode, setMode] = useState(null);
  const [countState, setCountState] = useState(emptyCountState);
  const [countLocations, setCountLocations] = useState([]);
  const [receivingState, setReceivingState] = useState(emptyReceivingState);
  const [binState, setBinState] = useState(emptyBinState);
  const [moveState, setMoveState] = useState(emptyMoveState);
  const [putawayState, setPutawayState] = useState(emptyPutawayState);
  const [replenState, setReplenState] = useState(emptyReplenState);
  const [pickState, setPickState] = useState(emptyPickState);

  const authHeaders = useMemo(() => {
    const token = localStorage.getItem("token");
    return {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
  }, []);

  const makeOpId = (prefix) => {
    if (globalThis.crypto?.randomUUID) {
      return `${prefix}-${globalThis.crypto.randomUUID()}`;
    }
    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  };

  useEffect(() => {
    if (!mode) return;
    setCountState(emptyCountState);
    setReceivingState(emptyReceivingState);
    setBinState(emptyBinState);
    setMoveState(emptyMoveState);
    setPutawayState(emptyPutawayState);
    setReplenState(emptyReplenState);
    setPickState(emptyPickState);
  }, [mode]);

  useEffect(() => {
    if (mode !== "count") return;
    const loadLocations = async () => {
      try {
        const res = await fetch(`${API_BASE}/warehouse/locations`, {
          headers: authHeaders,
        });
        const data = await res.json();
        if (res.ok && Array.isArray(data)) {
          setCountLocations(data);
        }
      } catch {
        // ignore
      }
    };
    loadLocations();
  }, [mode, authHeaders]);

  useEffect(() => {
    if (mode !== "bin") return;
    if (binState.sessionId) return;
    const startSession = async () => {
      try {
        const res = await fetch(
          `${API_BASE}/warehouse/bin-audit/session/start`,
          { method: "POST", headers: authHeaders }
        );
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.message || "Не удалось стартовать сессию");
        }
        setBinState((prev) => ({ ...prev, sessionId: data.sessionId }));
      } catch (err) {
        setBinState((prev) => ({ ...prev, error: err.message }));
      }
    };
    startSession();
  }, [mode, binState.sessionId, authHeaders]);

  useEffect(() => {
    if (mode !== "putaway") return;
    const loadPending = async () => {
      try {
        setPutawayState((prev) => ({
          ...prev,
          loading: true,
          error: "",
        }));
        const res = await fetch(`${API_BASE}/warehouse/putaway/pending`, {
          headers: authHeaders,
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.message || "Не удалось загрузить размещение");
        }
        setPutawayState((prev) => ({
          ...prev,
          pending: data.items || [],
          loading: false,
        }));
      } catch (err) {
        setPutawayState((prev) => ({
          ...prev,
          error: err.message,
          loading: false,
        }));
      }
    };
    loadPending();
  }, [mode, authHeaders]);


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

  const handleCountLocation = async (code) => {
    try {
      setCountState((prev) => ({ ...prev, loading: true, error: "" }));
      const data = await resolveScan(code);
      if (data.type !== "location") {
        throw new Error("Это не ячейка.");
      }
      setCountState((prev) => ({
        ...prev,
        location: data.entity,
        step: 1,
        allowDifferentDate: false,
        loading: false,
      }));
    } catch (err) {
      setCountState((prev) => ({
        ...prev,
        error: err.message,
        loading: false,
      }));
    }
  };

  const handleCountItem = async (code) => {
    try {
      setCountState((prev) => ({ ...prev, loading: true, error: "" }));
      const data = await resolveScan(code);
      if (data.type !== "item") {
        throw new Error("Это не товар.");
      }
      setCountState((prev) => ({
        ...prev,
        item: data.entity,
        step: 2,
        allowDifferentDate: false,
        loading: false,
      }));
    } catch (err) {
      setCountState((prev) => ({
        ...prev,
        error: err.message,
        loading: false,
      }));
    }
  };

  const handleCountSubmit = async () => {
    const qty = Number(countState.qty);
    if (!Number.isFinite(qty) || qty < 0) {
      setCountState((prev) => ({
        ...prev,
        error: "Введите количество.",
      }));
      return;
    }
    if (countState.mode === "PLUS") {
      if (!countState.manufacturedAt) {
        setCountState((prev) => ({
          ...prev,
          error: "Укажите дату изготовления.",
        }));
        return;
      }
    }
    try {
      setCountState((prev) => ({ ...prev, loading: true, error: "" }));
      const opId = makeOpId("COUNT");
      const res = await fetch(`${API_BASE}/warehouse/inventory/count`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          opId,
          locationId: countState.location.id,
          itemId: countState.item.id,
          qty,
          inventoryType: countState.mode,
          manufacturedAt: countState.manufacturedAt || null,
          expiresAt: countState.expiresAt || countState.manufacturedAt || null,
          allowDifferentDate: countState.allowDifferentDate,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.code === "COUNT_ITEM_NOT_IN_LOCATION") {
          throw new Error("В этой ячейке нет такого товара.");
        }
        if (data.code === "COUNT_CELL_NOT_EMPTY") {
          throw new Error("Ячейка не пустая. Нельзя добавить новый товар.");
        }
        if (data.code === "COUNT_DATE_MISMATCH") {
          setCountState((prev) => ({
            ...prev,
            allowDifferentDate: true,
          }));
          throw new Error(
            "В ячейке есть этот товар с другой датой. Повторите подтверждение, если уверены."
          );
        }
        if (data.message === "MANUFACTURED_AT_REQUIRED") {
          throw new Error("Укажите дату изготовления для пересчета в плюс.");
        }
        if (data.code === "COUNT_PLUS_ONLY") {
          throw new Error("Выбран пересчет в плюс, а разница в минус. Выберите другой тип.");
        }
        if (data.code === "COUNT_MINUS_ONLY") {
          throw new Error("Выбран пересчет в минус, а разница в плюс. Выберите другой тип.");
        }
        throw new Error(data.message || "Не удалось сохранить пересчет");
      }
      setCountState((prev) => ({
        ...prev,
        loading: false,
        done: true,
        step: 3,
        delta: data.delta ?? null,
        receivingLineId: data.receivingLineId ?? null,
        placeDone: false,
        placeError: "",
      }));
    } catch (err) {
      setCountState((prev) => ({
        ...prev,
        error: err.message,
        loading: false,
      }));
    }
  };
  const handleReceivingItem = async (code) => {
    try {
      setReceivingState((prev) => ({ ...prev, loading: true, error: "" }));
      const data = await resolveScan(code);
      if (data.type !== "item") {
        throw new Error("Это не товар.");
      }
      setReceivingState((prev) => {
        const existsIndex = prev.lines.findIndex(
          (line) => line.item.id === data.entity.id
        );
        let nextLines = [...prev.lines];
        if (existsIndex >= 0) {
          nextLines[existsIndex] = {
            ...nextLines[existsIndex],
            qty: nextLines[existsIndex].qty + 1,
          };
        } else {
          nextLines.push({
            item: data.entity,
            qty: 1,
            manufacturedAt: "",
            expiresAt: "",
          });
        }
        return { ...prev, lines: nextLines, loading: false };
      });
    } catch (err) {
      setReceivingState((prev) => ({
        ...prev,
        error: err.message,
        loading: false,
      }));
    }
  };

  const handleReceivingSubmit = async () => {
    const lines = receivingState.lines.filter(
      (line) => Number(line.qty) > 0
    );
    if (!lines.length) {
      setReceivingState((prev) => ({
        ...prev,
        error: "Добавьте товары и количество.",
      }));
      return;
    }
    const missingDate = lines.find((line) => !line.manufacturedAt);
    if (missingDate) {
      setReceivingState((prev) => ({
        ...prev,
        error: "Укажите дату изготовления для всех позиций.",
      }));
      return;
    }
    try {
      setReceivingState((prev) => ({ ...prev, loading: true, error: "" }));
      const opId = makeOpId("RECEIVE");
      const res = await fetch(`${API_BASE}/warehouse/receiving`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          opId,
          lines: lines.map((line) => ({
            itemId: line.item.id,
            qty: Number(line.qty),
            manufacturedAt: line.manufacturedAt || null,
            expiresAt: line.expiresAt || line.manufacturedAt || null,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || "Не удалось провести приемку");
      }
      setReceivingState((prev) => ({
        ...prev,
        loading: false,
        done: true,
        step: 3,
      }));
    } catch (err) {
      setReceivingState((prev) => ({
        ...prev,
        error: err.message,
        loading: false,
      }));
    }
  };

  const handleBinLocation = async (code) => {
    try {
      setBinState((prev) => ({
        ...prev,
        loading: true,
        error: "",
        done: false,
        discrepancySaved: false,
      }));
      const data = await resolveScan(code);
      if (data.type !== "location") {
        throw new Error("Это не ячейка.");
      }
      const res = await fetch(
        `${API_BASE}/warehouse/bin-audit/location/${data.entity.id}/expected`,
        { headers: authHeaders }
      );
      const stockData = await res.json();
      if (!res.ok) {
        throw new Error(stockData.message || "Не удалось загрузить остатки");
      }
      const counts = {};
      (stockData.items || []).forEach((row) => {
        counts[row.item.id] = row.expectedQty;
      });
      setBinState({
        step: 1,
        sessionId: binState.sessionId,
        location: stockData.location || data.entity,
        items: stockData.items || [],
        counts,
        loading: false,
        error: "",
        done: false,
        discrepancySaved: false,
      });
    } catch (err) {
      setBinState((prev) => ({
        ...prev,
        error: err.message,
        loading: false,
      }));
    }
  };

  const handleQuickPlace = async () => {
    if (!countState.receivingLineId || !countState.location) return;
    try {
      setCountState((prev) => ({
        ...prev,
        placing: true,
        placeError: "",
      }));
      const res = await fetch(`${API_BASE}/warehouse/putaway/from-receiving`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          receivingLineId: countState.receivingLineId,
          locationId: countState.location.id,
          qty: Math.abs(Number(countState.delta) || 0),
          allowMix: countState.allowDifferentDate,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.message === "LOCATION_OCCUPIED") {
          throw new Error("Ячейка занята другим товаром.");
        }
        if (data.message === "LOCATION_CONFLICT_CONFIRM") {
          throw new Error("В ячейке есть товар с другой датой. Подтвердите размещение.");
        }
        if (data.message === "BAD_QTY") {
          throw new Error("Некорректное количество.");
        }
        throw new Error(data.message || "Не удалось разместить.");
      }
      setCountState((prev) => ({
        ...prev,
        placing: false,
        placeDone: true,
      }));
    } catch (err) {
      setCountState((prev) => ({
        ...prev,
        placing: false,
        placeError: err.message || "Не удалось разместить.",
      }));
    }
  };

  const handleMoveFrom = async (code) => {
    try {
      setMoveState((prev) => ({ ...prev, loading: true, error: "" }));
      const data = await resolveScan(code);
      if (data.type !== "location") {
        throw new Error("Это не ячейка.");
      }
      setMoveState((prev) => ({
        ...prev,
        from: data.entity,
        step: 1,
        loading: false,
      }));
    } catch (err) {
      setMoveState((prev) => ({
        ...prev,
        error: err.message,
        loading: false,
      }));
    }
  };

  const handleMoveItem = async (code) => {
    try {
      setMoveState((prev) => ({ ...prev, loading: true, error: "" }));
      const data = await resolveScan(code);
      if (data.type !== "item") {
        throw new Error("Это не товар.");
      }
      setMoveState((prev) => ({
        ...prev,
        item: data.entity,
        step: 2,
        loading: false,
      }));
    } catch (err) {
      setMoveState((prev) => ({
        ...prev,
        error: err.message,
        loading: false,
      }));
    }
  };

  const handleMoveTo = async (code) => {
    try {
      setMoveState((prev) => ({ ...prev, loading: true, error: "" }));
      const data = await resolveScan(code);
      if (data.type !== "location") {
        throw new Error("Это не ячейка.");
      }
      setMoveState((prev) => ({
        ...prev,
        to: data.entity,
        step: 4,
        loading: false,
      }));
    } catch (err) {
      setMoveState((prev) => ({
        ...prev,
        error: err.message,
        loading: false,
      }));
    }
  };

  const handleMoveSubmit = async () => {
    const qty = Number(moveState.qty);
    if (!Number.isFinite(qty) || qty <= 0) {
      setMoveState((prev) => ({ ...prev, error: "Введите количество." }));
      return;
    }
    try {
      setMoveState((prev) => ({ ...prev, loading: true, error: "" }));
      const opId = makeOpId("MOVE");
      const res = await fetch(`${API_BASE}/warehouse/move`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          opId,
          fromLocationId: moveState.from.id,
          toLocationId: moveState.to.id,
          itemId: moveState.item.id,
          qty,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || "Перемещение не выполнено");
      }
      setMoveState((prev) => ({
        ...prev,
        loading: false,
        done: true,
        step: 4,
      }));
    } catch (err) {
      setMoveState((prev) => ({
        ...prev,
        error: err.message,
        loading: false,
      }));
    }
  };

  const handleBinConfirmOk = async () => {
    if (!binState.location || !binState.sessionId) {
      setBinState((prev) => ({
        ...prev,
        error: "Нет активной сессии.",
      }));
      return;
    }
    try {
      setBinState((prev) => ({ ...prev, loading: true, error: "" }));
      const res = await fetch(
        `${API_BASE}/warehouse/bin-audit/location/${binState.location.id}/confirm-ok`,
        {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            sessionId: binState.sessionId,
          }),
        }
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || "Не удалось подтвердить");
      }
      setBinState((prev) => ({
        ...prev,
        loading: false,
        done: true,
        step: 1,
      }));
    } catch (err) {
      setBinState((prev) => ({
        ...prev,
        error: err.message,
        loading: false,
      }));
    }
  };

  const handleBinSaveDiscrepancy = async () => {
    if (!binState.location || !binState.sessionId) {
      setBinState((prev) => ({
        ...prev,
        error: "Нет активной сессии.",
      }));
      return;
    }
    const lines = binState.items
      .map((row) => ({
        itemId: row.item.id,
        countedQty: Number(binState.counts[row.item.id]),
        expectedQty: row.expectedQty,
      }))
      .filter(
        (line) =>
          Number.isFinite(line.countedQty) &&
          line.countedQty >= 0 &&
          line.countedQty !== line.expectedQty
      );
    try {
      setBinState((prev) => ({ ...prev, loading: true, error: "" }));
      const res = await fetch(
        `${API_BASE}/warehouse/bin-audit/location/${binState.location.id}/report-discrepancy`,
        {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            sessionId: binState.sessionId,
            lines: lines.map((line) => ({
              itemId: line.itemId,
              countedQty: line.countedQty,
            })),
          }),
        }
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || "Не удалось сохранить расхождения");
      }
      setBinState((prev) => ({
        ...prev,
        loading: false,
        discrepancySaved: true,
        step: 2,
      }));
    } catch (err) {
      setBinState((prev) => ({
        ...prev,
        error: err.message,
        loading: false,
      }));
    }
  };

  const handleBinFinishSession = async () => {
    if (!binState.sessionId) {
      setBinState((prev) => ({
        ...prev,
        error: "Нет активной сессии.",
      }));
      return;
    }
    try {
      const res = await fetch(
        `${API_BASE}/warehouse/bin-audit/session/${binState.sessionId}/finish`,
        {
          method: "POST",
          headers: authHeaders,
        }
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || "Не удалось завершить сессию");
      }
      setBinState(emptyBinState);
    } catch (err) {
      setBinState((prev) => ({ ...prev, error: err.message }));
    }
  };

  const handlePutawayTo = async (code) => {
    try {
      setPutawayState((prev) => ({ ...prev, loading: true, error: "" }));
      const data = await resolveScan(code);
      if (data.type !== "location") {
        throw new Error("Это не ячейка.");
      }
      setPutawayState((prev) => ({
        ...prev,
        to: data.entity,
        step: 2,
        loading: false,
      }));
    } catch (err) {
      setPutawayState((prev) => ({
        ...prev,
        error: err.message,
        loading: false,
      }));
    }
  };

  const handlePutawaySelect = (line) => {
    setPutawayState((prev) => ({
      ...prev,
      selected: line,
      selectedQty:
        line.remainingQty?.toString?.() || line.qty?.toString?.() || "",
      to: null,
      done: false,
      error: "",
      step: 1,
    }));
  };

  const handlePutawaySubmit = async (forceMix = false) => {
    const shouldMix = forceMix === true;
    const qty = Number(putawayState.selectedQty);
    if (!putawayState.selected) {
      setPutawayState((prev) => ({ ...prev, error: "Выберите товар." }));
      return;
    }
    if (!putawayState.to) {
      setPutawayState((prev) => ({ ...prev, error: "Сканируйте ячейку." }));
      return;
    }
    if (!Number.isFinite(qty) || qty <= 0) {
      setPutawayState((prev) => ({ ...prev, error: "Введите количество." }));
      return;
    }
    try {
      setPutawayState((prev) => ({ ...prev, loading: true, error: "" }));
      const opId = makeOpId("PUTAWAY");
      const res = await fetch(`${API_BASE}/warehouse/putaway/from-receiving`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          opId,
          receivingLineId: putawayState.selected.id,
          locationId: putawayState.to.id,
          qty,
          allowMix: shouldMix,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data?.message === "LOCATION_OCCUPIED") {
          throw new Error(
            "В ячейке уже есть другой товар. Выберите другую ячейку."
          );
        }
        if (data?.message === "LOCATION_CONFLICT_CONFIRM") {
          if (globalThis.confirm) {
            const ok = globalThis.confirm(
              "В ячейке уже есть такой же товар, но с другой датой. Разместить сюда?"
            );
            if (ok) {
              await handlePutawaySubmit(true);
              return;
            }
          }
          throw new Error(
            "В ячейке уже есть такой же товар, но с другой датой."
          );
        }
        throw new Error(data.message || "Размещение не выполнено");
      }
      const refreshed = await fetch(`${API_BASE}/warehouse/putaway/pending`, {
        headers: authHeaders,
      });
      const refreshedData = await refreshed.json();
      setPutawayState((prev) => ({
        ...prev,
        pending: refreshed.ok ? refreshedData.items || [] : prev.pending,
        loading: false,
        done: true,
        step: 2,
      }));
    } catch (err) {
      setPutawayState((prev) => ({
        ...prev,
        error: err.message,
        loading: false,
      }));
    }
  };

  const handleReplenFrom = async (code) => {
    try {
      setReplenState((prev) => ({ ...prev, loading: true, error: "" }));
      const data = await resolveScan(code);
      if (data.type !== "location") {
        throw new Error("Это не ячейка.");
      }
      setReplenState((prev) => ({
        ...prev,
        from: data.entity,
        step: 1,
        loading: false,
      }));
    } catch (err) {
      setReplenState((prev) => ({
        ...prev,
        error: err.message,
        loading: false,
      }));
    }
  };

  const handleReplenItem = async (code) => {
    try {
      setReplenState((prev) => ({ ...prev, loading: true, error: "" }));
      const data = await resolveScan(code);
      if (data.type !== "item") {
        throw new Error("Это не товар.");
      }
      setReplenState((prev) => ({
        ...prev,
        item: data.entity,
        step: 2,
        loading: false,
      }));
    } catch (err) {
      setReplenState((prev) => ({
        ...prev,
        error: err.message,
        loading: false,
      }));
    }
  };

  const handleReplenTo = async (code) => {
    try {
      setReplenState((prev) => ({ ...prev, loading: true, error: "" }));
      const data = await resolveScan(code);
      if (data.type !== "location") {
        throw new Error("Это не ячейка.");
      }
      setReplenState((prev) => ({
        ...prev,
        to: data.entity,
        step: 4,
        loading: false,
      }));
    } catch (err) {
      setReplenState((prev) => ({
        ...prev,
        error: err.message,
        loading: false,
      }));
    }
  };

  const handleReplenSubmit = async () => {
    const qty = Number(replenState.qty);
    if (!Number.isFinite(qty) || qty <= 0) {
      setReplenState((prev) => ({ ...prev, error: "Введите количество." }));
      return;
    }
    try {
      setReplenState((prev) => ({ ...prev, loading: true, error: "" }));
      const opId = makeOpId("REPLENISH");
      const res = await fetch(`${API_BASE}/warehouse/replen/execute`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          opId,
          fromLocationId: replenState.from.id,
          toLocationId: replenState.to.id,
          itemId: replenState.item.id,
          qty,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || "Подпитка не выполнена");
      }
      setReplenState((prev) => ({
        ...prev,
        loading: false,
        done: true,
        step: 4,
      }));
    } catch (err) {
      setReplenState((prev) => ({
        ...prev,
        error: err.message,
        loading: false,
      }));
    }
  };

  const handlePickFrom = async (code) => {
    try {
      setPickState((prev) => ({ ...prev, loading: true, error: "" }));
      const data = await resolveScan(code);
      if (data.type !== "location") {
        throw new Error("Это не ячейка.");
      }
      setPickState((prev) => ({
        ...prev,
        from: data.entity,
        step: 1,
        loading: false,
      }));
    } catch (err) {
      setPickState((prev) => ({
        ...prev,
        error: err.message,
        loading: false,
      }));
    }
  };

  const handlePickItem = async (code) => {
    try {
      setPickState((prev) => ({ ...prev, loading: true, error: "" }));
      const data = await resolveScan(code);
      if (data.type !== "item") {
        throw new Error("Это не товар.");
      }
      setPickState((prev) => ({
        ...prev,
        item: data.entity,
        step: 2,
        loading: false,
      }));
    } catch (err) {
      setPickState((prev) => ({
        ...prev,
        error: err.message,
        loading: false,
      }));
    }
  };

  const handlePickSubmit = async () => {
    const qty = Number(pickState.qty);
    if (!Number.isFinite(qty) || qty <= 0) {
      setPickState((prev) => ({ ...prev, error: "Введите количество." }));
      return;
    }
    try {
      setPickState((prev) => ({ ...prev, loading: true, error: "" }));
      const opId = makeOpId("PICK");
      const res = await fetch(`${API_BASE}/warehouse/pick`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          opId,
          fromLocationId: pickState.from.id,
          itemId: pickState.item.id,
          qty,
          refType: "PICK",
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || "Отбор не выполнен");
      }
      setPickState((prev) => ({
        ...prev,
        loading: false,
        done: true,
        step: 3,
      }));
    } catch (err) {
      setPickState((prev) => ({
        ...prev,
        error: err.message,
        loading: false,
      }));
    }
  };


  const renderCount = () => (
    <>
      <TsdHeader
        title="Инвентаризация"
        subtitle="Ячейка, товар и количество"
        contextLabel="Текущая ячейка"
        contextValue={countState.location?.name}
        onChangeContext={() =>
          setCountState((prev) => ({
            ...prev,
            location: null,
            item: null,
            qty: "",
            step: 0,
            done: false,
            delta: null,
            receivingLineId: null,
            placing: false,
            placeDone: false,
            placeError: "",
          }))
        }
        onBack={() => setMode(null)}
      />
      <Stepper steps={COUNT_STEPS} activeIndex={countState.step} />

      <div className="tsd-section">
        {countState.error && (
          <div className="tsd-alert tsd-alert--error">{countState.error}</div>
        )}

        {countState.step === 0 && (
          <>
            <Scanner
              label="Сканируй ячейку"
              hint="QR ячейки или код вручную"
              onScan={handleCountLocation}
              disabled={countState.loading}
            />
            {countLocations.length > 0 && (
              <div className="tsd-qty-input">
                <label className="tsd-scanner__label">Или выбери ячейку</label>
                <select
                  className="tsd-input"
                  value={countState.location?.id || ""}
                  onChange={(event) => {
                    const selected = countLocations.find(
                      (loc) => String(loc.id) === event.target.value
                    );
                    if (selected) {
                      setCountState((prev) => ({
                        ...prev,
                        location: selected,
                        step: 1,
                        allowDifferentDate: false,
                      }));
                    }
                  }}
                >
                  <option value="">Выберите ячейку</option>
                  {countLocations.map((loc) => (
                    <option key={loc.id} value={loc.id}>
                      {loc.name || loc.code || `Ячейка ${loc.id}`}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </>
        )}

        {countState.step === 1 && (
          <>
            <LocationCard location={countState.location} />
            <Scanner
              label="Сканируй товар"
              hint="QR, штрихкод или артикул"
              onScan={handleCountItem}
              disabled={countState.loading}
            />
          </>
        )}

        {countState.step === 2 && (
          <>
            <LocationCard location={countState.location} />
            <ItemCard item={countState.item} />
            <div className="tsd-qty-input">
              <label className="tsd-scanner__label">Тип инвентаризации</label>
              <select
                className="tsd-input"
                value={countState.mode}
                onChange={(event) =>
                  setCountState((prev) => ({
                    ...prev,
                    mode: event.target.value,
                    allowDifferentDate: false,
                  }))
                }
              >
                <option value="AUTO">Авто (по разнице)</option>
                <option value="PLUS">В плюс</option>
                <option value="MINUS">В минус</option>
              </select>
            </div>
            {countState.mode !== "MINUS" && (
              <div className="tsd-inline tsd-inline--two">
                <div>
                  <label className="tsd-scanner__label">Дата изготовления</label>
                  <input
                    className="tsd-input"
                    type="date"
                    value={countState.manufacturedAt}
                    onChange={(event) =>
                      setCountState((prev) => ({
                        ...prev,
                        manufacturedAt: event.target.value,
                      }))
                    }
                  />
                </div>
                <div>
                  <label className="tsd-scanner__label">Срок годности</label>
                  <input
                    className="tsd-input"
                    type="date"
                    value={countState.expiresAt}
                    onChange={(event) =>
                      setCountState((prev) => ({
                        ...prev,
                        expiresAt: event.target.value,
                      }))
                    }
                  />
                </div>
              </div>
            )}
            <div className="tsd-qty-input">
              <label className="tsd-scanner__label">Количество</label>
              <input
                className="tsd-input"
                type="number"
                value={countState.qty}
                onChange={(event) =>
                  setCountState((prev) => ({
                    ...prev,
                    qty: event.target.value,
                  }))
                }
                placeholder="0"
              />
            </div>
          </>
        )}

        {countState.step === 3 && (
          <>
            <LocationCard location={countState.location} />
            <ItemCard item={countState.item} qty={Number(countState.qty) || 0} />
            {countState.done && (
              <div className="tsd-alert tsd-alert--success">
                {countState.delta > 0
                  ? "Плюс отправлен в размещение. Разместите товар в ячейку."
                  : countState.delta < 0
                    ? "Минус зафиксирован. Требуется подтверждение администратора."
                    : "Пересчет сохранен. Расхождений нет."}
              </div>
            )}
            {countState.placeError && (
              <div className="tsd-alert tsd-alert--error">
                {countState.placeError}
              </div>
            )}
            {countState.placeDone && (
              <div className="tsd-alert tsd-alert--success">
                Размещение выполнено. Остатки обновлены.
              </div>
            )}
          </>
        )}
      </div>

      {countState.step === 2 && (
        <div className="tsd-action-bar">
          <button
            type="button"
            className="tsd-btn tsd-btn--primary"
            onClick={() =>
              setCountState((prev) => ({ ...prev, step: 3 }))
            }
          >
            Далее
          </button>
        </div>
      )}

      {countState.step === 3 && !countState.done && (
        <div className="tsd-action-bar">
          <button
            type="button"
            className="tsd-btn tsd-btn--primary"
            onClick={handleCountSubmit}
            disabled={countState.loading}
          >
            Подтвердить
          </button>
        </div>
      )}

      {countState.step === 3 &&
        countState.done &&
        countState.delta > 0 &&
        !countState.placeDone && (
          <div className="tsd-action-bar">
            <button
              type="button"
              className="tsd-btn tsd-btn--primary"
              onClick={handleQuickPlace}
              disabled={countState.placing}
            >
              {countState.placing ? "Размещаем..." : "Разместить сейчас"}
            </button>
          </div>
        )}

      {countState.done && (
        <div className="tsd-action-bar">
          <button
            type="button"
            className="tsd-btn tsd-btn--primary"
            onClick={() =>
            setCountState((prev) => ({
              ...prev,
              item: null,
              qty: "",
              step: 1,
              done: false,
              delta: null,
              receivingLineId: null,
              placing: false,
              placeDone: false,
              placeError: "",
            }))
          }
        >
            Следующий товар
          </button>
        </div>
      )}
    </>
  );

  const formatDate = (value) => {
    if (!value) return "-";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleDateString("ru-RU");
  };

  const renderReceiving = () => (
    <>
      <TsdHeader
        title="Приемка"
        subtitle="Сканируй товар и укажи даты"
        onBack={() => setMode(null)}
      />
      <Stepper steps={RECEIVING_STEPS} activeIndex={receivingState.step} />

      <div className="tsd-section">
        {receivingState.error && (
          <div className="tsd-alert tsd-alert--error">{receivingState.error}</div>
        )}

        {receivingState.step === 0 && (
          <>
            <Scanner
              label="Сканируй товар"
              hint="QR, штрихкод или артикул"
              onScan={handleReceivingItem}
              disabled={receivingState.loading}
            />
            {receivingState.lines.length > 0 && (
              <div className="tsd-list">
                {receivingState.lines.map((line) => (
                  <div key={line.item.id} className="tsd-card">
                    <ItemCard item={line.item} />
                    <div className="tsd-inline tsd-inline--two">
                      <div>
                        <label className="tsd-scanner__label">Количество</label>
                        <input
                          className="tsd-input"
                          type="number"
                          min="1"
                          value={line.qty}
                          onChange={(event) =>
                            setReceivingState((prev) => ({
                              ...prev,
                              lines: prev.lines.map((row) =>
                                row.item.id === line.item.id
                                  ? { ...row, qty: event.target.value }
                                  : row
                              ),
                            }))
                          }
                        />
                      </div>
                      <div style={{ display: "flex", alignItems: "flex-end" }}>
                        <button
                          type="button"
                          className="tsd-btn tsd-btn--ghost"
                          onClick={() =>
                            setReceivingState((prev) => ({
                              ...prev,
                              lines: prev.lines.filter((row) => row.item.id !== line.item.id),
                            }))
                          }
                        >
                          Удалить
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {receivingState.step === 1 && (
          <div className="tsd-list">
            {receivingState.lines.map((line) => (
              <div key={line.item.id} className="tsd-card">
                <ItemCard item={line.item} qty={Number(line.qty) || 0} />
                <div className="tsd-inline tsd-inline--two">
                  <div>
                    <label className="tsd-scanner__label">Дата изготовления</label>
                    <input
                      className="tsd-input"
                      type="date"
                      value={line.manufacturedAt}
                      onChange={(event) =>
                        setReceivingState((prev) => ({
                          ...prev,
                          lines: prev.lines.map((row) =>
                            row.item.id === line.item.id
                              ? { ...row, manufacturedAt: event.target.value }
                              : row
                          ),
                        }))
                      }
                    />
                  </div>
                  <div>
                    <label className="tsd-scanner__label">Дата окончания срока</label>
                    <input
                      className="tsd-input"
                      type="date"
                      value={line.expiresAt}
                      onChange={(event) =>
                        setReceivingState((prev) => ({
                          ...prev,
                          lines: prev.lines.map((row) =>
                            row.item.id === line.item.id
                              ? { ...row, expiresAt: event.target.value }
                              : row
                          ),
                        }))
                      }
                    />
                  </div>
                </div>
                <div className="tsd-muted">
                  Если срок не ограничен — поставьте одинаковые даты.
                </div>
              </div>
            ))}
          </div>
        )}

        {receivingState.step === 2 && (
          <div className="tsd-list">
            {receivingState.lines.map((line) => (
              <div key={line.item.id} className="tsd-card">
                <ItemCard item={line.item} qty={Number(line.qty) || 0} />
                <div className="tsd-card__meta">
                  Дата изготовления: {formatDate(line.manufacturedAt)}
                </div>
                <div className="tsd-card__meta">
                  Срок: {formatDate(line.expiresAt || line.manufacturedAt)}
                </div>
              </div>
            ))}
            {receivingState.done && (
              <div className="tsd-alert tsd-alert--success">
                Приемка сохранена. Товары добавлены в размещение.
              </div>
            )}
          </div>
        )}
      </div>

      {receivingState.step === 0 && (
        <div className="tsd-action-bar">
          <button
            type="button"
            className="tsd-btn tsd-btn--primary"
            disabled={receivingState.lines.length === 0}
            onClick={() =>
              setReceivingState((prev) => ({ ...prev, step: 1 }))
            }
          >
            Далее
          </button>
        </div>
      )}

      {receivingState.step === 1 && (
        <div className="tsd-action-bar">
          <button
            type="button"
            className="tsd-btn tsd-btn--primary"
            onClick={() =>
              setReceivingState((prev) => ({ ...prev, step: 2 }))
            }
          >
            Далее
          </button>
        </div>
      )}

      {receivingState.step === 2 && !receivingState.done && (
        <div className="tsd-action-bar">
          <button
            type="button"
            className="tsd-btn tsd-btn--primary"
            onClick={handleReceivingSubmit}
            disabled={receivingState.loading}
          >
            Подтвердить приемку
          </button>
        </div>
      )}

      {receivingState.done && (
        <div className="tsd-action-bar">
          <button
            type="button"
            className="tsd-btn tsd-btn--primary"
            onClick={() => setReceivingState(emptyReceivingState)}
          >
            Новая приемка
          </button>
        </div>
      )}
    </>
  );
  const renderBin = () => (
    <>
      <TsdHeader
        title="Контроль ячейки"
        subtitle="Проверка остатков по месту"
        contextLabel="Ячейка"
        contextValue={binState.location?.name}
        onChangeContext={() =>
          setBinState((prev) => ({
            ...prev,
            location: null,
            step: 0,
            items: [],
            counts: {},
            done: false,
            discrepancySaved: false,
          }))
        }
        rightSlot={
          binState.sessionId ? (
            <button
              type="button"
              className="tsd-btn tsd-btn--ghost"
              onClick={handleBinFinishSession}
            >
              Завершить
            </button>
          ) : null
        }
        onBack={() => setMode(null)}
      />
      <Stepper steps={BIN_STEPS} activeIndex={binState.step} />

      <div className="tsd-section">
        {binState.error && (
          <div className="tsd-alert tsd-alert--error">{binState.error}</div>
        )}
        {binState.sessionId && (
          <div className="tsd-info">
            <div className="tsd-info__title">Сессия #{binState.sessionId}</div>
            <div className="tsd-info__text">
              Контроль ячеек в рамках одной смены.
            </div>
          </div>
        )}

        {binState.step === 0 && (
          <Scanner
            label="Сканируй ячейку"
            hint="Покажем остатки внутри"
            onScan={handleBinLocation}
            disabled={binState.loading}
          />
        )}

        {binState.step === 1 && (
          <>
            <LocationCard location={binState.location} />
            <div className="tsd-list">
              {binState.items.length === 0 && (
                <div className="tsd-alert tsd-alert--success">
                  Остатков нет.
                </div>
              )}
              {binState.items.map((row) => (
                <ItemCard
                  key={row.item?.id || row.id}
                  item={row.item || row}
                  qty={row.expectedQty}
                />
              ))}
            </div>
            {binState.done && (
              <div className="tsd-alert tsd-alert--success">
                Проверка подтверждена.
              </div>
            )}
          </>
        )}

        {binState.step === 2 && (
          <>
            <LocationCard location={binState.location} />
            <div className="tsd-list">
              {binState.items.map((row) => (
                <div key={row.item.id} className="tsd-card">
                  <div className="tsd-card__body">
                    <div className="tsd-card__title">{row.item.name}</div>
                    <div className="tsd-card__meta">
                      Было: {row.expectedQty} {row.item.unit || ""}
                    </div>
                  </div>
                  <input
                    className="tsd-input"
                    type="number"
                    min="0"
                    value={binState.counts[row.item.id] ?? ""}
                    onChange={(event) =>
                      setBinState((prev) => ({
                        ...prev,
                        counts: {
                          ...prev.counts,
                          [row.item.id]: event.target.value,
                        },
                      }))
                    }
                  />
                </div>
              ))}
            </div>
            {binState.discrepancySaved && (
              <div className="tsd-alert tsd-alert--success">
                Расхождения сохранены.
              </div>
            )}
          </>
        )}
      </div>
      {binState.step === 1 && (
        <div className="tsd-action-bar">
          <div className="tsd-action-bar__row">
            <button
              type="button"
              className="tsd-btn tsd-btn--primary"
              onClick={handleBinConfirmOk}
              disabled={binState.loading}
            >
              Подтвердить
            </button>
            <button
              type="button"
              className="tsd-btn tsd-btn--secondary"
              onClick={() =>
                setBinState((prev) => ({
                  ...prev,
                  step: 2,
                  discrepancySaved: false,
                }))
              }
            >
              Есть расхождения
            </button>
          </div>
        </div>
      )}

      {binState.step === 2 && !binState.discrepancySaved && (
        <div className="tsd-action-bar">
          <button
            type="button"
            className="tsd-btn tsd-btn--primary"
            onClick={handleBinSaveDiscrepancy}
            disabled={binState.loading}
          >
            Сохранить расхождения
          </button>
        </div>
      )}

      {(binState.done || binState.discrepancySaved) && (
        <div className="tsd-action-bar">
          <button
            type="button"
            className="tsd-btn tsd-btn--primary"
            onClick={() =>
              setBinState((prev) => ({
                ...prev,
                step: 0,
                location: null,
                items: [],
                counts: {},
                done: false,
                discrepancySaved: false,
              }))
            }
          >
            Следующая ячейка
          </button>
        </div>
      )}
    </>
  );

  const renderMove = () => (
    <>
      <TsdHeader
        title="Перемещение товара"
        subtitle="Перенос между ячейками"
        contextLabel="Откуда"
        contextValue={moveState.from?.name}
        onChangeContext={() =>
          setMoveState((prev) => ({
            ...prev,
            from: null,
            item: null,
            qty: "",
            to: null,
            step: 0,
            done: false,
          }))
        }
        onBack={() => setMode(null)}
      />
      <Stepper steps={MOVE_STEPS} activeIndex={moveState.step} />

      <div className="tsd-section">
        {moveState.error && (
          <div className="tsd-alert tsd-alert--error">{moveState.error}</div>
        )}

        {moveState.step === 0 && (
          <Scanner
            label="Сканируй ячейку-источник"
            onScan={handleMoveFrom}
            disabled={moveState.loading}
          />
        )}

        {moveState.step === 1 && (
          <>
            <LocationCard location={moveState.from} />
            <Scanner
              label="Сканируй товар"
              onScan={handleMoveItem}
              disabled={moveState.loading}
            />
          </>
        )}

        {moveState.step === 2 && (
          <>
            <LocationCard location={moveState.from} />
            <ItemCard item={moveState.item} />
            <div className="tsd-qty-input">
              <label className="tsd-scanner__label">Количество</label>
              <input
                className="tsd-input"
                type="number"
                value={moveState.qty}
                onChange={(event) =>
                  setMoveState((prev) => ({
                    ...prev,
                    qty: event.target.value,
                  }))
                }
              />
            </div>
          </>
        )}

        {moveState.step === 3 && (
          <>
            <LocationCard location={moveState.from} />
            <ItemCard item={moveState.item} qty={Number(moveState.qty) || 0} />
            <Scanner
              label="Сканируй ячейку-получатель"
              onScan={handleMoveTo}
              disabled={moveState.loading}
            />
          </>
        )}

        {moveState.step === 4 && (
          <>
            <LocationCard location={moveState.from} />
            <ItemCard item={moveState.item} qty={Number(moveState.qty) || 0} />
            <LocationCard location={moveState.to} />
            {moveState.done && (
              <div className="tsd-alert tsd-alert--success">
                Перемещение выполнено.
              </div>
            )}
          </>
        )}
      </div>

      {moveState.step === 2 && (
        <div className="tsd-action-bar">
          <button
            type="button"
            className="tsd-btn tsd-btn--primary"
            onClick={() => setMoveState((prev) => ({ ...prev, step: 3 }))}
          >
            Далее
          </button>
        </div>
      )}

      {moveState.step === 4 && !moveState.done && (
        <div className="tsd-action-bar">
          <button
            type="button"
            className="tsd-btn tsd-btn--primary"
            onClick={handleMoveSubmit}
            disabled={moveState.loading}
          >
            Подтвердить
          </button>
        </div>
      )}

      {moveState.done && (
        <div className="tsd-action-bar">
          <button
            type="button"
            className="tsd-btn tsd-btn--primary"
            onClick={() =>
              setMoveState({
                ...emptyMoveState,
                from: moveState.from,
                step: 1,
              })
            }
          >
            Следующий товар
          </button>
        </div>
      )}
    </>
  );

  const renderPutaway = () => (
    <>
      <TsdHeader
        title="Размещение"
        subtitle="Перенос с приемки в ячейку"
        contextLabel="Товар"
        contextValue={putawayState.selected?.item?.name}
        onChangeContext={() =>
          setPutawayState((prev) => ({
            ...prev,
            selected: null,
            selectedQty: "",
            to: null,
            step: 0,
            done: false,
          }))
        }
        onBack={() => setMode(null)}
      />
      <Stepper steps={PUTAWAY_STEPS} activeIndex={putawayState.step} />

      <div className="tsd-section">
        {putawayState.error && (
          <div className="tsd-alert tsd-alert--error">{putawayState.error}</div>
        )}

        {putawayState.step === 0 && (
          <>
            {putawayState.loading && (
              <div className="tsd-alert tsd-alert--info">Загрузка…</div>
            )}
            {!putawayState.loading && putawayState.pending.length === 0 && (
              <div className="tsd-alert tsd-alert--info">
                Нет товаров для размещения.
              </div>
            )}
            <div className="tsd-grid">
              {putawayState.pending.map((line) => (
                <div key={line.id} className="tsd-card">
                  <div className="tsd-card__body">
                    <div className="tsd-card__title">{line.item?.name}</div>
                    <div className="tsd-card__meta">
                      Осталось: {line.remainingQty ?? line.qty}{" "}
                      {line.item?.unit || ""}
                    </div>
                    <div className="tsd-card__meta">
                      Дата: {formatDate(line.manufacturedAt)}
                    </div>
                    <div className="tsd-card__meta">
                      Срок: {formatDate(line.expiresAt || line.manufacturedAt)}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="tsd-btn tsd-btn--primary"
                    onClick={() => handlePutawaySelect(line)}
                  >
                    Разместить
                  </button>
                </div>
              ))}
            </div>
          </>
        )}

        {putawayState.step === 1 && (
          <>
            <ItemCard
              item={putawayState.selected?.item}
              qty={Number(putawayState.selectedQty) || 0}
            />
            <div className="tsd-qty-input">
              <label className="tsd-scanner__label">Количество</label>
              <input
                className="tsd-input"
                type="number"
                min="1"
                value={putawayState.selectedQty}
                onChange={(event) =>
                  setPutawayState((prev) => ({
                    ...prev,
                    selectedQty: event.target.value,
                  }))
                }
              />
            </div>
            <Scanner
              label="Сканируй ячейку-получатель"
              onScan={handlePutawayTo}
              disabled={putawayState.loading}
            />
          </>
        )}

        {putawayState.step === 2 && (
          <>
            <ItemCard
              item={putawayState.selected?.item}
              qty={Number(putawayState.selectedQty) || 0}
            />
            <LocationCard location={putawayState.to} />
            {putawayState.done && (
              <div className="tsd-alert tsd-alert--success">
                Размещение выполнено.
              </div>
            )}
          </>
        )}
      </div>

      {putawayState.step === 2 && !putawayState.done && (
        <div className="tsd-action-bar">
          <button
            type="button"
            className="tsd-btn tsd-btn--primary"
            onClick={handlePutawaySubmit}
            disabled={putawayState.loading}
          >
            Подтвердить
          </button>
        </div>
      )}

      {putawayState.done && (
        <div className="tsd-action-bar">
          <button
            type="button"
            className="tsd-btn tsd-btn--primary"
            onClick={() =>
              setPutawayState((prev) => ({
                ...prev,
                selected: null,
                selectedQty: "",
                to: null,
                step: 0,
                done: false,
              }))
            }
          >
            Следующая позиция
          </button>
        </div>
      )}
    </>
  );

  const renderReplenish = () => (
    <>
      <TsdHeader
        title="Подпитка"
        subtitle="Перенос в ячейки отбора"
        contextLabel="Откуда"
        contextValue={replenState.from?.name}
        onChangeContext={() =>
          setReplenState((prev) => ({
            ...prev,
            from: null,
            item: null,
            qty: "",
            to: null,
            step: 0,
            done: false,
          }))
        }
        onBack={() => setMode(null)}
      />
      <Stepper steps={REPLENISH_STEPS} activeIndex={replenState.step} />

      <div className="tsd-section">
        {replenState.error && (
          <div className="tsd-alert tsd-alert--error">{replenState.error}</div>
        )}

        {replenState.step === 0 && (
          <Scanner
            label="Сканируй ячейку-источник"
            onScan={handleReplenFrom}
            disabled={replenState.loading}
          />
        )}

        {replenState.step === 1 && (
          <>
            <LocationCard location={replenState.from} />
            <Scanner
              label="Сканируй товар"
              onScan={handleReplenItem}
              disabled={replenState.loading}
            />
          </>
        )}

        {replenState.step === 2 && (
          <>
            <LocationCard location={replenState.from} />
            <ItemCard item={replenState.item} />
            <div className="tsd-qty-input">
              <label className="tsd-scanner__label">Количество</label>
              <input
                className="tsd-input"
                type="number"
                value={replenState.qty}
                onChange={(event) =>
                  setReplenState((prev) => ({
                    ...prev,
                    qty: event.target.value,
                  }))
                }
              />
            </div>
          </>
        )}

        {replenState.step === 3 && (
          <>
            <LocationCard location={replenState.from} />
            <ItemCard item={replenState.item} qty={Number(replenState.qty) || 0} />
            <Scanner
              label="Сканируй ячейку-получатель"
              onScan={handleReplenTo}
              disabled={replenState.loading}
            />
          </>
        )}

        {replenState.step === 4 && (
          <>
            <LocationCard location={replenState.from} />
            <ItemCard item={replenState.item} qty={Number(replenState.qty) || 0} />
            <LocationCard location={replenState.to} />
            {replenState.done && (
              <div className="tsd-alert tsd-alert--success">
                Подпитка выполнена.
              </div>
            )}
          </>
        )}
      </div>

      {replenState.step === 2 && (
        <div className="tsd-action-bar">
          <button
            type="button"
            className="tsd-btn tsd-btn--primary"
            onClick={() => setReplenState((prev) => ({ ...prev, step: 3 }))}
          >
            Далее
          </button>
        </div>
      )}

      {replenState.step === 4 && !replenState.done && (
        <div className="tsd-action-bar">
          <button
            type="button"
            className="tsd-btn tsd-btn--primary"
            onClick={handleReplenSubmit}
            disabled={replenState.loading}
          >
            Подтвердить
          </button>
        </div>
      )}

      {replenState.done && (
        <div className="tsd-action-bar">
          <button
            type="button"
            className="tsd-btn tsd-btn--primary"
            onClick={() =>
              setReplenState({
                ...emptyReplenState,
                from: replenState.from,
                step: 1,
              })
            }
          >
            Следующий товар
          </button>
        </div>
      )}
    </>
  );

  const renderPick = () => (
    <>
      <TsdHeader
        title="Отбор"
        subtitle="Списание из ячейки"
        contextLabel="Ячейка"
        contextValue={pickState.from?.name}
        onChangeContext={() =>
          setPickState((prev) => ({
            ...prev,
            from: null,
            item: null,
            qty: "",
            step: 0,
            done: false,
          }))
        }
        onBack={() => setMode(null)}
      />
      <Stepper steps={PICK_STEPS} activeIndex={pickState.step} />

      <div className="tsd-section">
        {pickState.error && (
          <div className="tsd-alert tsd-alert--error">{pickState.error}</div>
        )}

        {pickState.step === 0 && (
          <Scanner
            label="Сканируй ячейку"
            onScan={handlePickFrom}
            disabled={pickState.loading}
          />
        )}

        {pickState.step === 1 && (
          <>
            <LocationCard location={pickState.from} />
            <Scanner
              label="Сканируй товар"
              onScan={handlePickItem}
              disabled={pickState.loading}
            />
          </>
        )}

        {pickState.step === 2 && (
          <>
            <LocationCard location={pickState.from} />
            <ItemCard item={pickState.item} />
            <div className="tsd-qty-input">
              <label className="tsd-scanner__label">Количество</label>
              <input
                className="tsd-input"
                type="number"
                value={pickState.qty}
                onChange={(event) =>
                  setPickState((prev) => ({
                    ...prev,
                    qty: event.target.value,
                  }))
                }
              />
            </div>
          </>
        )}

        {pickState.step === 3 && (
          <>
            <LocationCard location={pickState.from} />
            <ItemCard item={pickState.item} qty={Number(pickState.qty) || 0} />
            {pickState.done && (
              <div className="tsd-alert tsd-alert--success">Отбор выполнен.</div>
            )}
          </>
        )}
      </div>

      {pickState.step === 2 && (
        <div className="tsd-action-bar">
          <button
            type="button"
            className="tsd-btn tsd-btn--primary"
            onClick={() => setPickState((prev) => ({ ...prev, step: 3 }))}
          >
            Далее
          </button>
        </div>
      )}

      {pickState.step === 3 && !pickState.done && (
        <div className="tsd-action-bar">
          <button
            type="button"
            className="tsd-btn tsd-btn--primary"
            onClick={handlePickSubmit}
            disabled={pickState.loading}
          >
            Подтвердить
          </button>
        </div>
      )}

      {pickState.done && (
        <div className="tsd-action-bar">
          <button
            type="button"
            className="tsd-btn tsd-btn--primary"
            onClick={() =>
              setPickState({
                ...emptyPickState,
                from: pickState.from,
                step: 1,
              })
            }
          >
            Следующий товар
          </button>
        </div>
      )}
    </>
  );

  const renderDiscrepancies = () => (
    <>
      <TsdHeader
        title="Косяки"
        subtitle="Расхождения и проблемные места"
        onBack={() => setMode(null)}
      />
      <div className="tsd-section">
        <StockDiscrepanciesTab />
      </div>
    </>
  );
  const content = () => {
    if (!mode) {
      return <TsdHome modes={MODES} onSelect={setMode} />;
    }
    if (mode === "count") return renderCount();
    if (mode === "receiving") return renderReceiving();
    if (mode === "bin") return renderBin();
    if (mode === "move") return renderMove();
    if (mode === "putaway") return renderPutaway();
    if (mode === "replenish") return renderReplenish();
    if (mode === "pick") return renderPick();
    if (mode === "discrepancies") return renderDiscrepancies();
    return null;
  };

  return (
    <div className="tsd-page">
      <div className="tsd-shell">{content()}</div>
    </div>
  );
}

