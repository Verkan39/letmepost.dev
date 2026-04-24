import { Hono, type MiddlewareHandler } from "hono";
import { requestId } from "hono/request-id";
import type { DrizzleClient } from "./db/index.js";
import { db as defaultDb } from "./db/instance.js";
import { onError } from "./errors.js";
import type { SessionContext } from "./middleware/session.js";
import {
  createDefaultPublishEnqueuer,
  type PublishEnqueuer,
} from "./queue/enqueue.js";
import { apiKeyRoutes } from "./routes/api-keys.js";
import { authRoutes } from "./routes/auth.js";
import { health } from "./routes/health.js";
import { posts } from "./routes/posts.js";
import {
  createWebhookEndpointRoutes,
  webhookEndpointRoutes,
} from "./routes/webhook-endpoints.js";
import {
  createDefaultWebhookDispatcher,
  type WebhookDispatcher,
} from "./webhooks/dispatch.js";

declare module "hono" {
  interface ContextVariableMap {
    db: DrizzleClient;
    requestId: string;
    traceId?: string;
    webhookDispatcher: WebhookDispatcher;
    publishEnqueuer: PublishEnqueuer;
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
  /** Override the webhook dispatcher — tests pass a capturing stub to assert events. */
  webhookDispatcher?: WebhookDispatcher;
  /** Override the publish enqueuer — tests pass a capturing stub to assert delays. */
  publishEnqueuer?: PublishEnqueuer;
};

export function createApp(options: AppOptions = {}) {
  const db = options.db ?? defaultDb;
  const webhookDispatcher =
    options.webhookDispatcher ?? createDefaultWebhookDispatcher(db);
  const publishEnqueuer =
    options.publishEnqueuer ?? createDefaultPublishEnqueuer();

  const app = new Hono();

  // Per-request correlation id — echoed in x-request-id and stamped on error bodies.
  app.use("*", requestId());

  // Make shared deps available to every downstream route / middleware.
  app.use("*", async (c, next) => {
    c.set("db", db);
    c.set("webhookDispatcher", webhookDispatcher);
    c.set("publishEnqueuer", publishEnqueuer);
    await next();
  });

  app.route("/api/auth", authRoutes);
  app.route("/v1/api-keys", apiKeyRoutes);

  if (options.testSession) {
    const session = options.testSession;
    const injectSession: MiddlewareHandler = async (c, next) => {
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
