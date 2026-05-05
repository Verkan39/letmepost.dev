"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "./api";
import { authClient } from "./auth-client";
import { queryKeys } from "./query-keys";

/**
 * Client mirror of the `/v1/profiles` contract. Profiles are org sub-units
 * grouping platform accounts; the dashboard exposes them as the agency-style
 * "client workspace" primitive without per-profile pricing (a deliberate
 * commercial wedge).
 */

export type Profile = {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  updatedAt: string;
};

export function listProfiles(): Promise<{ data: Profile[] }> {
  return apiFetch<{ data: Profile[] }>("/v1/profiles");
}

export function createProfile(input: {
  name: string;
  slug?: string;
}): Promise<Profile> {
  return apiFetch<Profile>("/v1/profiles", { method: "POST", body: input });
}

export function renameProfile(
  id: string,
  patch: { name?: string; slug?: string },
): Promise<Profile> {
  return apiFetch<Profile>(`/v1/profiles/${id}`, {
    method: "PATCH",
    body: patch,
  });
}

export function deleteProfile(id: string): Promise<{ id: string }> {
  return apiFetch<{ id: string }>(`/v1/profiles/${id}`, { method: "DELETE" });
}

export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || `profile-${Math.random().toString(36).slice(2, 8)}`
  );
}

const STORAGE_KEY = "letmepost.activeProfileId";

/**
 * Active profile is per-org: switching orgs shouldn't carry over a profile id
 * the new org doesn't own. We key the localStorage entry by org id so each
 * org remembers its own selection, with a graceful fallback to the first
 * profile when nothing is stored or the stored id is gone.
 */
function readActiveProfileId(orgId: string | null): string | null {
  if (!orgId || typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const map = JSON.parse(raw) as Record<string, string>;
    return map[orgId] ?? null;
  } catch {
    return null;
  }
}

function writeActiveProfileId(orgId: string, profileId: string | null) {
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const map = raw ? (JSON.parse(raw) as Record<string, string>) : {};
    if (profileId === null) delete map[orgId];
    else map[orgId] = profileId;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* swallow — quota/private-mode failures shouldn't break the app */
  }
}

export type UseActiveProfileResult = {
  profiles: Profile[];
  activeProfile: Profile | null;
  /** Stable id reference. Useful for query keys — equal across renders. */
  activeProfileId: string | null;
  setActiveProfile: (id: string | null) => void;
  refresh: () => Promise<void>;
  isLoading: boolean;
  error: string | null;
};

const ProfileContext = createContext<UseActiveProfileResult | null>(null);

/**
 * Single-source-of-truth provider for the active profile. Mount this once
 * inside the authed app shell (`(app)/layout.tsx`); every `useActiveProfile()`
 * caller below it shares the same `activeProfileId` reference.
 *
 * The previous implementation kept a `useState` inside the hook, so each
 * caller had its own copy: switching profile from the sidebar updated the
 * sidebar's local state and localStorage, but the accounts page's hook
 * instance never re-read. Same-tab `storage` events don't fire either, so
 * there was no propagation path.
 *
 * Two persistence guarantees this provider gives:
 *
 *   1. Per-org isolation — switching orgs never carries the previous org's
 *      profile selection over. Stored as `{ [orgId]: profileId }`.
 *   2. Cross-session — reload picks up the same profile the user last
 *      selected for the current org. Falls back to `profiles[0]` when the
 *      stored id has been deleted.
 *
 * Plus an invalidation guarantee: every transition of `activeProfileId`
 * invalidates the profile-scoped query keys (accounts, apiKeys, posts,
 * webhooks, media) so the UI never shows stale data from the previous
 * profile.
 */
