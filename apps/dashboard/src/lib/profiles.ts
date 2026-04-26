"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "./api";
import { authClient } from "./auth-client";

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
 * Hook fetching the active org's profiles and tracking which one the user
 * is "working in". Active profile is purely a client-side concept (the API
 * has no notion of per-session profile scope — callers always pass
 * `?profileId=` explicitly). Returns null until the org and first list
 * arrive so callers can render a skeleton.
 */
export function useActiveProfile(): UseActiveProfileResult {
  const { data: session } = authClient.useSession();
  const orgId = session?.session?.activeOrganizationId ?? null;

  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [isLoading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listProfiles();
      const list = res.data ?? [];
      setProfiles(list);
      // Reconcile localStorage selection against the fresh list.
      const stored = readActiveProfileId(orgId);
      const valid = stored && list.some((p) => p.id === stored) ? stored : null;
      const next = valid ?? list[0]?.id ?? null;
      setActiveId(next);
      if (orgId) writeActiveProfileId(orgId, next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load profiles.");
      setProfiles([]);
      setActiveId(null);
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    if (!orgId) {
      setProfiles([]);
      setActiveId(null);
      setLoading(false);
      return;
    }
    refresh();
  }, [orgId, refresh]);

  const setActiveProfile = useCallback(
    (id: string | null) => {
      setActiveId(id);
      if (orgId) writeActiveProfileId(orgId, id);
    },
    [orgId],
  );

  const activeProfile =
    profiles.find((p) => p.id === activeId) ?? null;

  return {
    profiles,
    activeProfile,
    setActiveProfile,
    refresh,
    isLoading,
    error,
  };
}
