import { Hono } from "hono";
import { requestId } from "hono/request-id";
import type { DrizzleClient } from "./db/index.js";
import { db as defaultDb } from "./db/instance.js";
import { onError } from "./errors.js";
import type { SessionContext } from "./middleware/session.js";
import { apiKeyRoutes } from "./routes/api-keys.js";
import { authRoutes } from "./routes/auth.js";
import { health } from "./routes/health.js";
import { posts } from "./routes/posts.js";
import {
  createWebhookEndpointRoutes,
  webhookEndpointRoutes,
} from "./routes/webhook-endpoints.js";

declare module "hono" {
  interface ContextVariableMap {
    db: DrizzleClient;
    requestId: string;
    traceId?: string;
  }
}

export type AppOptions = {
  /** Override the Drizzle client — useful in tests to run inside a transaction. */
  db?: DrizzleClient;
  /**
   * Test-only: short-circuits `requireSession()` by pre-populating
   * `c.var.session` before any route middleware runs. Needed because
   * better-auth's `getSession` hits its own DB singleton and can't see inside
   * the per-test transaction used by the integration harness.
   */
  testSession?: SessionContext;
};

export function createApp(options: AppOptions = {}) {
  const db = options.db ?? defaultDb;
  const app = new Hono();

  // Per-request correlation id — echoed in x-request-id and stamped on error bodies.
  app.use("*", requestId());

  // Make the db available to every downstream route / middleware.
  app.use("*", async (c, next) => {
    c.set("db", db);
    await next();
  });

  app.route("/api/auth", authRoutes);
  app.route("/v1/api-keys", apiKeyRoutes);

  if (options.testSession) {
    // Test override: skip better-auth lookup, inject the provided session
    // directly. `requireSession()` would otherwise call `auth.api.getSession`,
    // which hits its own DB singleton and can't see a per-test transaction.
    const session = options.testSession;
    const injectSession: import("hono").MiddlewareHandler = async (c, next) => {
      c.set("session", session);
      await next();
    };
    app.route(
      "/v1/webhook-endpoints",
      createWebhookEndpointRoutes({ sessionMiddleware: injectSession }),
    );
  } else {
    app.route("/v1/webhook-endpoints", webhookEndpointRoutes);
  }

  app.route("/health", health);
  app.route("/posts", posts);
  app.route("/v1/posts", posts);
  app.onError(onError);
  return app;
}

export type App = ReturnType<typeof createApp>;
