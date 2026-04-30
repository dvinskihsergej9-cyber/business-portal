"use client";

import { useRealtimeSync } from "@/hooks/use-realtime-sync";

export function RealtimeBridge() {
  useRealtimeSync(true);
  return null;
}
