"use client";

import { QueryClient } from "@tanstack/react-query";

/**
 * Single QueryClient instance for the app. Defaults tuned for an operator
 * console: refetch on focus is on (we want fresh data when the user comes
 * back to the tab), 1 retry only (the API surfaces typed errors we'd rather
 * show than silently retry), 30s staleTime so navigating between screens
 * doesn't refetch every list mid-session.
 */
export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: true,
        retry: 1,
      },
      mutations: {
        retry: 0,
      },
    },
  });
}
