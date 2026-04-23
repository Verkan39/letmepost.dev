import { defineConfig } from "drizzle-kit";

// drizzle-kit generate works offline; migrate/push/studio need a real URL.
// The app itself (apps/api/src/db/index.ts) throws with a clear message if
// DATABASE_URL is missing at runtime.
const databaseUrl = process.env.DATABASE_URL ?? "postgres://localhost/placeholder";

export default defineConfig({
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: databaseUrl },
  strict: true,
  verbose: true,
});
