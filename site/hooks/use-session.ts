"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchMe } from "@/services/api";
import { useEffect } from "react";
import { useSessionStore } from "@/store/session-store";

export function useSession() {
  const setUser = useSessionStore((state) => state.setUser);
  const setHydrated = useSessionStore((state) => state.setHydrated);

  const query = useQuery({
    queryKey: ["session", "me"],
    queryFn: fetchMe,
    retry: false,
  });

  useEffect(() => {
    if (query.data) {
      setUser(query.data);
      setHydrated(true);
      return;
    }

    if (query.isError) {
      setUser(null);
      setHydrated(true);
    }
  }, [query.data, query.isError, setHydrated, setUser]);

  return query;
}
