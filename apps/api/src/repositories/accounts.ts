import { and, eq } from "drizzle-orm";
import type { DrizzleClient } from "../db/index.js";
import { accounts, type Account as AccountRow } from "../db/schema/accounts.js";
import { decrypt, encrypt } from "../encryption/envelope.js";

type Platform = AccountRow["platform"];

/**
 * Account as seen by callers — the raw `token` is plaintext (decrypted on read).
 * All envelope columns are stripped. Callers must never see ciphertext.
 */
export type DecryptedAccount = {
  id: string;
  organizationId: string;
  platform: Platform;
  platformAccountId: string;
  displayName: string | null;
  token: string;
  tokenMetadata: Record<string, unknown> | null;
  tokenExpiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type CreateAccountInput = {
  organizationId: string;
  platform: Platform;
  platformAccountId: string;
  displayName?: string | null;
  token: string;
  tokenMetadata?: Record<string, unknown> | null;
  tokenExpiresAt?: Date | null;
};

export type UpdateTokenInput = {
  token: string;
  tokenMetadata?: Record<string, unknown> | null;
  tokenExpiresAt?: Date | null;
};

export interface AccountsRepository {
  create(input: CreateAccountInput): Promise<DecryptedAccount>;
  findById(id: string): Promise<DecryptedAccount | null>;
  findByOrgAndPlatform(
    organizationId: string,
    platform: Platform,
    platformAccountId: string,
  ): Promise<DecryptedAccount | null>;
  listByOrg(organizationId: string): Promise<DecryptedAccount[]>;
  delete(id: string): Promise<boolean>;
  updateToken(id: string, input: UpdateTokenInput): Promise<DecryptedAccount>;
}

function hydrate(row: AccountRow): DecryptedAccount {
  const token = decrypt({
    ciphertext: row.tokenCiphertext,
    dekCiphertext: row.tokenDekCiphertext,
    iv: row.tokenIv,
    authTag: row.tokenAuthTag,
  });
  return {
    id: row.id,
    organizationId: row.organizationId,
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

export class DrizzleAccountsRepository implements AccountsRepository {
  constructor(private readonly db: DrizzleClient) {}

  async create(input: CreateAccountInput): Promise<DecryptedAccount> {
    const envelope = encrypt(input.token);
    const [row] = await this.db
      .insert(accounts)
      .values({
        organizationId: input.organizationId,
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
    if (!row) throw new Error("accounts.create returned no row");
    return hydrate(row);
  }

  async findById(id: string): Promise<DecryptedAccount | null> {
    const rows = await this.db
      .select()
      .from(accounts)
      .where(eq(accounts.id, id))
      .limit(1);
    const row = rows[0];
    return row ? hydrate(row) : null;
  }

  async findByOrgAndPlatform(
    organizationId: string,
    platform: Platform,
    platformAccountId: string,
  ): Promise<DecryptedAccount | null> {
    const rows = await this.db
      .select()
      .from(accounts)
      .where(
        and(
          eq(accounts.organizationId, organizationId),
          eq(accounts.platform, platform),
          eq(accounts.platformAccountId, platformAccountId),
        ),
      )
      .limit(1);
    const row = rows[0];
    return row ? hydrate(row) : null;
  }

  async listByOrg(organizationId: string): Promise<DecryptedAccount[]> {
    const rows = await this.db
      .select()
      .from(accounts)
      .where(eq(accounts.organizationId, organizationId));
    return rows.map(hydrate);
  }

  async delete(id: string): Promise<boolean> {
    const rows = await this.db
      .delete(accounts)
      .where(eq(accounts.id, id))
      .returning();
    return rows.length > 0;
  }

  async updateToken(
    id: string,
    input: UpdateTokenInput,
  ): Promise<DecryptedAccount> {
    const envelope = encrypt(input.token);
    const [row] = await this.db
      .update(accounts)
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
      .where(eq(accounts.id, id))
      .returning();
    if (!row) throw new Error(`accounts.updateToken: no account with id=${id}`);
    return hydrate(row);
  }
}
