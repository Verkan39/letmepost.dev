"use client";

import { createAuthClient } from "better-auth/react";
import { organizationClient } from "better-auth/client/plugins";
import { API_URL } from "./env";

/**
 * Browser-side better-auth client. The API server is separately mounted at
 * `/api/auth`, so the client's `baseURL` points at the API origin (default
 * http://localhost:3000). The `organization` plugin surfaces the multi-tenant
 * endpoints (`authClient.organization.create`, `.setActive`, `.list`) we use
 * during sign-up and in the sidebar org switcher.
 */
export const authClient = createAuthClient({
  baseURL: API_URL,
  fetchOptions: {
    credentials: "include",
  },
  plugins: [organizationClient()],
});

export const {
  signIn,
  signUp,
  signOut,
  useSession,
  organization,
} = authClient;
