import type { MiddlewareHandler } from "hono";
import { auth } from "../auth.js";
import { LetmepostError } from "../errors.js";

export type SessionContext = {
  userId: string;
  organizationId: string;
};

declare module "hono" {
  interface ContextVariableMap {
    session: SessionContext;
  }
}

/**
 * Requires a valid better-auth session and an active organization. Attaches
 * `{ userId, organizationId }` to `c.var.session`. Used by dashboard-facing
 * routes (e.g. /v1/api-keys) where humans sign in with Google or GitHub.
 */
export function requireSession(): MiddlewareHandler {
  return async (c, next) => {
    const result = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!result?.session || !result.user) {
      throw new LetmepostError({
        code: "unauthenticated",
        status: 401,
        message: "You must be signed in.",
        remediation: "Sign in via /api/auth/sign-in/social.",
      });
    }

    const activeOrganizationId = result.session.activeOrganizationId;
    if (!activeOrganizationId) {
      throw new LetmepostError({
        code: "unauthorized",
        status: 403,
        message: "No active organization on this session.",
        remediation:
          "Create or switch to an organization via /api/auth/organization/set-active.",
      });
    }

    c.set("session", {
      userId: result.user.id,
      organizationId: activeOrganizationId,
    });

    await next();
  };
}
