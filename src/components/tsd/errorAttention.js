let audioCtx = null;
let lastSignalMessage = "";
let lastSignalAt = 0;

const MIN_REPEAT_MS = 1200;

function getAudioContext() {
  if (typeof window === "undefined") return null;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return null;
  if (!audioCtx || audioCtx.state === "closed") {
    audioCtx = new AudioContextClass();
  }
  return audioCtx;
}

function playErrorTone() {
  const ctx = getAudioContext();
  if (!ctx) return;

  if (ctx.state === "suspended") {
    ctx.resume().catch(() => {});
  }

  const now = ctx.currentTime;
  const notes = [
    { freq: 240, duration: 0.1, at: 0 },
    { freq: 180, duration: 0.12, at: 0.14 },
  ];

  notes.forEach((note) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(note.freq, now + note.at);

    gain.gain.setValueAtTime(0.0001, now + note.at);
    gain.gain.exponentialRampToValueAtTime(0.2, now + note.at + 0.01);
    gain.gain.exponentialRampToValueAtTime(
      0.0001,
      now + note.at + note.duration
    );

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now + note.at);
    osc.stop(now + note.at + note.duration + 0.02);
  });
}

export function focusTsdError(message, element) {
  if (!message) return;

  const now = Date.now();
  if (message === lastSignalMessage && now - lastSignalAt < MIN_REPEAT_MS) {
    if (element?.scrollIntoView) {
      element.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    return;
  }

  lastSignalMessage = message;
  lastSignalAt = now;

  if (element?.scrollIntoView) {
    element.scrollIntoView({ behavior: "smooth", block: "center" });
  } else if (typeof window !== "undefined") {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  playErrorTone();
  if (typeof navigator !== "undefined" && navigator?.vibrate) {
    navigator.vibrate([120, 60, 120]);
  }
}
