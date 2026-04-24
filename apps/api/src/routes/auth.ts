import { Hono } from "hono";
import { auth } from "../auth.js";

/**
 * Mounts better-auth's Fetch-compatible handler at /api/auth/**. All sign-in
 * / sign-out / OAuth callback / session / organization routes are served from
 * here — better-auth owns the surface.
 */
export const authRoutes = new Hono();

authRoutes.on(["GET", "POST"], "/*", (c) => auth.handler(c.req.raw));
