import { AuthGate } from "@/components/portal/auth-gate";
import { PortalShell } from "@/components/portal/portal-shell";
import { RealtimeBridge } from "@/components/portal/realtime-bridge";

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGate>
      <RealtimeBridge />
      <PortalShell>{children}</PortalShell>
    </AuthGate>
  );
}
