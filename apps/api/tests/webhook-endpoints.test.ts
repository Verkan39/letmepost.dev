import { afterAll, describe, expect, it } from "vitest";
import { member, organization, user } from "../src/db/schema/auth.js";
import { createApp } from "../src/app.js";
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
      email: `whe+${suffix}@letmepost.test`,
      name: `WHE User ${suffix}`,
      emailVerified: true,
    })
    .returning();
  const [org] = await tx
    .insert(organization)
    .values({ name: `whe-org-${suffix}`, slug: `whe-${suffix}` })
    .returning();
  await tx
    .insert(member)
    .values({ organizationId: org!.id, userId: u!.id, role: "owner" });
  return { userId: u!.id, organizationId: org!.id };
}

describeIfDb("/v1/webhook-endpoints (CRUD)", () => {
  afterAll(async () => {
    await closeTestDb();
  });

  it("POST creates an endpoint and returns the signing secret once", async () => {
    const { db } = await getTestDb();
    await runInTransaction(db, async (tx) => {
      const { userId, organizationId } = await seedOrg(tx);
      const app = createApp({
        db: tx,
        testSession: { userId, organizationId },
      });

      const res = await app.request("/v1/webhook-endpoints", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: "https://consumer.example/hook",
          events: ["post.published", "post.failed"],
          description: "prod",
        }),
      });

      expect(res.status).toBe(201);
      const body = (await res.json()) as {
        id: string;
        url: string;
        events: string[];
        active: boolean;
        signingSecret: string;
      };
      expect(body.url).toBe("https://consumer.example/hook");
      expect(body.events.sort()).toEqual(["post.failed", "post.published"]);
      expect(body.active).toBe(true);
      expect(body.signingSecret).toMatch(/^whsec_/);

      // GET one afterwards — secret must NOT be returned.
      const detail = await app.request(`/v1/webhook-endpoints/${body.id}`);
      expect(detail.status).toBe(200);
      const detailBody = (await detail.json()) as Record<string, unknown>;
      expect(detailBody.signingSecret).toBeUndefined();
      expect(detailBody.id).toBe(body.id);
    });
  });

  it("POST rejects invalid URLs and unknown event types", async () => {
    const { db } = await getTestDb();
    await runInTransaction(db, async (tx) => {
      const { userId, organizationId } = await seedOrg(tx);
      const app = createApp({
        db: tx,
        testSession: { userId, organizationId },
      });

      const badUrl = await app.request("/v1/webhook-endpoints", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: "not-a-url", events: [] }),
      });
      expect(badUrl.status).toBe(400);

      const badEvent = await app.request("/v1/webhook-endpoints", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: "https://x.example/hook",
          events: ["post.definitely_not_real"],
        }),
      });
      expect(badEvent.status).toBe(400);
    });
  });

  it("GET lists only the active org's endpoints (org isolation)", async () => {
    const { db } = await getTestDb();
    await runInTransaction(db, async (tx) => {
      const orgA = await seedOrg(tx);
      const orgB = await seedOrg(tx);

      const appA = createApp({ db: tx, testSession: orgA });
      const appB = createApp({ db: tx, testSession: orgB });

      await appA.request("/v1/webhook-endpoints", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: "https://a.example/hook", events: [] }),
      });
      await appB.request("/v1/webhook-endpoints", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: "https://b.example/hook", events: [] }),
      });

      const listA = await appA.request("/v1/webhook-endpoints");
      const listB = await appB.request("/v1/webhook-endpoints");
      const bodyA = (await listA.json()) as { data: { url: string }[] };
      const bodyB = (await listB.json()) as { data: { url: string }[] };

      expect(bodyA.data).toHaveLength(1);
      expect(bodyA.data[0]!.url).toBe("https://a.example/hook");
      expect(bodyB.data).toHaveLength(1);
      expect(bodyB.data[0]!.url).toBe("https://b.example/hook");
    });
  });

  it("GET /:id from another org returns 404 (not 200, not 403 — same as not-found)", async () => {
    const { db } = await getTestDb();
    await runInTransaction(db, async (tx) => {
      const orgA = await seedOrg(tx);
      const orgB = await seedOrg(tx);

      const appA = createApp({ db: tx, testSession: orgA });
      const appB = createApp({ db: tx, testSession: orgB });

      const created = await appA.request("/v1/webhook-endpoints", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: "https://a.example/hook", events: [] }),
      });
      const { id } = (await created.json()) as { id: string };

      const crossOrg = await appB.request(`/v1/webhook-endpoints/${id}`);
      expect(crossOrg.status).toBe(404);
    });
  });

  it("PATCH updates url / events / active, toggling disabledAt alongside", async () => {
    const { db } = await getTestDb();
    await runInTransaction(db, async (tx) => {
      const { userId, organizationId } = await seedOrg(tx);
      const app = createApp({
        db: tx,
        testSession: { userId, organizationId },
      });

      const created = await app.request("/v1/webhook-endpoints", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: "https://old.example/hook",
          events: ["post.queued"],
        }),
      });
      const { id } = (await created.json()) as { id: string };

      const patched = await app.request(`/v1/webhook-endpoints/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: "https://new.example/hook",
          events: ["post.published", "post.failed", "post.published"],
          active: false,
        }),
      });
      expect(patched.status).toBe(200);
      const body = (await patched.json()) as {
        url: string;
        events: string[];
        active: boolean;
      };
      expect(body.url).toBe("https://new.example/hook");
      expect(body.events.sort()).toEqual(["post.failed", "post.published"]);
      expect(body.active).toBe(false);
    });
  });

  it("PATCH /:id from another org returns 404", async () => {
    const { db } = await getTestDb();
    await runInTransaction(db, async (tx) => {
      const orgA = await seedOrg(tx);
      const orgB = await seedOrg(tx);
      const appA = createApp({ db: tx, testSession: orgA });
      const appB = createApp({ db: tx, testSession: orgB });

      const created = await appA.request("/v1/webhook-endpoints", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: "https://a.example/hook", events: [] }),
      });
      const { id } = (await created.json()) as { id: string };

      const crossOrg = await appB.request(`/v1/webhook-endpoints/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: false }),
      });
      expect(crossOrg.status).toBe(404);
    });
  });

  it("DELETE removes the endpoint; subsequent GET returns 404", async () => {
    const { db } = await getTestDb();
    await runInTransaction(db, async (tx) => {
      const { userId, organizationId } = await seedOrg(tx);
      const app = createApp({
        db: tx,
        testSession: { userId, organizationId },
      });

      const created = await app.request("/v1/webhook-endpoints", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: "https://x.example/hook", events: [] }),
      });
      const { id } = (await created.json()) as { id: string };

      const del = await app.request(`/v1/webhook-endpoints/${id}`, {
        method: "DELETE",
      });
      expect(del.status).toBe(200);
      const delBody = (await del.json()) as { deleted: boolean };
      expect(delBody.deleted).toBe(true);

      const after = await app.request(`/v1/webhook-endpoints/${id}`);
      expect(after.status).toBe(404);
    });
  });

  it("DELETE /:id from another org returns 404", async () => {
    const { db } = await getTestDb();
    await runInTransaction(db, async (tx) => {
      const orgA = await seedOrg(tx);
      const orgB = await seedOrg(tx);
      const appA = createApp({ db: tx, testSession: orgA });
      const appB = createApp({ db: tx, testSession: orgB });

      const created = await appA.request("/v1/webhook-endpoints", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: "https://a.example/hook", events: [] }),
      });
      const { id } = (await created.json()) as { id: string };

      const crossOrg = await appB.request(`/v1/webhook-endpoints/${id}`, {
        method: "DELETE",
      });
      expect(crossOrg.status).toBe(404);

      // And the endpoint still exists for its owner.
      const stillThere = await appA.request(`/v1/webhook-endpoints/${id}`);
      expect(stillThere.status).toBe(200);
    });
  });
});
