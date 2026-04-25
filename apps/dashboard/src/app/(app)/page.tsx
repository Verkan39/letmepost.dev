"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { authClient } from "@/lib/auth-client";
import { apiFetch } from "@/lib/api";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { FadeIn, StaggerList, StaggerItem } from "@/components/app/motion";

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

  useEffect(() => {
    let cancelled = false;

    async function load<T extends { data?: unknown[] }>(
      path: string,
    ): Promise<number | null> {
      try {
        const res = await apiFetch<T>(path);
        return Array.isArray(res?.data) ? res.data.length : 0;
      } catch {
        return null;
      }
    }

    Promise.all([
      load("/v1/accounts"),
      load("/v1/api-keys"),
      load("/v1/webhook-endpoints"),
    ]).then(([accounts, apiKeys, webhooks]) => {
      if (!cancelled) setCounts({ accounts, apiKeys, webhooks });
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-6">
      <FadeIn>
        <h1 className="text-lg font-semibold">
          {activeOrg?.name ?? "Dashboard"}
        </h1>
        <p className="text-xs text-muted-foreground">
          Your operator surface — connect accounts, mint API keys, subscribe to
          webhooks.
        </p>
      </FadeIn>

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
