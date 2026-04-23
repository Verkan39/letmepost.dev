import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { accounts } from "../../src/db/schema/accounts.js";
import { apiKeys } from "../../src/db/schema/api_keys.js";
import { idempotencyRecords } from "../../src/db/schema/idempotency_records.js";
import { organizationMembers } from "../../src/db/schema/organization_members.js";
import { organizations } from "../../src/db/schema/organizations.js";
import { platformVersions } from "../../src/db/schema/platform_versions.js";
import { posts } from "../../src/db/schema/posts.js";
import { users } from "../../src/db/schema/users.js";
import { webhookEndpoints } from "../../src/db/schema/webhook_endpoints.js";
import { canRunDbTests, closeTestDb, getTestDb, runInTransaction } from "./support.js";

const describeIfDb = canRunDbTests ? describe : describe.skip;

describeIfDb("schema integrity (integration)", () => {
  afterAll(async () => {
    await closeTestDb();
  });

  it("users.email is unique (case-sensitive)", async () => {
    const { db } = await getTestDb();
    await runInTransaction(db, async (tx) => {
      await tx.insert(users).values({ email: "dup@example.com" });
      await expect(
        tx.insert(users).values({ email: "dup@example.com" }),
      ).rejects.toThrow();
    });
  });

  it("organizations.slug is unique", async () => {
    const { db } = await getTestDb();
    await runInTransaction(db, async (tx) => {
      await tx.insert(organizations).values({ name: "One", slug: "dup-slug" });
      await expect(
        tx.insert(organizations).values({ name: "Two", slug: "dup-slug" }),
      ).rejects.toThrow();
    });
  });

  it("api_keys.hashed_key is unique", async () => {
    const { db } = await getTestDb();
    await runInTransaction(db, async (tx) => {
      const [org] = await tx
        .insert(organizations)
        .values({ name: "A", slug: `a-${Date.now()}` })
        .returning();
      const hashed = "deadbeef".repeat(8);
      await tx.insert(apiKeys).values({
        organizationId: org!.id,
        name: "one",
        prefix: "lmp_test_",
        hashedKey: hashed,
        last4: "abcd",
      });
      await expect(
        tx.insert(apiKeys).values({
          organizationId: org!.id,
          name: "two",
          prefix: "lmp_test_",
          hashedKey: hashed,
          last4: "efgh",
        }),
      ).rejects.toThrow();
    });
  });

  it("organization_members (org, user) is unique", async () => {
    const { db } = await getTestDb();
    await runInTransaction(db, async (tx) => {
      const [org] = await tx
        .insert(organizations)
        .values({ name: "A", slug: `a-${Date.now()}` })
        .returning();
      const [user] = await tx
        .insert(users)
        .values({ email: `m-${Date.now()}@ex.com` })
        .returning();
      await tx.insert(organizationMembers).values({
        organizationId: org!.id,
        userId: user!.id,
        role: "admin",
      });
      await expect(
        tx.insert(organizationMembers).values({
          organizationId: org!.id,
          userId: user!.id,
          role: "member",
        }),
      ).rejects.toThrow();
    });
  });

  it("idempotency_records (org, key) is unique", async () => {
    const { db } = await getTestDb();
    await runInTransaction(db, async (tx) => {
      const [org] = await tx
        .insert(organizations)
        .values({ name: "A", slug: `a-${Date.now()}` })
        .returning();
      await tx.insert(idempotencyRecords).values({
        organizationId: org!.id,
        key: "key-1",
        requestHash: "h1",
        statusCode: 200,
      });
      await expect(
        tx.insert(idempotencyRecords).values({
          organizationId: org!.id,
          key: "key-1",
          requestHash: "h1",
          statusCode: 200,
        }),
      ).rejects.toThrow();
    });
  });

  it("posts.status defaults to 'queued' and posts.media_refs defaults to empty array", async () => {
    const { db } = await getTestDb();
    await runInTransaction(db, async (tx) => {
      const [org] = await tx
        .insert(organizations)
        .values({ name: "A", slug: `a-${Date.now()}` })
        .returning();
      const [insertedAccount] = await tx
        .insert(accounts)
        .values({
          organizationId: org!.id,
          platform: "bluesky",
          platformAccountId: "did:plc:defaults",
          tokenCiphertext: "x",
          tokenDekCiphertext: "y",
          tokenIv: "z",
          tokenAuthTag: "w",
        })
        .returning();
      const [post] = await tx
        .insert(posts)
        .values({
          organizationId: org!.id,
          accountId: insertedAccount!.id,
          text: "hello world",
        })
        .returning();
      expect(post!.status).toBe("queued");
      expect(post!.mediaRefs).toEqual([]);
      expect(post!.createdAt).toBeInstanceOf(Date);
      expect(post!.updatedAt).toBeInstanceOf(Date);
    });
  });

  it("organization_members.role defaults to 'member'", async () => {
    const { db } = await getTestDb();
    await runInTransaction(db, async (tx) => {
      const [org] = await tx
        .insert(organizations)
        .values({ name: "A", slug: `a-${Date.now()}` })
        .returning();
      const [user] = await tx
        .insert(users)
        .values({ email: `r-${Date.now()}@ex.com` })
        .returning();
      const [member] = await tx
        .insert(organizationMembers)
        .values({ organizationId: org!.id, userId: user!.id })
        .returning();
      expect(member!.role).toBe("member");
    });
  });

  it("foreign keys reject non-existent org", async () => {
    const { db } = await getTestDb();
    await runInTransaction(db, async (tx) => {
      await expect(
        tx.insert(webhookEndpoints).values({
          organizationId: "00000000-0000-0000-0000-000000000000",
          url: "https://example.com/webhook",
          signingSecret: "s",
        }),
      ).rejects.toThrow();
    });
  });

  it("deleting a user cascades to their organization memberships", async () => {
    const { db } = await getTestDb();
    await runInTransaction(db, async (tx) => {
      const [org] = await tx
        .insert(organizations)
        .values({ name: "A", slug: `a-${Date.now()}` })
        .returning();
      const [user] = await tx
        .insert(users)
        .values({ email: `c-${Date.now()}@ex.com` })
        .returning();
      await tx.insert(organizationMembers).values({
        organizationId: org!.id,
        userId: user!.id,
      });

      await tx.delete(users).where(eq(users.id, user!.id));

      const remaining = await tx
        .select()
        .from(organizationMembers)
        .where(eq(organizationMembers.userId, user!.id));
      expect(remaining).toHaveLength(0);
    });
  });

  it("platform_versions.platform is unique (one row per platform)", async () => {
    const { db } = await getTestDb();
    await runInTransaction(db, async (tx) => {
      await tx
        .insert(platformVersions)
        .values({ platform: "bluesky", currentVersion: "n/a" });
      await expect(
        tx
          .insert(platformVersions)
          .values({ platform: "bluesky", currentVersion: "n/a" }),
      ).rejects.toThrow();
    });
  });
});
