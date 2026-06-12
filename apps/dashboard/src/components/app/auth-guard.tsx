"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { track } from "@/lib/analytics";

/**
 * Drain any `signin.completed` / `signup.completed` event the auth pages
 * stashed before the OAuth full-page redirect. Runs once per mount; the
 * localStorage entry is cleared so a second render doesn't re-fire.
 *
 * OAuth flows leave the dashboard origin entirely (Google/GitHub consent
 * → API callback → bounce back here) so the "completed" event can't be
 * captured inline from the auth page — it has to be drained from the
 * first signed-in page the user lands on.
 */
const PENDING_AUTH_EVENT_KEY = "lmp_pending_auth_event";

function drainPendingAuthEvent(): void {
  if (typeof window === "undefined") return;
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(PENDING_AUTH_EVENT_KEY);
  } catch {
    return;
  }
  if (!raw) return;
  try {
    window.localStorage.removeItem(PENDING_AUTH_EVENT_KEY);
  } catch {
    // proceed even if cleanup fails — losing the entry is better than
    // double-firing on the next render.
  }
  try {
    const parsed = JSON.parse(raw) as {
      kind?: string;
      provider?: "google" | "github";
      stashedAt?: string;
    };
    if (parsed.kind !== "signin.completed" && parsed.kind !== "signup.completed")
      return;
    if (parsed.provider !== "google" && parsed.provider !== "github") return;
    // Expire stashes older than 5 minutes — an OAuth round-trip takes
    // 10–30 seconds; anything past 5 min means the user abandoned the
    // social flow and is now signing in via a different path. Firing the
    // stashed event in that case would double-count + tag the wrong
    // provider.
    if (parsed.stashedAt) {
      const ageMs = Date.now() - new Date(parsed.stashedAt).getTime();
      if (!Number.isFinite(ageMs) || ageMs > 5 * 60 * 1000) return;
    }
    track({
      name: parsed.kind,
      properties: { provider: parsed.provider },
    });
  } catch {
    // malformed payload — already cleared, nothing else to do.
  }
}

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

  // Fire `signin.completed` / `signup.completed` once the session lands
  // after the OAuth redirect. Gated on `session` so we wait for the real
  // post-callback render, not the brief in-between state.
  useEffect(() => {
    if (isPending || !session) return;
    drainPendingAuthEvent();
  }, [isPending, session]);

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
