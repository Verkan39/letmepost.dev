import { createDb } from "./index.js";

/**
 * Process-wide Drizzle client. Build-once, share across routes and middleware
 * so we don't open a new connection pool per module.
 */
export const { db } = createDb();
