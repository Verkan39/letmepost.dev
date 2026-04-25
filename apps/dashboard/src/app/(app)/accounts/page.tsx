"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Plus, Trash } from "@phosphor-icons/react";
import { apiFetch, ApiRequestError } from "@/lib/api";
import type { Account } from "@/lib/accounts";
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
import { FadeIn, StaggerList, StaggerItem } from "@/components/app/motion";

export default function AccountsListPage() {
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingDisconnect, setPendingDisconnect] = useState<Account | null>(
    null,
  );

  async function refresh() {
    setError(null);
    try {
      const res = await apiFetch<{ data: Account[] }>("/v1/accounts");
      setAccounts(res.data ?? []);
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setError(err.payload.message);
      } else {
        setError(err instanceof Error ? err.message : "Failed to load.");
      }
      setAccounts([]);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleDelete(id: string) {
    try {
      await apiFetch<{ id: string }>(`/v1/accounts/${id}`, {
        method: "DELETE",
      });
      toast.success("Account disconnected.");
      refresh();
    } catch (err) {
      toast.error(
        err instanceof ApiRequestError
          ? err.payload.message
          : err instanceof Error
            ? err.message
            : "Delete failed.",
      );
    }
  }

  return (
    <div className="space-y-6">
      <FadeIn className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold">Accounts</h1>
          <p className="text-xs text-muted-foreground">
            Connected social platform accounts. Tokens are encrypted at rest.
          </p>
        </div>
        <Button asChild>
          <Link href="/accounts/new">
            <Plus className="size-4" />
            Connect account
          </Link>
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
            <Button asChild>
              <Link href="/accounts/new">Connect account</Link>
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
              <CardContent className="flex items-center justify-between">
                <div className="text-xs text-muted-foreground">
                  {acc.tokenExpiresAt
                    ? `Token expires ${new Date(acc.tokenExpiresAt).toLocaleString()}`
                    : "Token refresh managed"}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setPendingDisconnect(acc)}
                >
                  <Trash className="size-4" />
                  Disconnect
                </Button>
              </CardContent>
            </Card>
            </StaggerItem>
          ))}
        </StaggerList>
      )}

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
          if (pendingDisconnect) await handleDelete(pendingDisconnect.id);
        }}
      />
    </div>
  );
}
