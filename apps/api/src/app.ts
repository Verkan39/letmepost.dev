import { Hono } from "hono";
import { health } from "./routes/health.js";
import { posts } from "./routes/posts.js";
import { onError } from "./errors.js";

export type AppEnv = {
  Variables: Record<string, never>;
};

export function createApp() {
  const app = new Hono<AppEnv>();
  app.route("/health", health);
  app.route("/posts", posts);
  app.onError(onError);
  return app;
}

export type App = ReturnType<typeof createApp>;
