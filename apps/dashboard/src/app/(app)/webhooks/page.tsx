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

type Endpoint = {
  id: string;
  url: string;
  events: string[];
  description?: string | null;
  active: boolean;
  lastDeliveryAt?: string | null;
  lastFailureReason?: string | null;
  createdAt: string;
  updatedAt: string;
};

type CreateResponse = Endpoint & { signingSecret: string };

export default function WebhooksPage() {
  const [endpoints, setEndpoints] = useState<Endpoint[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const [events, setEvents] = useState("");
  const [creating, setCreating] = useState(false);
  const [secretReveal, setSecretReveal] = useState<CreateResponse | null>(
    null,
  );

  async function refresh() {
    setError(null);
    try {
      const res = await apiFetch<{ data: Endpoint[] }>(
        "/v1/webhook-endpoints",
      );
      setEndpoints(res.data ?? []);
    } catch (err) {
      setError(
        err instanceof ApiRequestError
          ? err.payload.message
          : err instanceof Error
            ? err.message
            : "Failed to load.",
      );
      setEndpoints([]);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    try {
      const parsedEvents = events
        .split(/[\s,]+/)
        .map((v) => v.trim())
        .filter(Boolean);

      const res = await apiFetch<CreateResponse>("/v1/webhook-endpoints", {
        method: "POST",
        body: {
          url,
          events: parsedEvents,
          description: description.length > 0 ? description : undefined,
        },
      });
      setSecretReveal(res);
      setUrl("");
      setDescription("");
      setEvents("");
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

  async function handleDelete(id: string) {
    if (!window.confirm("Delete this webhook endpoint?")) return;
    try {
      await apiFetch(`/v1/webhook-endpoints/${id}`, { method: "DELETE" });
      toast.success("Endpoint deleted.");
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

  async function copySecret() {
    if (!secretReveal) return;
    try {
      await navigator.clipboard.writeText(secretReveal.signingSecret);
      toast.success("Signing secret copied.");
    } catch {
      toast.error("Clipboard access denied.");
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold">Webhooks</h1>
        <p className="text-xs text-muted-foreground">
          Subscribe to post lifecycle events. Payloads are HMAC-SHA256 signed
          with a per-endpoint secret shown once at creation.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>New endpoint</CardTitle>
          <CardDescription>
            Leave <code>events</code> empty to receive everything. Comma- or
            space-separated filter otherwise (e.g.{" "}
            <code>post.published, post.failed</code>).
          </CardDescription>
        </CardHeader>
        <form onSubmit={handleCreate}>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="hook-url">URL</Label>
              <Input
                id="hook-url"
                type="url"
                required
                placeholder="https://example.com/hooks/letmepost"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="hook-events">Events filter (optional)</Label>
                <Input
                  id="hook-events"
                  placeholder="post.published, post.failed"
                  value={events}
                  onChange={(e) => setEvents(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="hook-desc">Description (optional)</Label>
                <Input
                  id="hook-desc"
                  placeholder="Prod Slack alerter"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>
            </div>
          </CardContent>
          <CardContent className="pt-0">
            <Button type="submit" disabled={creating}>
              <Plus className="size-4" />
              {creating ? "Creating…" : "Create endpoint"}
            </Button>
          </CardContent>
        </form>
      </Card>

      <div>
        <h2 className="text-sm font-semibold mb-3">Active endpoints</h2>
        {error ? (
          <Card>
            <CardHeader>
              <CardTitle>Couldn&apos;t load endpoints</CardTitle>
              <CardDescription>{error}</CardDescription>
            </CardHeader>
          </Card>
        ) : endpoints === null ? (
          <div className="space-y-2">
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
          </div>
        ) : endpoints.length === 0 ? (
          <p className="text-xs text-muted-foreground">No endpoints yet.</p>
        ) : (
          <div className="space-y-2">
            {endpoints.map((ep) => (
              <Card key={ep.id} size="sm">
                <CardContent className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm truncate">
                        {ep.url}
                      </span>
                      {!ep.active ? (
                        <Badge variant="outline">paused</Badge>
                      ) : null}
                      {ep.events.length > 0 ? (
                        <Badge variant="secondary">
                          {ep.events.length} event
                          {ep.events.length === 1 ? "" : "s"}
                        </Badge>
                      ) : (
                        <Badge variant="secondary">all events</Badge>
                      )}
                    </div>
                    {ep.description ? (
                      <div className="text-xs text-muted-foreground">
                        {ep.description}
                      </div>
                    ) : null}
                    <div className="text-xs text-muted-foreground">
                      Last delivery:{" "}
                      {ep.lastDeliveryAt
                        ? new Date(ep.lastDeliveryAt).toLocaleString()
                        : "—"}
                      {ep.lastFailureReason
                        ? ` · last failure: ${ep.lastFailureReason}`
                        : ""}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDelete(ep.id)}
                  >
                    <Trash className="size-4" />
                    Delete
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      <Dialog
        open={secretReveal !== null}
        onOpenChange={(open) => {
          if (!open) setSecretReveal(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save your signing secret</DialogTitle>
            <DialogDescription>
              Use this to verify HMAC-SHA256 signatures on delivered payloads.
              We won't show it again.
            </DialogDescription>
          </DialogHeader>
          {secretReveal ? (
            <div className="space-y-3">
              <div className="break-all bg-muted px-3 py-2 font-mono text-xs">
                {secretReveal.signingSecret}
              </div>
              <Button variant="outline" onClick={copySecret}>
                <Copy className="size-4" />
                Copy to clipboard
              </Button>
            </div>
          ) : null}
          <DialogFooter>
            <Button onClick={() => setSecretReveal(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
