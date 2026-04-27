import "dotenv/config";
import { migrate as migrateNeon } from "drizzle-orm/neon-serverless/migrator";
import { migrate as migratePg } from "drizzle-orm/postgres-js/migrator";
import { createDb } from "./index.js";

/**
 * Programmatic migration runner — runs the SQL files in `apps/api/drizzle/`
 * against `DATABASE_URL`. Drives our Railway deploy step without needing
 * drizzle-kit (a CLI) in the production image.
 *
 * Driver selection mirrors `createDb`: Neon URLs use the Neon migrator,
 * everything else uses the postgres-js migrator. Both read the same
 * `migrationsFolder` and `__drizzle_migrations` ledger so it doesn't matter
 * which driver applied a given migration first.
 *
 * Run via `pnpm --filter @letmepost/api migrate` (alias mapped in
 * package.json) — both dev and prod use the same entry point.
 */

const MIGRATIONS_FOLDER = "./drizzle";

async function main() {
  const handle = createDb();
  console.log(`[migrate] driver=${handle.kind} starting…`);
  try {
    if (handle.kind === "neon") {
      await migrateNeon(handle.db as Parameters<typeof migrateNeon>[0], {
        migrationsFolder: MIGRATIONS_FOLDER,
      });
    } else {
      await migratePg(handle.db as Parameters<typeof migratePg>[0], {
        migrationsFolder: MIGRATIONS_FOLDER,
      });
    }
    console.log(`[migrate] done.`);
  } finally {
    await handle.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[migrate] failed:", err);
    process.exit(1);
  });
