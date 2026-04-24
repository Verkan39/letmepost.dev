"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Copy, Plus, Trash } from "@phosphor-icons/react";
import { apiFetch, ApiRequestError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";

type ApiKey = {
  id: string;
  name: string;
  prefix: string;
  last4: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt?: string | null;
  revokedAt?: string | null;
};

type CreateResponse = ApiKey & { key: string };

export default function ApiKeysPage() {
  const [keys, setKeys] = useState<ApiKey[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [prefix, setPrefix] = useState<"lmp_live_" | "lmp_test_">("lmp_live_");
  const [creating, setCreating] = useState(false);
  const [plaintext, setPlaintext] = useState<CreateResponse | null>(null);

  async function refresh() {
    setError(null);
    try {
      const res = await apiFetch<{ data: ApiKey[] }>("/v1/api-keys");
      setKeys(res.data ?? []);
    } catch (err) {
      setError(
        err instanceof ApiRequestError
          ? err.payload.message
          : err instanceof Error
            ? err.message
            : "Failed to load.",
      );
      setKeys([]);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    try {
      const res = await apiFetch<CreateResponse>("/v1/api-keys", {
        method: "POST",
        body: { name, prefix, scopes: [] },
      });
      setPlaintext(res);
      setName("");
      refresh();
    } catch (err) {
      toast.error(
        err instanceof ApiRequestError
          ? err.payload.message
          : err instanceof Error
            ? err.message
            : "Create failed.",
      );
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(id: string) {
    if (!window.confirm("Revoke this API key? This cannot be undone.")) return;
    try {
      await apiFetch(`/v1/api-keys/${id}`, { method: "DELETE" });
      toast.success("Key revoked.");
      refresh();
    } catch (err) {
      toast.error(
        err instanceof ApiRequestError
          ? err.payload.message
          : err instanceof Error
            ? err.message
            : "Revoke failed.",
      );
    }
  }

  async function copyKey() {
    if (!plaintext) return;
    try {
      await navigator.clipboard.writeText(plaintext.key);
      toast.success("Copied to clipboard.");
    } catch {
      toast.error("Clipboard access denied.");
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold">API keys</h1>
        <p className="text-xs text-muted-foreground">
          Bearer tokens. Plaintext is shown once, right after creation — store
          it somewhere safe.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>New key</CardTitle>
          <CardDescription>
            A human-readable name helps you identify which deployment uses each
            key.
          </CardDescription>
        </CardHeader>
        <form onSubmit={handleCreate}>
          <CardContent className="grid gap-4 md:grid-cols-[1fr_180px_auto] md:items-end">
            <div className="space-y-2">
              <Label htmlFor="key-name">Name</Label>
              <Input
                id="key-name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="production-web"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="key-prefix">Environment</Label>
              <Select
                value={prefix}
                onValueChange={(v) =>
                  setPrefix(v as "lmp_live_" | "lmp_test_")
                }
              >
                <SelectTrigger id="key-prefix">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="lmp_live_">Live</SelectItem>
                  <SelectItem value="lmp_test_">Test</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button type="submit" disabled={creating}>
              <Plus className="size-4" />
              {creating ? "Creating…" : "Create key"}
            </Button>
          </CardContent>
        </form>
      </Card>

      <div>
        <h2 className="text-sm font-semibold mb-3">Active keys</h2>
        {error ? (
          <Card>
            <CardHeader>
              <CardTitle>Couldn&apos;t load API keys</CardTitle>
              <CardDescription>{error}</CardDescription>
            </CardHeader>
          </Card>
        ) : keys === null ? (
          <div className="space-y-2">
            <Skeleton className="h-14" />
            <Skeleton className="h-14" />
          </div>
        ) : keys.length === 0 ? (
          <p className="text-xs text-muted-foreground">No keys yet.</p>
        ) : (
          <div className="space-y-2">
            {keys.map((k) => (
              <Card key={k.id} size="sm">
                <CardContent className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm truncate">
                        {k.name}
                      </span>
                      <Badge variant="outline" className="text-[10px]">
                        {k.prefix.replace(/_$/, "")}
                      </Badge>
                      {k.revokedAt ? (
                        <Badge variant="destructive">revoked</Badge>
                      ) : null}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {k.prefix}…{k.last4} · created{" "}
                      {new Date(k.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                  {!k.revokedAt ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRevoke(k.id)}
                    >
                      <Trash className="size-4" />
                      Revoke
                    </Button>
                  ) : null}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      <Dialog
        open={plaintext !== null}
        onOpenChange={(open) => {
          if (!open) setPlaintext(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save your API key</DialogTitle>
            <DialogDescription>
              This is the only time we'll show the full key. Copy it now and
              store it somewhere secure.
            </DialogDescription>
          </DialogHeader>
          {plaintext ? (
            <div className="space-y-3">
              <div className="break-all bg-muted px-3 py-2 font-mono text-xs">
                {plaintext.key}
              </div>
              <Button variant="outline" onClick={copyKey}>
                <Copy className="size-4" />
                Copy to clipboard
              </Button>
            </div>
          ) : null}
          <DialogFooter>
            <Button onClick={() => setPlaintext(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
