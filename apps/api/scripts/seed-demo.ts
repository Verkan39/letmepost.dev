import "dotenv/config";
import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { auth } from "../src/auth.js";
import { db } from "../src/db/instance.js";
import { apiKeys } from "../src/db/schema/api_keys.js";
import { member, organization, user } from "../src/db/schema/auth.js";
import { posts } from "../src/db/schema/posts.js";
import { webhookEndpoints } from "../src/db/schema/webhook_endpoints.js";
import { DrizzlePlatformAccountsRepository } from "../src/repositories/platform-accounts.js";
import { DrizzleProfilesRepository } from "../src/repositories/profiles.js";

/**
 * Demo seed for `testuser@gmail.com`. Creates a sign-in-able user via
 * better-auth (correct password hashing), then attaches an org with two
 * profiles, two platform accounts, three API keys, two webhook endpoints,
 * and a spread of posts in every relevant status (queued, published,
 * failed-with-error-contract, rejected).
 *
 * Idempotent: if the user already exists we wipe their org's data and
 * re-seed. Safe to run repeatedly during dev.
 *
 *   pnpm --filter @letmepost/api seed:demo
 */

const EMAIL = "testuser@gmail.com";
const PASSWORD = "password123";
const NAME = "Test User";
const ORG_NAME = "Demo Co";
const ORG_SLUG = "demo-co";

function hashApiKey(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

function generateApiKey(prefix: "lmp_live_" | "lmp_test_"): string {
  return `${prefix}${randomBytes(24).toString("base64url")}`;
}

async function ensureUser(): Promise<{ id: string }> {
  const [existing] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, EMAIL))
    .limit(1);
  if (existing) {
    console.log(`  ✓ user already exists: ${EMAIL} (id=${existing.id})`);
    return existing;
  }

  console.log(`  → creating user via better-auth: ${EMAIL}`);
  const result = await auth.api.signUpEmail({
    body: { email: EMAIL, password: PASSWORD, name: NAME },
  });
  if (!result || !("user" in result) || !result.user?.id) {
    throw new Error(`better-auth signUpEmail returned no user: ${JSON.stringify(result)}`);
  }
  return { id: result.user.id };
}

async function wipeUserOrgs(userId: string): Promise<void> {
  // Find every org this user belongs to and cascade-delete via the
  // organizations row — schema CASCADEs handle members, profiles, accounts,
  // keys, posts, webhooks, etc.
  const orgs = await db
    .select({ id: member.organizationId })
    .from(member)
    .where(eq(member.userId, userId));
  for (const { id } of orgs) {
    await db.delete(organization).where(eq(organization.id, id));
  }
  if (orgs.length > 0) {
    console.log(`  ✓ wiped ${orgs.length} existing org(s) for user`);
  }
}

