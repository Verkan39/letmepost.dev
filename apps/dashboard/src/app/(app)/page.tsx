"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, Copy, Plug, Rocket } from "@phosphor-icons/react";
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

const EASE_OUT: [number, number, number, number] = [0.22, 1, 0.36, 1];

type Counts = {
  accounts: number | null;
  apiKeys: number | null;
  webhooks: number | null;
};

export default function DashboardHome() {
  const activeOrg = authClient.useActiveOrganization().data;
  const [counts, setCounts] = useState<Counts>({
    accounts: null,
    apiKeys: null,
    webhooks: null,
  });
  const [latestKey, setLatestKey] = useState<string | null>(null);

  async function refresh() {
    async function load(path: string): Promise<number | null> {
      try {
        const res = await apiFetch<{ data?: unknown[] }>(path);
        return Array.isArray(res?.data) ? res.data.length : 0;
      } catch {
        return null;
      }
    }
    const [accounts, apiKeys, webhooks] = await Promise.all([
      load("/v1/accounts"),
      load("/v1/api-keys"),
      load("/v1/webhook-endpoints"),
    ]);
    setCounts({ accounts, apiKeys, webhooks });
  }

  useEffect(() => {
    refresh();
  }, []);

  const hasKey = (counts.apiKeys ?? 0) > 0 || latestKey !== null;
  const hasAccount = (counts.accounts ?? 0) > 0;
  const setupComplete = hasKey && hasAccount;

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
      body: <ConnectStepBody />,
    },
    {
      id: "quick-start",
      title: "Send your first post",
      description: "Curl + post log. End-to-end in under a minute.",
      done: false,
      body: <QuickStartBody apiKey={latestKey} />,
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
        {!setupComplete ? (
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

function ApiKeyStepBody({
  latestKey,
  onCreated,
}: {
  latestKey: string | null;
  onCreated: (plaintext: string) => void;
}) {
  const [creating, setCreating] = useState(false);

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

  async function handleCopy() {
    if (!latestKey) return;
    try {
      await navigator.clipboard.writeText(latestKey);
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
        <Button variant="outline" size="sm" onClick={handleCopy}>
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

function ConnectStepBody() {
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Bluesky takes an app password; LinkedIn, Pinterest, and Twitter/X go
        through OAuth. Tokens are encrypted at rest with per-row data-keys.
      </p>
      <Button asChild>
        <Link href="/accounts/new">
          <Plug className="size-4" />
          Connect a platform
        </Link>
      </Button>
    </div>
  );
}

function QuickStartBody({ apiKey }: { apiKey: string | null }) {
  const example = `curl -X POST ${API_URL}/v1/posts \\
  -H "Authorization: Bearer ${apiKey ?? "lmp_live_…"}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "platform": "bluesky",
    "accountId": "<your-account-id>",
    "text": "Hello from letmepost.dev"
  }'`;

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Once a platform is connected, paste this into your terminal. Whether it
        publishes or fails, the post log captures every attempt.
      </p>
      <pre className="bg-muted px-3 py-3 text-xs font-mono overflow-x-auto whitespace-pre">
        {example}
      </pre>
      <Button asChild variant="outline" size="sm">
        <Link href="/posts">
          Open the post log
          <ArrowRight className="size-4" />
        </Link>
      </Button>
    </div>
  );
}
