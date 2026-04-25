"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function deriveSlug(input: string): string {
  return (
    input
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || `org-${Math.random().toString(36).slice(2, 8)}`
  );
}

export function NewOrgDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const slug = useMemo(() => deriveSlug(name), [name]);

  function reset() {
    setName("");
    setSubmitting(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const { data, error } = await authClient.organization.create({
        name,
        slug,
      });
      if (error || !data) {
        toast.error(error?.message ?? "Couldn't create the organization.");
        return;
      }
      await authClient.organization.setActive({ organizationId: data.id });
      toast.success(`Switched to ${data.name}.`);
      onOpenChange(false);
      reset();
      router.refresh();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Create org request failed.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) reset();
      }}
    >
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>New organization</DialogTitle>
            <DialogDescription>
              An organization scopes accounts, API keys, and posts. You can
              invite teammates after it's created.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-1.5">
              <Label htmlFor="new-org-name">Name</Label>
              <Input
                id="new-org-name"
                required
                placeholder="Acme Robotics"
                className="h-9 text-sm"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
              {name.trim().length > 0 ? (
                <p className="text-xs text-muted-foreground">
                  slug:{" "}
                  <span className="font-mono text-foreground/80">{slug}</span>
                </p>
              ) : null}
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={submitting || name.trim().length === 0}
            >
              {submitting ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
