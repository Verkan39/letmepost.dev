import { Hono } from "hono";
import type { DrizzleClient } from "./db/index.js";
import { db as defaultDb } from "./db/instance.js";
import { onError } from "./errors.js";
import { apiKeyRoutes } from "./routes/api-keys.js";
import { authRoutes } from "./routes/auth.js";
import { health } from "./routes/health.js";
import { posts } from "./routes/posts.js";

declare module "hono" {
  interface ContextVariableMap {
    db: DrizzleClient;
  }
}

export type AppOptions = {
  /** Override the Drizzle client — useful in tests to run inside a transaction. */
  db?: DrizzleClient;
};

export function createApp(options: AppOptions = {}) {
  const db = options.db ?? defaultDb;
  const app = new Hono();

  // Make the db available to every downstream route / middleware.
  app.use("*", async (c, next) => {
    c.set("db", db);
    await next();
  });

  app.route("/api/auth", authRoutes);
  app.route("/v1/api-keys", apiKeyRoutes);
  app.route("/health", health);
  app.route("/posts", posts);
  app.route("/v1/posts", posts);
  app.onError(onError);
  return app;
}

export type App = ReturnType<typeof createApp>;
