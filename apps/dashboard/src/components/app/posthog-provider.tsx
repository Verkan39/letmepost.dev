"use client";

import { useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import posthog from "posthog-js";
import { authClient } from "@/lib/auth-client";

const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const POSTHOG_HOST =
  process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com";

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const session = authClient.useSession().data;
  const activeOrg = authClient.useActiveOrganization().data;
  const lastUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!POSTHOG_KEY) return;
    if (typeof window === "undefined") return;
    if (posthog.__loaded) return;
    // `capture_pageview: false` because Next App Router doesn't fire the
    // DOM events PostHog listens for — we fire `$pageview` manually on
    // pathname/search changes below. Removing this would silently double-
    // count pageviews on the first hard load.
    posthog.init(POSTHOG_KEY, {
      api_host: POSTHOG_HOST,
      person_profiles: "identified_only",
      capture_pageview: false,
      capture_pageleave: true,
      autocapture: true,
    });
  }, []);

  useEffect(() => {
    if (!POSTHOG_KEY || !posthog.__loaded) return;
    const search = searchParams?.toString();
    const url = search ? `${pathname}?${search}` : pathname;
    posthog.capture("$pageview", { $current_url: url });
  }, [pathname, searchParams]);

  useEffect(() => {
    if (!POSTHOG_KEY || !posthog.__loaded) return;
    const user = session?.user;
    if (!user) {
      if (lastUserIdRef.current) {
        posthog.reset();
        lastUserIdRef.current = null;
      }
      return;
    }
    if (lastUserIdRef.current !== user.id) {
      posthog.identify(user.id, { email: user.email, name: user.name });
      lastUserIdRef.current = user.id;
    }
    if (activeOrg) {
      posthog.group("organization", activeOrg.id, {
        name: activeOrg.name,
        slug: activeOrg.slug,
      });
    }
  }, [session, activeOrg]);

  return children as React.ReactElement;
}
