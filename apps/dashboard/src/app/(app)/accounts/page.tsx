"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plug, Plus, Trash } from "@phosphor-icons/react";
import { apiFetch, ApiRequestError } from "@/lib/api";
import type { Account } from "@/lib/accounts";
import { queryKeys } from "@/lib/query-keys";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { ConnectAccountDrawer } from "@/components/app/connect-account-drawer";
import { FadeIn, StaggerList, StaggerItem } from "@/components/app/motion";

export default function AccountsListPage() {
  const queryClient = useQueryClient();
  const [pendingDisconnect, setPendingDisconnect] = useState<Account | null>(
    null,
  );
  const [connectOpen, setConnectOpen] = useState(false);

  const query = useQuery({
    queryKey: queryKeys.accounts.list(),
    queryFn: () =>
      apiFetch<{ data: Account[] }>("/v1/accounts").then((r) => r.data ?? []),
  });
  const accounts = query.data ?? null;
  const error = query.error
    ? query.error instanceof ApiRequestError
      ? query.error.payload.message
      : query.error instanceof Error
        ? query.error.message
        : "Failed to load."
    : null;

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ id: string }>(`/v1/accounts/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Account disconnected.");
      queryClient.invalidateQueries({ queryKey: queryKeys.accounts.list() });
    },
    onError: (err: unknown) => {
      toast.error(
        err instanceof ApiRequestError
          ? err.payload.message
          : err instanceof Error
            ? err.message
            : "Delete failed.",
      );
    },
  });

  return (
    <div className="space-y-6">
      <FadeIn className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold">Accounts</h1>
          <p className="text-xs text-muted-foreground">
            Connected social platform accounts. Tokens are encrypted at rest.
          </p>
        </div>
        <Button onClick={() => setConnectOpen(true)}>
          <Plus className="size-4" />
          Connect account
        </Button>
      </FadeIn>

      {error ? (
        <Card>
          <CardHeader>
            <CardTitle>Couldn&apos;t load accounts</CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
        </Card>
      ) : accounts === null ? (
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
      ) : accounts.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No accounts yet</CardTitle>
            <CardDescription>
              Connect your first platform to start publishing through the API.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => setConnectOpen(true)}>
              Connect account
            </Button>
          </CardContent>
        </Card>
      ) : (
        <StaggerList className="grid gap-4 md:grid-cols-2">
          {accounts.map((acc) => (
            <StaggerItem key={acc.id}>
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="uppercase tracking-wide">
                    {acc.platform}
                  </Badge>
                </div>
                <CardTitle className="mt-2">
                  {acc.displayName ?? acc.handle ?? acc.id}
                </CardTitle>
                {acc.handle ? (
                  <CardDescription>@{acc.handle}</CardDescription>
                ) : null}
              </CardHeader>
              <CardContent className="flex items-center justify-between gap-2">
                <ExpiryLine acc={acc} />
                <div className="flex items-center gap-1 shrink-0">
                  {needsReconnect(acc) ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setConnectOpen(true)}
                    >
                      <Plug className="size-4" />
                      Reconnect
                    </Button>
                  ) : null}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setPendingDisconnect(acc)}
                  >
                    <Trash className="size-4" />
                    Disconnect
                  </Button>
                </div>
              </CardContent>
            </Card>
            </StaggerItem>
          ))}
        </StaggerList>
      )}

      <ConnectAccountDrawer
        open={connectOpen}
        onOpenChange={setConnectOpen}
      />

      <ConfirmDialog
        open={pendingDisconnect !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDisconnect(null);
        }}
        title="Disconnect account?"
        description={
          pendingDisconnect ? (
            <>
              This removes{" "}
              <span className="font-medium text-foreground">
                {pendingDisconnect.displayName ??
                  pendingDisconnect.handle ??
                  pendingDisconnect.id}
              </span>{" "}
              from your organization. Posting will stop until you reconnect.
            </>
          ) : null
        }
        confirmLabel="Disconnect"
        variant="destructive"
        onConfirm={async () => {
          if (pendingDisconnect)
            await deleteMutation.mutateAsync(pendingDisconnect.id);
        }}
      />
    </div>
  );
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/** Whether the account's token expires within 7 days (or has already). */
function needsReconnect(acc: Account): boolean {
  if (!acc.tokenExpiresAt) return false;
  const ms = new Date(acc.tokenExpiresAt).getTime() - Date.now();
  return ms < SEVEN_DAYS_MS;
}

/**
 * Token-expiry copy. Three cases:
 *   - no expiry on file → "Token refresh managed" (Bluesky-style auth)
 *   - expired or <7d    → destructive-tone, relative ("expires in 3d", "expired")
 *   - >7d              → muted, relative
 */
function ExpiryLine({ acc }: { acc: Account }) {
  if (!acc.tokenExpiresAt) {
    return (
      <span className="text-xs text-muted-foreground">
        Token refresh managed
      </span>
    );
  }
  const ms = new Date(acc.tokenExpiresAt).getTime() - Date.now();
  const days = Math.ceil(ms / ONE_DAY_MS);
  const expired = ms <= 0;
  const soon = !expired && ms < SEVEN_DAYS_MS;
  const label = expired
    ? "Token expired"
    : days === 0
      ? "Token expires today"
      : days === 1
        ? "Token expires in 1d"
        : `Token expires in ${days}d`;
  return (
    <span
      className={
        expired || soon
          ? "text-xs text-destructive"
          : "text-xs text-muted-foreground"
      }
    >
      {label}
    </span>
  );
}
