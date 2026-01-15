import { useEffect } from "react";

const OVERFLOW_ATTR = "data-overflow-debug";

export default function OverflowDebug() {
  useEffect(() => {
    if (!import.meta.env.DEV) return;

    const clearMarks = () => {
      document.querySelectorAll(`[${OVERFLOW_ATTR}]`).forEach((node) => {
        node.removeAttribute(OVERFLOW_ATTR);
      });
    };

    const markOverflow = () => {
      clearMarks();
      const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
      const nodes = document.body.querySelectorAll("*");
      nodes.forEach((node) => {
        const rect = node.getBoundingClientRect();
        if (rect.width > viewportWidth + 1) {
          node.setAttribute(OVERFLOW_ATTR, "true");
        }
      });
    };

    let raf = 0;
    const schedule = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(markOverflow);
    };

    schedule();
    window.addEventListener("resize", schedule);

    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("resize", schedule);
      observer.disconnect();
      clearMarks();
    };
  }, []);

  return null;
}
