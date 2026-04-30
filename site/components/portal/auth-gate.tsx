"use client";

import { PropsWithChildren, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/hooks/use-session";

export function AuthGate({ children }: PropsWithChildren) {
  const router = useRouter();
  const session = useSession();

  useEffect(() => {
    if (session.isError) {
      router.replace("/login");
    }
  }, [router, session.isError]);

  if (session.isLoading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center text-sm text-slate-500">
        Проверяем сессию...
      </div>
    );
  }

  if (!session.data) {
    return null;
  }

  return <>{children}</>;
}
