"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

const FALLBACK_INTERVAL_MS = 12_000;

export function useRealtimeSync(enabled = true) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled) return;

    let fallbackTimer: ReturnType<typeof setInterval> | null = null;
    let eventSource: EventSource | null = null;

    const invalidate = () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    };

    const startFallback = () => {
      if (fallbackTimer) return;
      fallbackTimer = setInterval(invalidate, FALLBACK_INTERVAL_MS);
    };

    try {
      eventSource = new EventSource("/api/realtime/stream");
      eventSource.onmessage = () => invalidate();
      eventSource.onerror = () => {
        eventSource?.close();
        eventSource = null;
        startFallback();
      };
    } catch {
      startFallback();
    }

    return () => {
      if (eventSource) {
        eventSource.close();
      }
      if (fallbackTimer) {
        clearInterval(fallbackTimer);
      }
    };
  }, [enabled, queryClient]);
}
