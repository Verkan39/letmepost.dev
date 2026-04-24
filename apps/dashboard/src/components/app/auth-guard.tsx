"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";

/**
 * Client-side redirect to /sign-in when no session is present. The dashboard
 * is a pure SPA shell — all real data lives behind the API's Bearer/session
 * auth, so the worst-case consequence of a stale guard is a short flash of
 * empty UI before the redirect kicks in. Good enough for MVP; a proper
 * server-side session check would need us to proxy cookies through a Next.js
 * route handler (out of scope here).
 */
export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { data: session, isPending } = authClient.useSession();

  useEffect(() => {
    if (!isPending && !session) {
      router.replace("/sign-in");
    }
  }, [isPending, session, router]);

  if (isPending) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }
  if (!session) {
    return null;
  }
  return <>{children}</>;
}
