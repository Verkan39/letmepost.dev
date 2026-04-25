"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowRight,
  Copy,
  Lightning,
  Rocket,
} from "@phosphor-icons/react";
import { authClient } from "@/lib/auth-client";
import { apiFetch, ApiRequestError } from "@/lib/api";
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
import { Skeleton } from "@/components/ui/skeleton";
import { FadeIn, StaggerList, StaggerItem } from "@/components/app/motion";
import {
  OnboardingChecklist,
  type ChecklistStep,
} from "@/components/app/onboarding-checklist";
import { OnboardingConnect } from "@/components/app/onboarding-connect";

const EASE_OUT: [number, number, number, number] = [0.22, 1, 0.36, 1];

type Counts = {
  accounts: number | null;
  apiKeys: number | null;
  webhooks: number | null;
  posts: number | null;
};

export default function DashboardHome() {
  const activeOrg = authClient.useActiveOrganization().data;
  const [counts, setCounts] = useState<Counts>({
    accounts: null,
    apiKeys: null,
    webhooks: null,
    posts: null,
  });
  const [latestKey, setLatestKey] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  async function refresh() {
    async function load(path: string): Promise<number | null> {
      try {
        const res = await apiFetch<{ data?: unknown[] }>(path);
        return Array.isArray(res?.data) ? res.data.length : 0;
      } catch {
        return null;
      }
    }
    const [accounts, apiKeys, webhooks, posts] = await Promise.all([
      load("/v1/accounts"),
      load("/v1/api-keys"),
      load("/v1/webhook-endpoints"),
      // limit=1 — we only need a "any?" check, not the full list.
      load("/v1/posts?limit=1"),
    ]);
    setCounts({ accounts, apiKeys, webhooks, posts });
    setLoaded(true);
  }

  useEffect(() => {
    refresh();
  }, []);

  const hasKey = (counts.apiKeys ?? 0) > 0 || latestKey !== null;
  const hasAccount = (counts.accounts ?? 0) > 0;
  const hasPost = (counts.posts ?? 0) > 0;
  const setupComplete = hasKey && hasAccount && hasPost;

  const steps: ChecklistStep[] = [
    {
      id: "api-key",
      title: "Copy your API key",
      description:
        "Bearer token that authenticates every request. Plaintext is shown once.",
      done: hasKey,
      body: (
        <ApiKeyStepBody
          latestKey={latestKey}
          alreadyHasKey={(counts.apiKeys ?? 0) > 0}
          onCreated={(plain) => {
            setLatestKey(plain);
            refresh();
          }}
        />
      ),
    },
    {
      id: "connect",
      title: "Connect your first platform",
      description: "Bluesky, LinkedIn, Pinterest, or Twitter / X.",
      done: hasAccount,
      body: <OnboardingConnect onConnected={refresh} />,
    },
    {
      id: "quick-start",
      title: "Send your first post",
      description: "Curl + post log. End-to-end in under a minute.",
      done: hasPost,
      body: <QuickStartBody apiKey={latestKey} onSent={refresh} />,
    },
  ];

  return (
    <div className="space-y-6">
      <FadeIn>
        <h1 className="text-lg font-semibold">
          {activeOrg?.name ?? "Dashboard"}
        </h1>
        <p className="text-xs text-muted-foreground">
          {setupComplete
            ? "Your operator surface — connect accounts, mint API keys, subscribe to webhooks."
            : "A few quick steps and you're publishing."}
        </p>
      </FadeIn>

      <AnimatePresence mode="wait" initial={false}>
        {!loaded ? (
          <motion.div
            key="loading"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="space-y-2"
          >
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
          </motion.div>
        ) : !setupComplete ? (
          <motion.div
            key="checklist"
            initial={{ opacity: 0, y: 6, filter: "blur(6px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            exit={{
              opacity: 0,
              y: -6,
              filter: "blur(6px)",
              transition: { duration: 0.24, ease: EASE_OUT },
            }}
            transition={{ duration: 0.32, ease: EASE_OUT }}
          >
            <OnboardingChecklist steps={steps} />
          </motion.div>
        ) : (
          <motion.div
            key="counts"
            initial={{ opacity: 0, y: 6, filter: "blur(6px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            transition={{ duration: 0.32, ease: EASE_OUT }}
          >
            <StaggerList className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <StaggerItem>
                <CountCard
                  title="Connected accounts"
                  description="Social platform accounts available to the API."
                  count={counts.accounts}
                  href="/accounts"
                  cta="Manage accounts"
                />
              </StaggerItem>
              <StaggerItem>
                <CountCard
                  title="API keys"
                  description="Bearer tokens for programmatic API access."
                  count={counts.apiKeys}
                  href="/api-keys"
                  cta="Manage keys"
                />
              </StaggerItem>
              <StaggerItem>
                <CountCard
                  title="Webhook endpoints"
                  description="Delivery targets for post / token lifecycle events."
                  count={counts.webhooks}
                  href="/webhooks"
                  cta="Manage webhooks"
                />
              </StaggerItem>
            </StaggerList>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function CountCard(props: {
  title: string;
  description: string;
  count: number | null;
  href: string;
  cta: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{props.title}</CardTitle>
        <CardDescription>{props.description}</CardDescription>
      </CardHeader>
      <CardContent>
        {props.count === null ? (
          <Skeleton className="h-8 w-16" />
        ) : (
          <div className="text-3xl font-semibold tabular-nums">
            {props.count}
          </div>
        )}
      </CardContent>
      <CardFooter>
        <Button asChild variant="outline" size="sm">
          <Link href={props.href}>{props.cta}</Link>
        </Button>
      </CardFooter>
    </Card>
  );
}

type ExistingKey = { prefix: string; last4: string };

function ApiKeyStepBody({
  latestKey,
  alreadyHasKey,
  onCreated,
}: {
  latestKey: string | null;
  alreadyHasKey: boolean;
  onCreated: (plaintext: string) => void;
}) {
  const [creating, setCreating] = useState(false);
  const [existing, setExisting] = useState<ExistingKey | null>(null);

  // When a key already exists but we don't have the plaintext (created in
  // a prior session), pull the masked form from the list endpoint so we can
  // show *something* shaped like a key in the same muted block.
  useEffect(() => {
    if (!alreadyHasKey || latestKey || existing) return;
    let cancelled = false;
    apiFetch<{ data: ExistingKey[] }>("/v1/api-keys")
      .then((res) => {
        const first = res?.data?.[0];
        if (!cancelled && first) {
          setExisting({ prefix: first.prefix, last4: first.last4 });
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [alreadyHasKey, latestKey, existing]);

  async function handleCreate() {
    setCreating(true);
    try {
      const res = await apiFetch<{ key: string }>("/v1/api-keys", {
        method: "POST",
        body: { name: "primary", prefix: "lmp_live_", scopes: [] },
      });
      onCreated(res.key);
      toast.success("Copy it now — we won't show it again.");
    } catch (err) {
      toast.error(
        err instanceof ApiRequestError
          ? err.payload.message
          : err instanceof Error
            ? err.message
            : "Couldn't create the key.",
      );
    } finally {
      setCreating(false);
    }
  }

  async function handleCopy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast.success("Copied to clipboard.");
    } catch {
      toast.error("Clipboard access denied.");
    }
  }

  if (latestKey) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          This is the only time we'll show the full key. Copy it and store it
          somewhere secure.
        </p>
        <div className="break-all bg-muted px-3 py-2 font-mono text-xs">
          {latestKey}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => handleCopy(latestKey)}
        >
          <Copy className="size-4" />
          Copy to clipboard
        </Button>
      </div>
    );
  }

  if (alreadyHasKey) {
    const masked = existing
      ? `${existing.prefix}${"•".repeat(20)}${existing.last4}`
      : "";
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Plaintext is only shown at creation — this is the masked form on
          file. Rotate or add another from the API keys page.
        </p>
        <div className="break-all bg-muted px-3 py-2 font-mono text-xs min-h-[2rem]">
          {existing ? (
            masked
          ) : (
            <Skeleton className="h-4 w-48 inline-block" />
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => handleCopy(masked)}
          disabled={!existing}
        >
          <Copy className="size-4" />
          Copy to clipboard
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        We'll mint a key called <code>primary</code> with the default scope set.
        You can rotate or add more from the API keys page later.
      </p>
      <Button onClick={handleCreate} disabled={creating}>
        <Rocket className="size-4" />
        {creating ? "Creating…" : "Create my first key"}
      </Button>
    </div>
  );
}

type FirstAccount = {
  id: string;
  platform: string;
  displayName?: string | null;
  handle?: string | null;
};

function QuickStartBody({
  apiKey,
  onSent,
}: {
  apiKey: string | null;
  onSent: () => void;
}) {
  const router = useRouter();
  const [account, setAccount] = useState<FirstAccount | null>(null);
  const [sending, setSending] = useState(false);

  // Pull the first connected account so the curl example carries a real
  // accountId/platform — saves the user a copy-paste back-and-forth.
  useEffect(() => {
    let cancelled = false;
    apiFetch<{ data: FirstAccount[] }>("/v1/accounts")
      .then((res) => {
        if (!cancelled && Array.isArray(res?.data) && res.data.length > 0) {
          setAccount(res.data[0]);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const accountId = account?.id ?? "<your-account-id>";
  const platform = account?.platform ?? "bluesky";
  const example = `curl -X POST ${API_URL}/v1/posts \\
  -H "Authorization: Bearer ${apiKey ?? "lmp_live_…"}" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: $(uuidgen)" \\
  -d '{
    "platform": "${platform}",
    "accountId": "${accountId}",
    "text": "Hello from letmepost.dev"
  }'`;

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(example);
      toast.success("Copied to clipboard.");
    } catch {
      toast.error("Clipboard access denied.");
    }
  }

  async function handleSend() {
    if (!apiKey || !account) return;
    setSending(true);
    try {
      const res = await fetch(`${API_URL}/v1/posts`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          platform: account.platform,
          accountId: account.id,
          text: "Hello from letmepost.dev",
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          message?: string;
        };
        throw new Error(body.message ?? `Request failed (${res.status})`);
      }
      toast.success("Post queued — opening the log.");
      onSent();
      router.push("/posts");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Send failed.");
    } finally {
      setSending(false);
    }
  }

  // Live-send needs the in-session plaintext key (POST /v1/posts is strict
  // Bearer-auth). If the user already had a key from a prior session and
  // hasn't created a new one here, we can only offer Copy.
  const canSend = apiKey !== null && account !== null;

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Paste this into your terminal, or fire it now from this page. Either
        way, the result lands in the post log — published or failed.
      </p>
      <pre className="bg-muted px-3 py-3 text-xs font-mono overflow-x-auto whitespace-pre">
        {example}
      </pre>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={handleCopy}>
          <Copy className="size-4" />
          Copy curl
        </Button>
        <Button
          size="sm"
          onClick={handleSend}
          disabled={!canSend || sending}
          title={
            !apiKey
              ? "Create a key in step 1 to enable live send."
              : !account
                ? "Loading your account…"
                : undefined
          }
        >
          <Lightning className="size-4" />
          {sending ? "Sending…" : "Send test post"}
        </Button>
        <Button asChild variant="ghost" size="sm">
          <Link href="/posts">
            Open the post log
            <ArrowRight className="size-4" />
          </Link>
        </Button>
      </div>
      {!apiKey ? (
        <p className="text-xs text-muted-foreground">
          Live send uses the API key from step 1. If you've already created a
          key in a prior session, copy this curl and run it instead.
        </p>
      ) : null}
    </div>
  );
}