export function ProfileProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const { data: session } = authClient.useSession();
  const orgId = session?.session?.activeOrganizationId ?? null;

  const query = useQuery({
    queryKey: queryKeys.profiles.list(),
    queryFn: () => listProfiles().then((r) => r.data ?? []),
    enabled: !!orgId,
  });

  const profiles = useMemo(() => query.data ?? [], [query.data]);

  // The `null` sentinel covers two states: "no org yet" and "list still
  // loading." Consumers gate their fetches on this, which is simpler than
  // surfacing a separate "ready" flag.
  const [activeId, setActiveId] = useState<string | null>(null);

  // Keep a ref to the previous active id so we can detect *transitions* —
  // we only want to invalidate when the user switches profiles, not on
  // initial hydration.
  const prevActiveIdRef = useRef<string | null>(null);

  // Reconcile the stored active profile id against the live list whenever
  // the list comes back or the org changes. Falls back to the first profile
  // when the stored id is missing / invalid.
  useEffect(() => {
    if (!orgId) {
      setActiveId(null);
      prevActiveIdRef.current = null;
      return;
    }
    const stored = readActiveProfileId(orgId);
    const valid =
      stored && profiles.some((p) => p.id === stored) ? stored : null;
    const next = valid ?? profiles[0]?.id ?? null;
    setActiveId(next);
    writeActiveProfileId(orgId, next);
    // Don't invalidate on the initial hydrate — only when the user is
    // already in the app and flips profile. Initial hydrate is just
    // "we now know which profile to fetch under" and the queries either
    // haven't fired yet or are gated on `!!activeProfileId`.
    prevActiveIdRef.current = next;
    // Depend on the joined ids rather than the array reference so a
    // refetch returning identical data is a no-op.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, profiles.map((p) => p.id).join("|")]);

  const setActiveProfile = useCallback(
    (id: string | null) => {
      if (id === activeId) return;
      setActiveId(id);
      if (orgId) writeActiveProfileId(orgId, id);

      // Invalidate every profile-scoped query so the UI refetches under
      // the new profile id. We invalidate by top-level key rather than
      // walking each variant — `invalidateQueries({ queryKey: ["accounts"] })`
      // matches `["accounts", profileId]` AND `["accounts", null]`, so a
      // page that's mid-render with the old key still gets the right data.
      //
      // Posts already include profileId in their filters object inside
      // the queryKey (`["posts", "list", { profileId, ... }]`), so the
      // top-level "posts" prefix invalidates them too.
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
      queryClient.invalidateQueries({ queryKey: ["apiKeys"] });
      queryClient.invalidateQueries({ queryKey: ["posts"] });
      queryClient.invalidateQueries({ queryKey: ["webhooks"] });
      queryClient.invalidateQueries({ queryKey: ["media"] });
    },
    [activeId, orgId, queryClient],
  );

  const refresh = useCallback(async () => {
    await query.refetch();
  }, [query]);

  const activeProfile = useMemo(
    () => profiles.find((p) => p.id === activeId) ?? null,
    [profiles, activeId],
  );

  const value = useMemo<UseActiveProfileResult>(
    () => ({
      profiles,
      activeProfile,
      activeProfileId: activeId,
      setActiveProfile,
      refresh,
      isLoading: query.isLoading,
      error: query.error
        ? query.error instanceof Error
          ? query.error.message
          : "Failed to load profiles."
        : null,
    }),
    [
      profiles,
      activeProfile,
      activeId,
      setActiveProfile,
      refresh,
      query.isLoading,
      query.error,
    ],
  );

  return (
    <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>
  );
}

/**
 * Read the active profile from context. Throws if used outside a
 * `ProfileProvider` so missing-mount bugs fail loudly at the consumer
 * rather than silently returning empty data.
 */
export function useActiveProfile(): UseActiveProfileResult {
  const ctx = useContext(ProfileContext);
  if (!ctx) {
    throw new Error(
      "useActiveProfile must be used within a <ProfileProvider>. " +
        "If you're seeing this on a public/auth page, you don't need profiles there.",
    );
  }
  return ctx;
}
