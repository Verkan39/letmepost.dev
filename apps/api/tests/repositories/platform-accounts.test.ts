import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { organization } from "../../src/db/schema/auth.js";
import { platformAccounts } from "../../src/db/schema/platform_accounts.js";
import { posts } from "../../src/db/schema/posts.js";
import { DrizzlePlatformAccountsRepository } from "../../src/repositories/platform-accounts.js";
import {
  canRunDbTests,
  closeTestDb,
  getTestDb,
  runInTransaction,
} from "../db/support.js";

const describeIfDb = canRunDbTests ? describe : describe.skip;

describeIfDb("PlatformAccountsRepository (integration)", () => {
  afterAll(async () => {
    await closeTestDb();
  });

  it("round-trips plaintext token through encryption at rest", async () => {
    const { db } = await getTestDb();
    await runInTransaction(db, async (tx) => {
      const repo = new DrizzlePlatformAccountsRepository(tx);
      const [org] = await tx
        .insert(organization)
        .values({ name: "Acme", slug: `acme-${Date.now()}` })
        .returning();

      const plaintext = "bsky-app-password-round-trip";
      const created = await repo.create({
        organizationId: org!.id,
        platform: "bluesky",
        platformAccountId: "did:plc:test",
        displayName: "alice.bsky.social",
        token: plaintext,
      });
      expect(created.token).toBe(plaintext);

      const found = await repo.findById(created.id);
      expect(found?.token).toBe(plaintext);
    });
  });

  it("ciphertext column never equals plaintext", async () => {
    const { db } = await getTestDb();
    await runInTransaction(db, async (tx) => {
      const repo = new DrizzlePlatformAccountsRepository(tx);
      const [org] = await tx
        .insert(organization)
        .values({ name: "Acme", slug: `acme-${Date.now()}` })
        .returning();

      const plaintext = "super-secret-at-rest";
      const created = await repo.create({
        organizationId: org!.id,
        platform: "bluesky",
        platformAccountId: "did:plc:secret",
        token: plaintext,
      });

      const rows = await tx
        .select()
        .from(platformAccounts)
        .where(eq(platformAccounts.id, created.id));
      const row = rows[0]!;
      expect(row.tokenCiphertext).not.toBe(plaintext);
      expect(row.tokenCiphertext).not.toContain(plaintext);
      expect(
        Buffer.from(row.tokenCiphertext, "base64").toString("utf8"),
      ).not.toBe(plaintext);
      expect(row.tokenDekCiphertext).not.toContain(plaintext);
      expect(row.tokenIv).not.toBe("");
      expect(row.tokenAuthTag).not.toBe("");
    });
  });

  it("findByOrgAndPlatform scopes by org", async () => {
    const { db } = await getTestDb();
    await runInTransaction(db, async (tx) => {
      const repo = new DrizzlePlatformAccountsRepository(tx);
      const [orgA] = await tx
        .insert(organization)
        .values({ name: "A", slug: `a-${Date.now()}` })
        .returning();
      const [orgB] = await tx
        .insert(organization)
        .values({ name: "B", slug: `b-${Date.now()}` })
        .returning();

      await repo.create({
        organizationId: orgA!.id,
        platform: "bluesky",
        platformAccountId: "did:plc:shared",
        token: "token-a",
      });

      const foundInB = await repo.findByOrgAndPlatform(
        orgB!.id,
        "bluesky",
        "did:plc:shared",
      );
      expect(foundInB).toBeNull();

      const foundInA = await repo.findByOrgAndPlatform(
        orgA!.id,
        "bluesky",
        "did:plc:shared",
      );
      expect(foundInA?.token).toBe("token-a");
    });
  });

  it("updateToken replaces the envelope", async () => {
    const { db } = await getTestDb();
    await runInTransaction(db, async (tx) => {
      const repo = new DrizzlePlatformAccountsRepository(tx);
      const [org] = await tx
        .insert(organization)
        .values({ name: "Acme", slug: `acme-${Date.now()}` })
        .returning();

      const first = await repo.create({
        organizationId: org!.id,
        platform: "bluesky",
        platformAccountId: "did:plc:rotate",
        token: "old-password",
      });

      const updated = await repo.updateToken(first.id, {
        token: "new-password",
      });
      expect(updated.token).toBe("new-password");

      const refetched = await repo.findById(first.id);
      expect(refetched?.token).toBe("new-password");
    });
  });

  it("listByOrg returns decrypted accounts for the requested org only", async () => {
    const { db } = await getTestDb();
    await runInTransaction(db, async (tx) => {
      const repo = new DrizzlePlatformAccountsRepository(tx);
      const [orgA] = await tx
        .insert(organization)
        .values({ name: "A", slug: `a-${Date.now()}` })
        .returning();
      const [orgB] = await tx
        .insert(organization)
        .values({ name: "B", slug: `b-${Date.now()}` })
        .returning();

      await repo.create({
        organizationId: orgA!.id,
        platform: "bluesky",
        platformAccountId: "did:plc:a1",
        token: "t-a1",
      });
      await repo.create({
        organizationId: orgA!.id,
        platform: "bluesky",
        platformAccountId: "did:plc:a2",
        token: "t-a2",
      });
      await repo.create({
        organizationId: orgB!.id,
        platform: "bluesky",
        platformAccountId: "did:plc:b1",
        token: "t-b1",
      });

      const list = await repo.listByOrg(orgA!.id);
      expect(list).toHaveLength(2);
      const tokens = list.map((a) => a.token).sort();
      expect(tokens).toEqual(["t-a1", "t-a2"]);
    });
  });

  it("delete is idempotent and returns false when the row is gone", async () => {
    const { db } = await getTestDb();
    await runInTransaction(db, async (tx) => {
      const repo = new DrizzlePlatformAccountsRepository(tx);
      const [org] = await tx
        .insert(organization)
        .values({ name: "Acme", slug: `acme-${Date.now()}` })
        .returning();
      const created = await repo.create({
        organizationId: org!.id,
        platform: "bluesky",
        platformAccountId: "did:plc:delete-me",
        token: "t",
      });

      expect(await repo.delete(created.id)).toBe(true);
      expect(await repo.delete(created.id)).toBe(false);
      expect(await repo.findById(created.id)).toBeNull();
    });
  });

  it("deleting the organization cascades to its platform accounts and posts", async () => {
    const { db } = await getTestDb();
    await runInTransaction(db, async (tx) => {
      const repo = new DrizzlePlatformAccountsRepository(tx);
      const [org] = await tx
        .insert(organization)
        .values({ name: "Acme", slug: `acme-${Date.now()}` })
        .returning();

      const acct = await repo.create({
        organizationId: org!.id,
        platform: "bluesky",
        platformAccountId: "did:plc:cascade",
        token: "t",
      });

      await tx.insert(posts).values({
        organizationId: org!.id,
        accountId: acct.id,
        text: "hello",
      });

      await tx.delete(organization).where(eq(organization.id, org!.id));

      expect(await repo.findById(acct.id)).toBeNull();
      const remainingPosts = await tx
        .select()
        .from(posts)
        .where(eq(posts.accountId, acct.id));
      expect(remainingPosts).toHaveLength(0);
    });
  });
});
