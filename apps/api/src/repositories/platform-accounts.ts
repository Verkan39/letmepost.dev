import { and, eq } from "drizzle-orm";
import type { DrizzleClient } from "../db/index.js";
import {
  platformAccounts,
  type PlatformAccount as PlatformAccountRow,
} from "../db/schema/platform_accounts.js";
import { decrypt, encrypt } from "../encryption/envelope.js";

type Platform = PlatformAccountRow["platform"];

/**
 * Platform account as seen by callers — the raw `token` is plaintext (decrypted
 * on read). All envelope columns are stripped. Callers must never see ciphertext.
 */
export type DecryptedPlatformAccount = {
  id: string;
  organizationId: string;
  profileId: string;
  platform: Platform;
  platformAccountId: string;
  displayName: string | null;
  token: string;
  tokenMetadata: Record<string, unknown> | null;
  tokenExpiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type CreatePlatformAccountInput = {
  organizationId: string;
  profileId: string;
  platform: Platform;
  platformAccountId: string;
  displayName?: string | null;
  token: string;
  tokenMetadata?: Record<string, unknown> | null;
  tokenExpiresAt?: Date | null;
};

export type UpdatePlatformTokenInput = {
  token: string;
  tokenMetadata?: Record<string, unknown> | null;
  tokenExpiresAt?: Date | null;
};

export interface PlatformAccountsRepository {
  create(
    input: CreatePlatformAccountInput,
  ): Promise<DecryptedPlatformAccount>;
  findById(id: string): Promise<DecryptedPlatformAccount | null>;
  findByOrgAndPlatform(
    organizationId: string,
    platform: Platform,
    platformAccountId: string,
  ): Promise<DecryptedPlatformAccount | null>;
  listByOrg(organizationId: string): Promise<DecryptedPlatformAccount[]>;
  delete(id: string): Promise<boolean>;
  updateToken(
    id: string,
    input: UpdatePlatformTokenInput,
  ): Promise<DecryptedPlatformAccount>;
  /**
   * Patch tokenMetadata WITHOUT rotating the token. Caller-supplied keys
   * are merged with the existing metadata; pass `null` to clear a key.
   */
  updateMetadata(
    id: string,
    patch: Record<string, unknown>,
  ): Promise<DecryptedPlatformAccount>;
}

function hydrate(row: PlatformAccountRow): DecryptedPlatformAccount {
  const token = decrypt({
    ciphertext: row.tokenCiphertext,
    dekCiphertext: row.tokenDekCiphertext,
    iv: row.tokenIv,
    authTag: row.tokenAuthTag,
  });
  return {
    id: row.id,
    organizationId: row.organizationId,
    profileId: row.profileId,
    platform: row.platform,
    platformAccountId: row.platformAccountId,
    displayName: row.displayName,
    token,
    tokenMetadata: row.tokenMetadata ?? null,
    tokenExpiresAt: row.tokenExpiresAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class DrizzlePlatformAccountsRepository
  implements PlatformAccountsRepository
{
  constructor(private readonly db: DrizzleClient) {}

  async create(
    input: CreatePlatformAccountInput,
  ): Promise<DecryptedPlatformAccount> {
    const envelope = encrypt(input.token);
    const [row] = await this.db
      .insert(platformAccounts)
      .values({
        organizationId: input.organizationId,
        profileId: input.profileId,
        platform: input.platform,
        platformAccountId: input.platformAccountId,
        displayName: input.displayName ?? null,
        tokenCiphertext: envelope.ciphertext,
        tokenDekCiphertext: envelope.dekCiphertext,
        tokenIv: envelope.iv,
        tokenAuthTag: envelope.authTag,
        tokenMetadata: input.tokenMetadata ?? null,
        tokenExpiresAt: input.tokenExpiresAt ?? null,
      })
      .returning();
    if (!row) throw new Error("platformAccounts.create returned no row");
    return hydrate(row);
  }

  async findById(id: string): Promise<DecryptedPlatformAccount | null> {
    const rows = await this.db
      .select()
      .from(platformAccounts)
      .where(eq(platformAccounts.id, id))
      .limit(1);
    const row = rows[0];
    return row ? hydrate(row) : null;
  }

  async findByOrgAndPlatform(
    organizationId: string,
    platform: Platform,
    platformAccountId: string,
  ): Promise<DecryptedPlatformAccount | null> {
    const rows = await this.db
      .select()
      .from(platformAccounts)
      .where(
        and(
          eq(platformAccounts.organizationId, organizationId),
          eq(platformAccounts.platform, platform),
          eq(platformAccounts.platformAccountId, platformAccountId),
        ),
      )
      .limit(1);
    const row = rows[0];
    return row ? hydrate(row) : null;
  }

  async listByOrg(
    organizationId: string,
  ): Promise<DecryptedPlatformAccount[]> {
    const rows = await this.db
      .select()
      .from(platformAccounts)
      .where(eq(platformAccounts.organizationId, organizationId));
    return rows.map(hydrate);
  }

  async delete(id: string): Promise<boolean> {
    const rows = await this.db
      .delete(platformAccounts)
      .where(eq(platformAccounts.id, id))
      .returning();
    return rows.length > 0;
  }

  async updateMetadata(
    id: string,
    patch: Record<string, unknown>,
  ): Promise<DecryptedPlatformAccount> {
    const [existing] = await this.db
      .select({ tokenMetadata: platformAccounts.tokenMetadata })
      .from(platformAccounts)
      .where(eq(platformAccounts.id, id))
      .limit(1);
    if (!existing) {
      throw new Error(`platformAccounts.updateMetadata: no account with id=${id}`);
    }
    const current = (existing.tokenMetadata ?? {}) as Record<string, unknown>;
    const merged: Record<string, unknown> = { ...current };
    for (const [key, value] of Object.entries(patch)) {
      if (value === null) {
        delete merged[key];
      } else {
        merged[key] = value;
      }
    }
    const [row] = await this.db
      .update(platformAccounts)
      .set({ tokenMetadata: merged })
      .where(eq(platformAccounts.id, id))
      .returning();
    if (!row) {
      throw new Error(`platformAccounts.updateMetadata: no account with id=${id}`);
    }
    return hydrate(row);
  }

  async updateToken(
    id: string,
    input: UpdatePlatformTokenInput,
  ): Promise<DecryptedPlatformAccount> {
    const envelope = encrypt(input.token);
    const [row] = await this.db
      .update(platformAccounts)
      .set({
        tokenCiphertext: envelope.ciphertext,
        tokenDekCiphertext: envelope.dekCiphertext,
        tokenIv: envelope.iv,
        tokenAuthTag: envelope.authTag,
        ...(input.tokenMetadata !== undefined
          ? { tokenMetadata: input.tokenMetadata }
          : {}),
        ...(input.tokenExpiresAt !== undefined
          ? { tokenExpiresAt: input.tokenExpiresAt }
          : {}),
      })
      .where(eq(platformAccounts.id, id))
      .returning();
    if (!row) {
      throw new Error(`platformAccounts.updateToken: no account with id=${id}`);
    }
    return hydrate(row);
  }
}
