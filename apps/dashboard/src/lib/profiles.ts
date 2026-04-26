"use client";

import { useCallback, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
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
  setActiveProfile: (id: string | null) => void;
  refresh: () => Promise<void>;
  isLoading: boolean;
  error: string | null;
};

/**
 * Hook fetching the active org's profiles via TanStack Query and tracking
 * which one the user is "working in". Active profile is purely a
 * client-side concept (the API has no notion of per-session profile
 * scope — callers always pass `?profileId=` explicitly). Returns null until
 * the org and first list arrive so callers can render a skeleton.
 */
export function useActiveProfile(): UseActiveProfileResult {
  const { data: session } = authClient.useSession();
  const orgId = session?.session?.activeOrganizationId ?? null;

  const query = useQuery({
    queryKey: queryKeys.profiles.list(),
    queryFn: () => listProfiles().then((r) => r.data ?? []),
    enabled: !!orgId,
  });

  const profiles = query.data ?? [];
  const [activeId, setActiveId] = useState<string | null>(null);

  // Reconcile the stored active profile id against the live list whenever
  // the list comes back or the org changes. Falls back to the first profile
  // when the stored id is missing / invalid.
  useEffect(() => {
    if (!orgId) {
      setActiveId(null);
      return;
    }
    const stored = readActiveProfileId(orgId);
    const valid =
      stored && profiles.some((p) => p.id === stored) ? stored : null;
    const next = valid ?? profiles[0]?.id ?? null;
    setActiveId(next);
    writeActiveProfileId(orgId, next);
    // We intentionally depend on the joined list of ids rather than the
    // array reference, so a refetch returning identical data is a no-op.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, profiles.map((p) => p.id).join("|")]);

  const setActiveProfile = useCallback(
    (id: string | null) => {
      setActiveId(id);
      if (orgId) writeActiveProfileId(orgId, id);
    },
    [orgId],
  );

  const refresh = useCallback(async () => {
    await query.refetch();
  }, [query]);

  const activeProfile = profiles.find((p) => p.id === activeId) ?? null;

  return {
    profiles,
    activeProfile,
    setActiveProfile,
    refresh,
    isLoading: query.isLoading,
    error: query.error
      ? query.error instanceof Error
        ? query.error.message
        : "Failed to load profiles."
      : null,
  };
}
