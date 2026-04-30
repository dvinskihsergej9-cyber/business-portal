import { create } from "zustand";
import type { User } from "@/types/contracts";

type SessionState = {
  user: User | null;
  hydrated: boolean;
  setUser: (user: User | null) => void;
  setHydrated: (value: boolean) => void;
};

export const useSessionStore = create<SessionState>((set) => ({
  user: null,
  hydrated: false,
  setUser: (user) => set({ user }),
  setHydrated: (value) => set({ hydrated: value }),
}));
