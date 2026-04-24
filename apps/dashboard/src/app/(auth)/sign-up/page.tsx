"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
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
 * Sign-up is a two-step flow:
 *   1. Create the user account (better-auth email/password).
 *   2. Create an org and set it as active — every authenticated route in the
 *      API requires `session.organizationId` to be populated.
 *
 * We run both steps in one submit so the user never lands on an
 * "orgless" session state.
 */
export default function SignUpPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [orgName, setOrgName] = useState("");
  const [submitting, setSubmitting] = useState(false);

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

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const { error: signUpError } = await authClient.signUp.email({
        name,
        email,
        password,
      });
      if (signUpError) {
        toast.error(signUpError.message ?? "Sign-up failed.");
        return;
      }

      const slug = deriveSlug(orgName);
      const { data: org, error: orgError } =
        await authClient.organization.create({ name: orgName, slug });
      if (orgError || !org) {
        toast.error(
          orgError?.message ??
            "Account created but organization setup failed — contact support.",
        );
        return;
      }

      await authClient.organization.setActive({ organizationId: org.id });
      toast.success("Welcome to letmepost.");
      router.push("/");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Sign-up request failed.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Create an account</CardTitle>
        <CardDescription>
          One user, one organization. You can invite teammates later.
        </CardDescription>
      </CardHeader>
      <form onSubmit={onSubmit}>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Your name</Label>
            <Input
              id="name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="orgName">Organization name</Label>
            <Input
              id="orgName"
              required
              placeholder="Acme Robotics"
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
            />
          </div>
        </CardContent>
        <CardFooter className="flex flex-col gap-3">
          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting ? "Creating…" : "Create account"}
          </Button>
          <p className="text-xs text-muted-foreground">
            Already have an account?{" "}
            <Link className="underline" href="/sign-in">
              Sign in
            </Link>
          </p>
        </CardFooter>
      </form>
    </Card>
  );
}
