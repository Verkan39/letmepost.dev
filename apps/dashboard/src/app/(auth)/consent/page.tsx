"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { API_URL } from "@/lib/env";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

// Human labels for the custom scopes our OAuth provider declares. Anything
// not in this map renders as the raw scope name — fine for openid / profile
// / offline_access which are self-explanatory.
const SCOPE_LABELS: Record<string, string> = {
  publish: "Publish posts on your behalf",
  read: "Read your posts, accounts, and webhooks",
  offline_access: "Stay signed in (refresh tokens)",
  openid: "Confirm your identity",
  profile: "See your name and email",
};

/**
 * OAuth consent page. better-auth's oauth-provider plugin redirects here with
 * the full signed authorize-query plus `client_id` and `scope` as discrete
 * params. The user approves or denies; we POST to /api/auth/oauth2/consent
 * carrying the same signed query so the AS can correlate this consent with
 * the pending authorize request and continue the flow.
 */
export default function ConsentPage() {
  const search = useSearchParams();
  const [submitting, setSubmitting] = useState<"accept" | "deny" | null>(null);

  const clientId = search?.get("client_id") ?? "an OAuth client";
  const scope = search?.get("scope") ?? "";
  const scopes = scope.split(/\s+/).filter(Boolean);

  async function submit(accept: boolean) {
    setSubmitting(accept ? "accept" : "deny");
    try {
      // Pass the full signed query so the AS resolves the right authorize
      // request. The body carries the decision + the scopes the user
      // approved (which may be a subset of what was requested).
      const consentUrl = `${API_URL}/api/auth/oauth2/consent?${search?.toString() ?? ""}`;
      const res = await fetch(consentUrl, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accept, scope: scope || undefined }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body?.error_description ?? body?.error ?? "Consent failed");
        return;
      }
      // better-auth either returns a redirect URL in the body or follows the
      // redirect itself; handle both.
      const body = await res.json().catch(() => null);
      if (body?.redirect_url) {
        window.location.href = body.redirect_url;
        return;
      }
      if (res.redirected) {
        window.location.href = res.url;
        return;
      }
      // Fallback: send the user back to the dashboard.
      window.location.href = "/";
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Consent request failed.");
    } finally {
      setSubmitting(null);
    }
  }

  return (
    <Card className="py-6 gap-6">
      <CardHeader className="gap-1.5 px-6">
        <CardTitle className="text-base font-semibold">
          Authorize {clientId}
        </CardTitle>
        <CardDescription>
          This application is requesting access to your letmepost.dev account.
        </CardDescription>
      </CardHeader>
      <CardContent className="px-6">
        {scopes.length > 0 ? (
          <ul className="space-y-2 text-sm">
            {scopes.map((s) => (
              <li key={s} className="flex items-start gap-2">
                <span className="mt-1 inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
                <span>
                  <span className="font-medium">
                    {SCOPE_LABELS[s] ?? s}
                  </span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    ({s})
                  </span>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            The application has not requested any specific scopes.
          </p>
        )}
      </CardContent>
      <CardFooter className="px-6 flex gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={submitting !== null}
          onClick={() => submit(false)}
          className="flex-1"
        >
          {submitting === "deny" ? "Denying…" : "Deny"}
        </Button>
        <Button
          type="button"
          disabled={submitting !== null}
          onClick={() => submit(true)}
          className="flex-1"
        >
          {submitting === "accept" ? "Authorizing…" : "Authorize"}
        </Button>
      </CardFooter>
    </Card>
  );
}
