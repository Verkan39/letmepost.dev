import { createHash, randomBytes } from "node:crypto";
import type { DrizzleClient } from "./index.js";
import { apiKeys } from "./schema/api_keys.js";
import { organizationMembers } from "./schema/organization_members.js";
import { organizations } from "./schema/organizations.js";
import { users } from "./schema/users.js";
import { DrizzleAccountsRepository } from "../repositories/accounts.js";

export type SeedFixture = {
  organizationId: string;
  userId: string;
  apiKey: {
    id: string;
    plaintext: string;
    prefix: "lmp_live_" | "lmp_test_";
    last4: string;
  };
  accountId: string;
};

export type SeedOptions = {
  orgName?: string;
  orgSlug?: string;
  userEmail?: string;
  blueskyHandle?: string;
  blueskyAppPassword?: string;
  apiKeyPrefix?: "lmp_live_" | "lmp_test_";
};

function hashApiKey(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

/**
 * Test-only seed helper. Creates one org, one user, one org membership, one API key,
 * and one Bluesky account (token encrypted via the envelope module). Returns ids and
 * the plaintext API key so tests can assert round-tripped behavior.
 *
 * Not wired to a CLI — import this from your test file. For integration tests, wrap
 * the whole test in a Drizzle transaction and roll back.
 */
export async function seed(
  db: DrizzleClient,
  options: SeedOptions = {},
): Promise<SeedFixture> {
  const suffix = randomBytes(4).toString("hex");
  const orgName = options.orgName ?? `seed-org-${suffix}`;
  const orgSlug = options.orgSlug ?? `seed-${suffix}`;
  const userEmail = options.userEmail ?? `seed+${suffix}@letmepost.test`;
  const handle = options.blueskyHandle ?? `seed-${suffix}.bsky.social`;
  const appPassword = options.blueskyAppPassword ?? `test-${suffix}-password`;
  const prefix = options.apiKeyPrefix ?? "lmp_test_";

  const [org] = await db
    .insert(organizations)
    .values({ name: orgName, slug: orgSlug })
    .returning();
  if (!org) throw new Error("seed: failed to insert organization");

  const [user] = await db
    .insert(users)
    .values({ email: userEmail, name: "Seed User" })
    .returning();
  if (!user) throw new Error("seed: failed to insert user");

  await db
    .insert(organizationMembers)
    .values({ organizationId: org.id, userId: user.id, role: "owner" });

  const rawSecret = randomBytes(24).toString("base64url");
  const plaintext = `${prefix}${rawSecret}`;
  const last4 = plaintext.slice(-4);

  const [apiKey] = await db
    .insert(apiKeys)
    .values({
      organizationId: org.id,
      name: "seed-key",
      prefix,
      hashedKey: hashApiKey(plaintext),
      last4,
      scopes: ["posts:write"],
    })
    .returning();
  if (!apiKey) throw new Error("seed: failed to insert api key");

  const accountsRepo = new DrizzleAccountsRepository(db);
  const account = await accountsRepo.create({
    organizationId: org.id,
    platform: "bluesky",
    platformAccountId: handle,
    displayName: handle,
    token: appPassword,
    tokenMetadata: { handle },
  });

  return {
    organizationId: org.id,
    userId: user.id,
    apiKey: { id: apiKey.id, plaintext, prefix, last4 },
    accountId: account.id,
  };
}
