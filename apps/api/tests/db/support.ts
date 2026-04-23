import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { migrate as migrateNeon } from "drizzle-orm/neon-serverless/migrator";
import { migrate as migratePg } from "drizzle-orm/postgres-js/migrator";
import {
  __resetKekCacheForTests,
  decrypt,
  encrypt,
} from "../../src/encryption/envelope.js";
import { createDb, type DbHandle, type DrizzleClient } from "../../src/db/index.js";

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../drizzle",
);

/**
 * Per-test integration harness. Requires TEST_DATABASE_URL (a disposable Postgres —
 * local docker, a throwaway Neon branch, whatever). Falls back to skipping when unset
 * so the fast test loop still runs without external infra.
 *
 * Each test wraps its work in a transaction that ends with a rollback, so the database
 * is effectively empty between tests without needing truncate/reset.
 */

let handlePromise: Promise<DbHandle> | null = null;

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
export const canRunDbTests = typeof TEST_DATABASE_URL === "string" && TEST_DATABASE_URL.length > 0;

export function ensureKekForTests(): void {
  if (!process.env.KEK_MASTER) {
    process.env.KEK_MASTER = randomBytes(32).toString("base64");
  }
  __resetKekCacheForTests();
}

async function initHandle(): Promise<DbHandle> {
  if (!canRunDbTests) {
    throw new Error("TEST_DATABASE_URL not set — DB tests cannot run");
  }
  const handle = createDb(TEST_DATABASE_URL);
  if (handle.kind === "neon") {
    await migrateNeon(handle.db as never, { migrationsFolder: MIGRATIONS_DIR });
  } else {
    await migratePg(handle.db as never, { migrationsFolder: MIGRATIONS_DIR });
  }
  return handle;
}

export async function getTestDb(): Promise<DbHandle> {
  ensureKekForTests();
  if (!handlePromise) {
    handlePromise = initHandle();
  }
  return handlePromise;
}

export async function closeTestDb(): Promise<void> {
  if (!handlePromise) return;
  const handle = await handlePromise;
  handlePromise = null;
  await handle.close();
}

class RollbackSignal extends Error {
  constructor() {
    super("__test_rollback__");
  }
}

/**
 * Run `fn` inside a transaction that always rolls back. Any value `fn` returns is
 * surfaced to the caller; any thrown error that isn't the rollback signal is re-thrown
 * (also rolling back).
 */
export async function runInTransaction<T>(
  db: DrizzleClient,
  fn: (tx: DrizzleClient) => Promise<T>,
): Promise<T> {
  let result!: T;
  try {
    await (db as unknown as {
      transaction: (cb: (tx: DrizzleClient) => Promise<unknown>) => Promise<unknown>;
    }).transaction(async (tx) => {
      result = await fn(tx);
      throw new RollbackSignal();
    });
  } catch (err) {
    if (!(err instanceof RollbackSignal)) throw err;
  }
  return result;
}

export { decrypt, encrypt };
