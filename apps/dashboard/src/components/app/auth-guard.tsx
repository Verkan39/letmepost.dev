"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";

/**
 * Client-side gate for `(app)` routes:
 *   - no session             → /sign-in
 *   - session but no org     → /onboarding (orphaned-session recovery)
 *   - session + active org   → render
 *
 * Better-auth's session payload has `session.activeOrganizationId` populated
 * once `organization.setActive` succeeds. If something between sign-up's
 * create-org and set-active steps fails, the user lands here without one;
 * /onboarding lets them complete it without signing out.
 */
export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { data: session, isPending } = authClient.useSession();

  const orgId = session?.session?.activeOrganizationId ?? null;

  useEffect(() => {
    if (isPending) return;
    if (!session) {
      router.replace("/sign-in");
      return;
    }
    if (!orgId && pathname !== "/onboarding") {
      router.replace("/onboarding");
    }
  }, [isPending, session, orgId, pathname, router]);

  if (isPending) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }
  if (!session) return null;
  if (!orgId) return null;
  return <>{children}</>;
}
