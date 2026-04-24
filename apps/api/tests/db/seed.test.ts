import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { apiKeys } from "../../src/db/schema/api_keys.js";
import { platformAccounts } from "../../src/db/schema/platform_accounts.js";
import { seed } from "../../src/db/seed.js";
import { DrizzlePlatformAccountsRepository } from "../../src/repositories/platform-accounts.js";
import {
  canRunDbTests,
  closeTestDb,
  getTestDb,
  runInTransaction,
} from "./support.js";

const describeIfDb = canRunDbTests ? describe : describe.skip;

describeIfDb("seed harness (integration)", () => {
  afterAll(async () => {
    await closeTestDb();
  });

  it("creates org, user, member, api key, and bluesky platform account", async () => {
    const { db } = await getTestDb();
    await runInTransaction(db, async (tx) => {
      const fixture = await seed(tx);
      expect(fixture.organizationId).toMatch(/^[0-9a-f]{8}-/);
      expect(fixture.apiKey.plaintext.startsWith(fixture.apiKey.prefix)).toBe(
        true,
      );
      expect(fixture.apiKey.last4).toHaveLength(4);

      const [stored] = await tx
        .select()
        .from(apiKeys)
        .where(eq(apiKeys.id, fixture.apiKey.id));
      expect(stored!.hashedKey).not.toContain(fixture.apiKey.plaintext);

      const [acct] = await tx
        .select()
        .from(platformAccounts)
        .where(eq(platformAccounts.id, fixture.accountId));
      expect(acct!.tokenCiphertext).not.toContain("password");
      expect(acct!.platform).toBe("bluesky");

      const repo = new DrizzlePlatformAccountsRepository(tx);
      const decrypted = await repo.findById(fixture.accountId);
      expect(decrypted?.token).toMatch(/^test-.+-password$/);
    });
  });
});
