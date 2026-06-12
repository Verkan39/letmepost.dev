"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { authClient } from "@/lib/auth-client";
import { API_URL } from "@/lib/env";
import { track } from "@/lib/analytics";
import {
  EmailIcon,
  GitHubIcon,
  GoogleIcon,
} from "@/components/auth/provider-icons";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * When the OAuth provider redirects the user here for sign-in, it appends the
 * full signed authorize-query (response_type, client_id, scope, state, …).
 * After sign-in we send the user back to /api/auth/oauth2/authorize with
 * those exact params so the authorize handler can verify the signature and
 * continue. A bare router.push("/") drops the OAuth dance on the floor.
 */
function buildPostSignInRedirect(search: URLSearchParams): string {
  if (!search.get("response_type")) return "/";
  return `${API_URL}/api/auth/oauth2/authorize?${search.toString()}`;
}

export default function SignInPage() {
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [socialBusy, setSocialBusy] = useState<"google" | "github" | null>(null);
  const [showEmailForm, setShowEmailForm] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      track({ name: "signin.started", properties: { provider: "email" } });
      const { error } = await authClient.signIn.email({ email, password });
      if (error) {
        toast.error(error.message ?? "Sign-in failed.");
        return;
      }
      track({ name: "signin.completed", properties: { provider: "email" } });
      const target = buildPostSignInRedirect(
        new URLSearchParams(searchParams?.toString() ?? ""),
      );
      // Full-page nav so the browser leaves the dashboard origin and the
      // API receives the request with the new session cookie attached.
      window.location.href = target;
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Sign-in request failed.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function onSocial(provider: "google" | "github") {
    if (socialBusy) return;
    setSocialBusy(provider);
    try {
      // Preserve any OAuth-authorize query; force absolute so the
      // callback lands on the dashboard, not the API baseURL.
      const raw = buildPostSignInRedirect(
        new URLSearchParams(searchParams?.toString() ?? ""),
      );
      const callbackURL = raw.startsWith("http")
        ? raw
        : `${window.location.origin}${raw}`;
      track({ name: "signin.started", properties: { provider } });
      // Stash a pending event so the post-redirect landing page can fire
      // signin.completed once the session lands — we leave this origin
      // before the auth call resolves, so we can't fire it inline.
      try {
        window.localStorage.setItem(
          "lmp_pending_auth_event",
          JSON.stringify({
            kind: "signin.completed",
            provider,
            stashedAt: new Date().toISOString(),
          }),
        );
      } catch {
        // private mode / disabled storage — accept the gap, the redirect
        // is more important than the analytics event.
      }
      const { error } = await authClient.signIn.social({
        provider,
        callbackURL,
      });
      if (error) {
        toast.error(error.message ?? `${provider} sign-in failed.`);
        setSocialBusy(null);
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : `${provider} sign-in failed.`,
      );
      setSocialBusy(null);
    }
  }

  const anyBusy = submitting || socialBusy !== null;

  return (
    <Card className="py-6 gap-6">
      <CardHeader className="gap-1.5 px-6">
        <CardTitle className="text-base font-semibold">Sign in</CardTitle>
        <CardDescription>
          One inbox. One operator. Pick up where you left off.
        </CardDescription>
      </CardHeader>
      <CardContent className="px-6 space-y-4">
        <Button
          type="button"
          size="lg"
          className="w-full gap-2"
          onClick={() => onSocial("github")}
          disabled={anyBusy}
        >
          <GitHubIcon size={18} />
          {socialBusy === "github" ? "Connecting…" : "Continue with GitHub"}
        </Button>

        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-card px-2 text-muted-foreground">or</span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Button
            type="button"
            variant="outline"
            className="h-9 gap-2"
            onClick={() => onSocial("google")}
            disabled={anyBusy}
          >
            <GoogleIcon size={16} />
            {socialBusy === "google" ? "Connecting…" : "Google"}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-9 gap-2"
            onClick={() => setShowEmailForm((v) => !v)}
            disabled={anyBusy}
            aria-expanded={showEmailForm}
            aria-controls="email-signin-form"
          >
            <EmailIcon size={16} />
            {showEmailForm ? "Hide email" : "Email"}
          </Button>
        </div>

        {showEmailForm && (
          <form
            id="email-signin-form"
            onSubmit={onSubmit}
            className="space-y-4"
          >
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                className="h-9 text-sm"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                className="h-9 text-sm"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <Button
              type="submit"
              size="lg"
              className="w-full"
              disabled={anyBusy}
            >
              {submitting ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        )}
      </CardContent>
      <CardFooter className="px-6 py-4 flex-col items-stretch gap-3">
        <p className="text-xs text-muted-foreground text-center">
          Don&apos;t have an account?{" "}
          <Link className="underline underline-offset-2" href="/sign-up">
            Sign up
          </Link>
        </p>
      </CardFooter>
    </Card>
  );
}
