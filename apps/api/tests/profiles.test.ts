import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { member, organization, user } from "../src/db/schema/auth.js";
import { DrizzlePlatformAccountsRepository } from "../src/repositories/platform-accounts.js";
import { DrizzleProfilesRepository } from "../src/repositories/profiles.js";
import {
  canRunDbTests,
  closeTestDb,
  getTestDb,
  runInTransaction,
} from "./db/support.js";

const describeIfDb = canRunDbTests ? describe : describe.skip;

async function seedOrg(tx: Awaited<ReturnType<typeof getTestDb>>["db"]) {
  const suffix = Math.random().toString(36).slice(2, 8);
  const [u] = await tx
    .insert(user)
    .values({
      email: `prof+${suffix}@letmepost.test`,
      name: `Prof User ${suffix}`,
      emailVerified: true,
    })
    .returning();
  const [org] = await tx
    .insert(organization)
    .values({ name: `prof-org-${suffix}`, slug: `prof-${suffix}` })
    .returning();
  await tx
    .insert(member)
    .values({ organizationId: org!.id, userId: u!.id, role: "owner" });
  return { userId: u!.id, organizationId: org!.id };
}

describeIfDb("/v1/profiles (CRUD + isolation)", () => {
  afterAll(async () => {
    await closeTestDb();
  });

  it("POST creates a profile and returns the public view (no internal fields)", async () => {
    const { db } = await getTestDb();
    await runInTransaction(db, async (tx) => {
      const { userId, organizationId } = await seedOrg(tx);
      const app = createApp({
        db: tx,
        testSession: { userId, organizationId },
      });

      const res = await app.request("/v1/profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Acme Corp" }),
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as {
        id: string;
        name: string;
        slug: string;
      };
      expect(body.name).toBe("Acme Corp");
      expect(body.slug).toBe("acme-corp");
      // organizationId is not returned — clients infer it from session.
      expect((body as Record<string, unknown>).organizationId).toBeUndefined();
    });
  });

  it("POST rejects duplicate slugs within the same org with 409", async () => {
    const { db } = await getTestDb();
    await runInTransaction(db, async (tx) => {
      const { userId, organizationId } = await seedOrg(tx);
      const app = createApp({
        db: tx,
        testSession: { userId, organizationId },
      });

      const first = await app.request("/v1/profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Acme", slug: "acme" }),
      });
      expect(first.status).toBe(201);

      const second = await app.request("/v1/profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Acme Two", slug: "acme" }),
      });
      expect(second.status).toBe(409);
    });
  });

  it("GET lists only the active org's profiles (org isolation)", async () => {
    const { db } = await getTestDb();
    await runInTransaction(db, async (tx) => {
      const orgA = await seedOrg(tx);
      const orgB = await seedOrg(tx);

      const appA = createApp({ db: tx, testSession: orgA });
      const appB = createApp({ db: tx, testSession: orgB });

      await appA.request("/v1/profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "A1" }),
      });
      await appA.request("/v1/profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "A2" }),
      });
      await appB.request("/v1/profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "B1" }),
      });

      const listA = (await (await appA.request("/v1/profiles")).json()) as {
        data: { name: string }[];
      };
      const listB = (await (await appB.request("/v1/profiles")).json()) as {
        data: { name: string }[];
      };
      expect(listA.data.map((p) => p.name).sort()).toEqual(["A1", "A2"]);
      expect(listB.data.map((p) => p.name)).toEqual(["B1"]);
    });
  });

  it("GET /:id from another org returns 404 (not 403)", async () => {
    const { db } = await getTestDb();
    await runInTransaction(db, async (tx) => {
      const orgA = await seedOrg(tx);
      const orgB = await seedOrg(tx);

      const appA = createApp({ db: tx, testSession: orgA });
      const appB = createApp({ db: tx, testSession: orgB });

      const created = await appA.request("/v1/profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "A profile" }),
      });
      const { id } = (await created.json()) as { id: string };

      const cross = await appB.request(`/v1/profiles/${id}`);
      expect(cross.status).toBe(404);
    });
  });

  it("PATCH renames + re-slugs; rejects slug collisions", async () => {
    const { db } = await getTestDb();
    await runInTransaction(db, async (tx) => {
      const { userId, organizationId } = await seedOrg(tx);
      const app = createApp({
        db: tx,
        testSession: { userId, organizationId },
      });

      const a = await app
        .request("/v1/profiles", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "Alpha", slug: "alpha" }),
        })
        .then((r) => r.json() as Promise<{ id: string }>);
      await app.request("/v1/profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Beta", slug: "beta" }),
      });

      const renamed = await app.request(`/v1/profiles/${a.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Alpha 2", slug: "alpha-2" }),
      });
      expect(renamed.status).toBe(200);
      const body = (await renamed.json()) as { name: string; slug: string };
      expect(body.name).toBe("Alpha 2");
      expect(body.slug).toBe("alpha-2");

      const collide = await app.request(`/v1/profiles/${a.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: "beta" }),
      });
      expect(collide.status).toBe(409);
    });
  });

  it("DELETE refuses when the profile still owns platform accounts (409)", async () => {
    const { db } = await getTestDb();
    await runInTransaction(db, async (tx) => {
      const { userId, organizationId } = await seedOrg(tx);
      const profileRepo = new DrizzleProfilesRepository(tx);
      const profile = await profileRepo.create({
        organizationId,
        name: "Has-Account",
        slug: "has-account",
      });

      const accountRepo = new DrizzlePlatformAccountsRepository(tx);
      await accountRepo.create({
        organizationId,
        profileId: profile.id,
        platform: "bluesky",
        platformAccountId: "did:plc:keepme",
        token: "t",
      });

      const app = createApp({
        db: tx,
        testSession: { userId, organizationId },
      });
      const res = await app.request(`/v1/profiles/${profile.id}`, {
        method: "DELETE",
      });
      expect(res.status).toBe(409);
      const body = (await res.json()) as { error: { rule: string } };
      expect(body.error.rule).toBe("profile.delete.not_empty");
    });
  });

  it("DELETE succeeds for an empty profile; subsequent GET returns 404", async () => {
    const { db } = await getTestDb();
    await runInTransaction(db, async (tx) => {
      const { userId, organizationId } = await seedOrg(tx);
      const app = createApp({
        db: tx,
        testSession: { userId, organizationId },
      });

      const created = await app
        .request("/v1/profiles", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "Empty" }),
        })
        .then((r) => r.json() as Promise<{ id: string }>);

      const del = await app.request(`/v1/profiles/${created.id}`, {
        method: "DELETE",
      });
      expect(del.status).toBe(200);

      const after = await app.request(`/v1/profiles/${created.id}`);
      expect(after.status).toBe(404);
    });
  });
});