async function main() {
  console.log(`[seed-demo] seeding ${EMAIL}…`);

  const u = await ensureUser();
  await wipeUserOrgs(u.id);

  const [orgRow] = await db
    .insert(organization)
    .values({ name: ORG_NAME, slug: `${ORG_SLUG}-${randomBytes(2).toString("hex")}` })
    .returning();
  if (!orgRow) throw new Error("failed to insert organization");
  console.log(`  ✓ org: ${orgRow.name} (${orgRow.id})`);

  await db.insert(member).values({
    organizationId: orgRow.id,
    userId: u.id,
    role: "owner",
  });
  console.log(`  ✓ member: ${u.id} → ${orgRow.id} (owner)`);

  // --- Profiles -----------------------------------------------------------
  const profilesRepo = new DrizzleProfilesRepository(db);
  const defaultProfile = await profilesRepo.create({
    organizationId: orgRow.id,
    name: "Default",
    slug: "default",
  });
  const acmeProfile = await profilesRepo.create({
    organizationId: orgRow.id,
    name: "Acme Coffee",
    slug: "acme-coffee",
  });
  console.log(`  ✓ profiles: Default, Acme Coffee`);

  // --- Platform accounts --------------------------------------------------
  const accountsRepo = new DrizzlePlatformAccountsRepository(db);
  const blueskyAccount = await accountsRepo.create({
    organizationId: orgRow.id,
    profileId: defaultProfile.id,
    platform: "bluesky",
    platformAccountId: "demo.bsky.social",
    displayName: "demo.bsky.social",
    token: "demo-app-password-not-real",
    tokenMetadata: { handle: "demo.bsky.social" },
  });
  const linkedinAccount = await accountsRepo.create({
    organizationId: orgRow.id,
    profileId: acmeProfile.id,
    platform: "linkedin",
    platformAccountId: "urn:li:person:demo123",
    displayName: "Demo Acme",
    token: "demo-linkedin-token-not-real",
    tokenMetadata: { profileUrn: "urn:li:person:demo123" },
    tokenExpiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 60), // 60d
  });
  console.log(`  ✓ accounts: bluesky (Default), linkedin (Acme Coffee)`);

  // --- API keys -----------------------------------------------------------
  const keys: Array<{
    name: string;
    prefix: "lmp_live_" | "lmp_test_";
    profileId: string | null;
  }> = [
    { name: "production-server", prefix: "lmp_live_", profileId: null },
    { name: "ci-tests", prefix: "lmp_test_", profileId: null },
    { name: "acme-only", prefix: "lmp_live_", profileId: acmeProfile.id },
  ];
  for (const k of keys) {
    const plaintext = generateApiKey(k.prefix);
    await db.insert(apiKeys).values({
      organizationId: orgRow.id,
      profileId: k.profileId,
      name: k.name,
      prefix: k.prefix,
      hashedKey: hashApiKey(plaintext),
      last4: plaintext.slice(-4),
      scopes: ["posts:write", "posts:read"],
    });
  }
  console.log(`  ✓ api keys: 3 (1 live org-wide, 1 test org-wide, 1 live profile-scoped)`);

  // --- Webhook endpoints --------------------------------------------------
  function whSecret() {
    const plaintext = `whsec_${randomBytes(24).toString("base64url")}`;
    return {
      signingSecret: plaintext,
      secretHash: createHash("sha256").update(plaintext).digest("hex"),
    };
  }
  await db.insert(webhookEndpoints).values([
    {
      organizationId: orgRow.id,
      url: "https://example.com/hooks/letmepost",
      ...whSecret(),
      eventFilter: ["post.published", "post.failed"],
      description: "Prod Slack alerter",
      active: true,
    },
    {
      organizationId: orgRow.id,
      url: "https://example.com/hooks/dev",
      ...whSecret(),
      eventFilter: [],
      description: "Dev catch-all",
      active: true,
    },
  ]);
  console.log(`  ✓ webhook endpoints: 2`);

  // --- Posts (varied statuses + rich error contract) ----------------------
  const now = Date.now();
  const minuteAgo = (n: number) => new Date(now - n * 60_000);

  await db.insert(posts).values([
    {
      organizationId: orgRow.id,
      accountId: blueskyAccount.id,
      status: "published",
      text: "Hello world from letmepost.dev — first published post 🌱",
      publishedAt: minuteAgo(120),
      platformUri: "at://did:plc:demo/app.bsky.feed.post/3kfg2demo1",
      platformCid: "bafyreigdemodemo1",
      createdAt: minuteAgo(125),
    },
    {
      organizationId: orgRow.id,
      accountId: blueskyAccount.id,
      status: "published",
      text: "Shipped a thing today. Honest commit messages > performative ones.",
      publishedAt: minuteAgo(80),
      platformUri: "at://did:plc:demo/app.bsky.feed.post/3kfg2demo2",
      platformCid: "bafyreigdemodemo2",
      createdAt: minuteAgo(82),
    },
    {
      organizationId: orgRow.id,
      accountId: linkedinAccount.id,
      status: "published",
      text: "We just open-sourced our publishing layer. Failures are loud, preventable, documented. → letmepost.dev",
      publishedAt: minuteAgo(45),
      platformUri: "urn:li:share:7000000000000000001",
      createdAt: minuteAgo(46),
    },
    {
      organizationId: orgRow.id,
      accountId: blueskyAccount.id,
      status: "publishing",
      text: "In flight — should be live any second.",
      createdAt: minuteAgo(2),
    },
    {
      organizationId: orgRow.id,
      accountId: blueskyAccount.id,
      status: "queued",
      text: "Scheduled for later this afternoon.",
      scheduledAt: new Date(now + 1000 * 60 * 60 * 4),
      createdAt: minuteAgo(1),
    },
    {
      organizationId: orgRow.id,
      accountId: linkedinAccount.id,
      status: "failed",
      text: "This LinkedIn post is way over the 3,000-grapheme limit. ".repeat(120),
      error: {
        code: "preflight_failed",
        rule: "linkedin.text.grapheme_count",
        platform: "linkedin",
        platformVersion: "202504",
        message:
          "LinkedIn rejects posts longer than 3,000 graphemes; this draft is 6,840.",
        remediation:
          "Trim the body or split across multiple posts. Counting uses Intl.Segmenter so emoji + ZWJ count as 1.",
      },
      createdAt: minuteAgo(20),
    },
    {
      organizationId: orgRow.id,
      accountId: blueskyAccount.id,
      status: "failed",
      text: "Image attached — but the URL isn't reachable.",
      error: {
        code: "preflight_failed",
        rule: "media.url.reachable",
        platform: "bluesky",
        message:
          "Media URL returned 403 on HEAD request; Bluesky's blob upload would fail.",
        platformResponse: {
          url: "https://drive.google.com/file/d/abc/view",
          status: 403,
        },
        remediation:
          "Host the asset on a publicly reachable CDN (R2, S3 with public read, etc.) and retry.",
      },
      createdAt: minuteAgo(60),
    },
    {
      organizationId: orgRow.id,
      accountId: linkedinAccount.id,
      status: "rejected",
      text: "duplicate post body that was sent twice within the dedup window",
      error: {
        code: "platform_rejected",
        rule: "linkedin.duplicate",
        platform: "linkedin",
        platformVersion: "202504",
        message: "LinkedIn rejected the post: duplicate of a recent post.",
        platformResponse: {
          status: 422,
          body: { code: "DUPLICATE_POST", message: "Duplicate share detected." },
        },
        remediation:
          "LinkedIn dedupes identical content within ~24h. Wait, edit the text, or post from a different account.",
      },
      createdAt: minuteAgo(180),
    },
  ]);
  console.log(`  ✓ posts: 8 (3 published, 1 publishing, 1 queued, 2 failed, 1 rejected)`);

  console.log(`
[seed-demo] done. sign in as:
  email:    ${EMAIL}
  password: ${PASSWORD}
  org:      ${orgRow.name}
`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
