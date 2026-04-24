import { and, count, eq } from "drizzle-orm";
import type { DrizzleClient } from "../db/index.js";
import { platformAccounts } from "../db/schema/platform_accounts.js";
import { profiles, type Profile } from "../db/schema/profiles.js";

export type CreateProfileInput = {
  organizationId: string;
  name: string;
  slug: string;
};

export type UpdateProfileInput = {
  name?: string;
  slug?: string;
};

export interface ProfilesRepository {
  create(input: CreateProfileInput): Promise<Profile>;
  findById(id: string): Promise<Profile | null>;
  findByOrgAndSlug(
    organizationId: string,
    slug: string,
  ): Promise<Profile | null>;
  listByOrg(organizationId: string): Promise<Profile[]>;
  update(id: string, input: UpdateProfileInput): Promise<Profile>;
  /** Returns true on success, false if not found, throws on non-empty. */
  delete(id: string): Promise<boolean>;
  countAccounts(profileId: string): Promise<number>;
}

export class ProfileNotEmptyError extends Error {
  constructor(public readonly profileId: string, public readonly accountCount: number) {
    super(
      `profile ${profileId} cannot be deleted: it still owns ${accountCount} platform account(s)`,
    );
    this.name = "ProfileNotEmptyError";
  }
}

export class DrizzleProfilesRepository implements ProfilesRepository {
  constructor(private readonly db: DrizzleClient) {}

  async create(input: CreateProfileInput): Promise<Profile> {
    const [row] = await this.db
      .insert(profiles)
      .values({
        organizationId: input.organizationId,
        name: input.name,
        slug: input.slug,
      })
      .returning();
    if (!row) throw new Error("profiles.create returned no row");
    return row;
  }

  async findById(id: string): Promise<Profile | null> {
    const rows = await this.db
      .select()
      .from(profiles)
      .where(eq(profiles.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async findByOrgAndSlug(
    organizationId: string,
    slug: string,
  ): Promise<Profile | null> {
    const rows = await this.db
      .select()
      .from(profiles)
      .where(
        and(
          eq(profiles.organizationId, organizationId),
          eq(profiles.slug, slug),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async listByOrg(organizationId: string): Promise<Profile[]> {
    return this.db
      .select()
      .from(profiles)
      .where(eq(profiles.organizationId, organizationId))
      .orderBy(profiles.createdAt);
  }

  async update(id: string, input: UpdateProfileInput): Promise<Profile> {
    const set: Partial<typeof profiles.$inferInsert> = {};
    if (input.name !== undefined) set.name = input.name;
    if (input.slug !== undefined) set.slug = input.slug;
    const [row] = await this.db
      .update(profiles)
      .set(set)
      .where(eq(profiles.id, id))
      .returning();
    if (!row) throw new Error(`profiles.update: no row with id=${id}`);
    return row;
  }

  async delete(id: string): Promise<boolean> {
    const accountCount = await this.countAccounts(id);
    if (accountCount > 0) {
      throw new ProfileNotEmptyError(id, accountCount);
    }
    const rows = await this.db
      .delete(profiles)
      .where(eq(profiles.id, id))
      .returning();
    return rows.length > 0;
  }

  async countAccounts(profileId: string): Promise<number> {
    const [row] = await this.db
      .select({ value: count() })
      .from(platformAccounts)
      .where(eq(platformAccounts.profileId, profileId));
    return row?.value ?? 0;
  }
}

/**
 * Convert a free-form name to a URL-safe slug. Stable + deterministic;
 * truncated at 64 chars to fit the column. Empty / unicode-only inputs
 * fall back to a random suffix.
 */
export function slugify(input: string): string {
  const cleaned = input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  if (cleaned.length > 0) return cleaned;
  return `profile-${Math.random().toString(36).slice(2, 8)}`;
}
