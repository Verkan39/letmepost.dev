import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { apiKeys } from "../../src/db/schema/api_keys.js";
import { member, organization, user } from "../../src/db/schema/auth.js";
import { idempotencyRecords } from "../../src/db/schema/idempotency_records.js";
import { platformAccounts } from "../../src/db/schema/platform_accounts.js";
import { platformVersions } from "../../src/db/schema/platform_versions.js";
import { posts } from "../../src/db/schema/posts.js";
import { profiles } from "../../src/db/schema/profiles.js";
import { webhookEndpoints } from "../../src/db/schema/webhook_endpoints.js";
import {
  canRunDbTests,
  closeTestDb,
  getTestDb,
  runInTransaction,
} from "./support.js";

const describeIfDb = canRunDbTests ? describe : describe.skip;

describeIfDb("schema integrity (integration)", () => {
  afterAll(async () => {
    await closeTestDb();
  });

  it("user.email is unique (case-sensitive)", async () => {
    const { db } = await getTestDb();
    await runInTransaction(db, async (tx) => {
      await tx
        .insert(user)
        .values({ email: "dup@example.com", name: "One", emailVerified: true });
      await expect(
        tx.insert(user).values({
          email: "dup@example.com",
          name: "Two",
          emailVerified: true,
        }),
      ).rejects.toThrow();
    });
  });

  it("organization.slug is unique", async () => {
    const { db } = await getTestDb();
    await runInTransaction(db, async (tx) => {
      await tx.insert(organization).values({ name: "One", slug: "dup-slug" });
      await expect(
        tx.insert(organization).values({ name: "Two", slug: "dup-slug" }),
      ).rejects.toThrow();
    });
  });

  it("api_keys.hashed_key is unique", async () => {
    const { db } = await getTestDb();
    await runInTransaction(db, async (tx) => {
      const [org] = await tx
        .insert(organization)
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

  it("member (org, user) is unique", async () => {
    const { db } = await getTestDb();
    await runInTransaction(db, async (tx) => {
      const [org] = await tx
        .insert(organization)
        .values({ name: "A", slug: `a-${Date.now()}` })
        .returning();
      const [u] = await tx
        .insert(user)
        .values({
          email: `m-${Date.now()}@ex.com`,
          name: "M",
          emailVerified: true,
        })
        .returning();
      await tx.insert(member).values({
        organizationId: org!.id,
        userId: u!.id,
        role: "admin",
      });
      await expect(
        tx.insert(member).values({
          organizationId: org!.id,
          userId: u!.id,
          role: "member",
        }),
      ).rejects.toThrow();
    });
  });

  it("idempotency_records (org, key) is unique", async () => {
    const { db } = await getTestDb();
    await runInTransaction(db, async (tx) => {
      const [org] = await tx
        .insert(organization)
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
        .insert(organization)
        .values({ name: "A", slug: `a-${Date.now()}` })
        .returning();
      const [profile] = await tx
        .insert(profiles)
        .values({
          organizationId: org!.id,
          name: "Default",
          slug: "default",
        })
        .returning();
      const [acct] = await tx
        .insert(platformAccounts)
        .values({
          organizationId: org!.id,
          profileId: profile!.id,
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
          accountId: acct!.id,
          text: "hello world",
        })
        .returning();
      expect(post!.status).toBe("queued");
      expect(post!.mediaRefs).toEqual([]);
      expect(post!.createdAt).toBeInstanceOf(Date);
      expect(post!.updatedAt).toBeInstanceOf(Date);
    });
  });

  it("member.role defaults to 'member'", async () => {
    const { db } = await getTestDb();
    await runInTransaction(db, async (tx) => {
      const [org] = await tx
        .insert(organization)
        .values({ name: "A", slug: `a-${Date.now()}` })
        .returning();
      const [u] = await tx
        .insert(user)
        .values({
          email: `r-${Date.now()}@ex.com`,
          name: "R",
          emailVerified: true,
        })
        .returning();
      const [row] = await tx
        .insert(member)
        .values({ organizationId: org!.id, userId: u!.id })
        .returning();
      expect(row!.role).toBe("member");
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
          secretHash: "h",
        }),
      ).rejects.toThrow();
    });
  });

  it("deleting a user cascades to their org memberships", async () => {
    const { db } = await getTestDb();
    await runInTransaction(db, async (tx) => {
      const [org] = await tx
        .insert(organization)
        .values({ name: "A", slug: `a-${Date.now()}` })
        .returning();
      const [u] = await tx
        .insert(user)
        .values({
          email: `c-${Date.now()}@ex.com`,
          name: "C",
          emailVerified: true,
        })
        .returning();
      await tx
        .insert(member)
        .values({ organizationId: org!.id, userId: u!.id });

      await tx.delete(user).where(eq(user.id, u!.id));

      const remaining = await tx
        .select()
        .from(member)
        .where(eq(member.userId, u!.id));
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
