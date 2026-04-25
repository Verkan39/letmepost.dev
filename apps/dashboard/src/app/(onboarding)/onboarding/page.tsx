"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { motion } from "framer-motion";
import { authClient } from "@/lib/auth-client";
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
 * Recovery surface for sessions that lack an active organization. Reached
 * either as a first-run path (sign-up's org-create step failed mid-flight)
 * or when a user has been removed from every org they belonged to.
 *
 * If the user already has orgs, we list them and let `setActive` resume
 * normal navigation; otherwise the form creates one.
 */
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

export default function OnboardingPage() {
  const router = useRouter();
  const { data: session, isPending } = authClient.useSession();
  const { data: organizations } = authClient.useListOrganizations();

  const [orgName, setOrgName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const orgId = session?.session?.activeOrganizationId ?? null;

  useEffect(() => {
    if (isPending) return;
    if (!session) {
      router.replace("/sign-in");
      return;
    }
    if (orgId) {
      router.replace("/");
    }
  }, [isPending, session, orgId, router]);

  const slugPreview = useMemo(() => deriveSlug(orgName), [orgName]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const { data, error } = await authClient.organization.create({
        name: orgName,
        slug: slugPreview,
      });
      if (error || !data) {
        toast.error(error?.message ?? "Couldn't create the organization.");
        return;
      }
      await authClient.organization.setActive({ organizationId: data.id });
      toast.success(`Welcome to ${data.name}.`);
      router.replace("/");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Onboarding request failed.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function pickExisting(id: string) {
    try {
      await authClient.organization.setActive({ organizationId: id });
      router.replace("/");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Couldn't switch organization.",
      );
    }
  }

  async function handleSignOut() {
    await authClient.signOut();
    router.replace("/sign-in");
  }

  if (isPending || orgId) {
    return (
      <div className="text-center text-sm text-muted-foreground">Loading…</div>
    );
  }

  const hasExisting = (organizations?.length ?? 0) > 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      className="space-y-4"
    >
      {hasExisting ? (
        <Card className="py-6 gap-4">
          <CardHeader className="gap-1.5 px-6">
            <CardTitle className="text-base font-semibold">
              Pick an organization
            </CardTitle>
            <CardDescription>
              Your session lost its active workspace. Resume into one of these,
              or create a new one below.
            </CardDescription>
          </CardHeader>
          <CardContent className="px-6 space-y-2">
            {organizations?.map((org) => (
              <Button
                key={org.id}
                variant="outline"
                className="w-full justify-start"
                onClick={() => pickExisting(org.id)}
              >
                {org.name}
              </Button>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <form onSubmit={handleCreate}>
        <Card className="py-6 gap-6">
          <CardHeader className="gap-1.5 px-6">
            <CardTitle className="text-base font-semibold">
              {hasExisting ? "Or create a new one" : "Create an organization"}
            </CardTitle>
            <CardDescription>
              Every API key, account, and post you create lives inside an
              organization. You can rename or invite teammates later.
            </CardDescription>
          </CardHeader>
          <CardContent className="px-6 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="orgName">Organization name</Label>
              <Input
                id="orgName"
                required
                placeholder="Acme Robotics"
                className="h-9 text-sm"
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                autoFocus
              />
              {orgName.trim().length > 0 ? (
                <p className="text-xs text-muted-foreground">
                  slug:{" "}
                  <span className="font-mono text-foreground/80">
                    {slugPreview}
                  </span>
                </p>
              ) : null}
            </div>
          </CardContent>
          <CardFooter className="px-6 py-4 flex-col items-stretch gap-3">
            <Button
              type="submit"
              size="lg"
              className="w-full"
              disabled={submitting || orgName.trim().length === 0}
            >
              {submitting ? "Creating…" : "Create organization"}
            </Button>
            <button
              type="button"
              onClick={handleSignOut}
              className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground transition-colors"
            >
              Sign out instead
            </button>
          </CardFooter>
        </Card>
      </form>
    </motion.div>
  );
}
