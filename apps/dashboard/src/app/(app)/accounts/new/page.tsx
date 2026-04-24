"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { apiFetch, ApiRequestError } from "@/lib/api";
import {
  CONNECTABLE_PLATFORMS,
  type ConnectablePlatform,
  type ConnectDescriptor,
  type ConnectResponse,
} from "@/lib/accounts";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const LABELS: Record<ConnectablePlatform, string> = {
  bluesky: "Bluesky",
  pinterest: "Pinterest",
  twitter: "Twitter / X",
};

/**
 * Connect-Account flow (MVP):
 *
 *   1. Pick a platform from the dropdown.
 *   2. `POST /v1/accounts/connect/:platform` returns a ConnectDescriptor.
 *   3. descriptor.kind === "oauth"        → render a single "Connect with X"
 *                                           button that opens authorizationUrl.
 *   3. descriptor.kind === "credentials"  → render a dynamic form from
 *                                           descriptor.fields[] and POST to
 *                                           `/complete` on submit.
 *
 * Everything about each platform's auth mode is the API's problem. The
 * dashboard never hardcodes "bluesky uses app passwords" — the descriptor
 * tells us at runtime. That's the whole point.
 */
export default function NewAccountPage() {
  const router = useRouter();
  const [platform, setPlatform] = useState<ConnectablePlatform | "">("");
  const [descriptor, setDescriptor] = useState<ConnectDescriptor | null>(null);
  const [descriptorPlatform, setDescriptorPlatform] = useState<string | null>(
    null,
  );
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [descriptorError, setDescriptorError] = useState<string | null>(null);

  async function handlePlatformChange(next: ConnectablePlatform) {
    setPlatform(next);
    setDescriptor(null);
    setDescriptorPlatform(null);
    setFormValues({});
    setDescriptorError(null);
    setSubmitting(true);
    try {
      const res = await apiFetch<ConnectResponse>(
        `/v1/accounts/connect/${next}`,
        { method: "POST", body: {} },
      );
      setDescriptor(res.descriptor);
      setDescriptorPlatform(res.platform ?? next);
      if (res.descriptor.kind === "credentials") {
        const seed: Record<string, string> = {};
        for (const field of res.descriptor.fields) seed[field.name] = "";
        setFormValues(seed);
      }
    } catch (err) {
      setDescriptorError(
        err instanceof ApiRequestError
          ? err.payload.message
          : err instanceof Error
            ? err.message
            : "Could not start connect flow.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCredentialsSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!platform || !descriptor || descriptor.kind !== "credentials") return;
    setSubmitting(true);
    try {
      await apiFetch(`/v1/accounts/connect/${platform}/complete`, {
        method: "POST",
        body: formValues,
      });
      toast.success("Account connected.");
      router.push("/accounts");
    } catch (err) {
      toast.error(
        err instanceof ApiRequestError
          ? err.payload.message
          : err instanceof Error
            ? err.message
            : "Connect failed.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6 max-w-xl">
      <div>
        <h1 className="text-lg font-semibold">Connect account</h1>
        <p className="text-xs text-muted-foreground">
          Choose a platform. We'll walk you through the exact auth flow it
          needs — OAuth redirect, app password, whatever.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Platform</CardTitle>
          <CardDescription>
            Pick where you want to post. More platforms are added as the API
            grows.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <Label htmlFor="platform">Platform</Label>
            <Select
              value={platform}
              onValueChange={(v) =>
                handlePlatformChange(v as ConnectablePlatform)
              }
            >
              <SelectTrigger id="platform" className="w-full">
                <SelectValue placeholder="Select a platform…" />
              </SelectTrigger>
              <SelectContent>
                {CONNECTABLE_PLATFORMS.map((p) => (
                  <SelectItem key={p} value={p}>
                    {LABELS[p]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {descriptorError ? (
        <Card>
          <CardHeader>
            <CardTitle>Couldn&apos;t start connect flow</CardTitle>
            <CardDescription>{descriptorError}</CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      {descriptor && descriptorPlatform ? (
        descriptor.kind === "oauth" ? (
          <Card>
            <CardHeader>
              <CardTitle>
                Connect with {LABELS[descriptorPlatform as ConnectablePlatform] ??
                  descriptorPlatform}
              </CardTitle>
              <CardDescription>
                You'll be redirected to authorize access. The callback comes
                back to this app and finishes the connection automatically.
              </CardDescription>
            </CardHeader>
            <CardFooter>
              <Button asChild>
                <a href={descriptor.authorizationUrl}>
                  Connect with{" "}
                  {LABELS[descriptorPlatform as ConnectablePlatform] ??
                    descriptorPlatform}
                </a>
              </Button>
            </CardFooter>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>
                Connect{" "}
                {LABELS[descriptorPlatform as ConnectablePlatform] ??
                  descriptorPlatform}
              </CardTitle>
              <CardDescription>
                Credentials-based auth — submit the fields below to complete
                the connection.
              </CardDescription>
            </CardHeader>
            <form onSubmit={handleCredentialsSubmit}>
              <CardContent className="space-y-4">
                {descriptor.fields.map((field) => (
                  <div key={field.name} className="space-y-2">
                    <Label htmlFor={field.name}>{field.label}</Label>
                    <Input
                      id={field.name}
                      type={field.type ?? "text"}
                      placeholder={field.placeholder}
                      required={field.required ?? true}
                      value={formValues[field.name] ?? ""}
                      onChange={(e) =>
                        setFormValues((prev) => ({
                          ...prev,
                          [field.name]: e.target.value,
                        }))
                      }
                    />
                    {field.description ? (
                      <p className="text-xs text-muted-foreground">
                        {field.description}
                      </p>
                    ) : null}
                  </div>
                ))}
              </CardContent>
              <CardFooter className="gap-2">
                <Button type="submit" disabled={submitting}>
                  {submitting ? "Connecting…" : "Connect"}
                </Button>
                <Button variant="ghost" asChild>
                  <Link href="/accounts">Cancel</Link>
                </Button>
              </CardFooter>
            </form>
          </Card>
        )
      ) : null}
    </div>
  );
}
