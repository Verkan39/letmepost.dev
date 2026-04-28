import { and, eq } from "drizzle-orm";
import type { DrizzleClient } from "../db/index.js";
import { media, type Media } from "../db/schema/media.js";

export type CreateMediaInput = {
  /** Pre-generated id — caller controls because the S3 key needs the same value. */
  id: string;
  organizationId: string;
  profileId: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  s3Key: string;
};

export interface MediaRepository {
  create(input: CreateMediaInput): Promise<Media>;
  /**
   * Org-scoped lookup. Routes that already have a profileId in scope should
   * use `findByIdScoped` instead — this is for plumbing that only knows the
   * org (e.g. the post resolver after the api-key check).
   */
  findById(organizationId: string, id: string): Promise<Media | null>;
  findByIdScoped(args: {
    organizationId: string;
    profileId: string;
    id: string;
  }): Promise<Media | null>;
}

export class DrizzleMediaRepository implements MediaRepository {
  constructor(private readonly db: DrizzleClient) {}

  async create(input: CreateMediaInput): Promise<Media> {
    const [row] = await this.db
      .insert(media)
      .values({
        id: input.id,
        organizationId: input.organizationId,
        profileId: input.profileId,
        contentType: input.contentType,
        sizeBytes: input.sizeBytes,
        sha256: input.sha256,
        s3Key: input.s3Key,
      })
      .returning();
    if (!row) throw new Error("media.create returned no row");
    return row;
  }

  async findById(organizationId: string, id: string): Promise<Media | null> {
    const rows = await this.db
      .select()
      .from(media)
      .where(and(eq(media.id, id), eq(media.organizationId, organizationId)))
      .limit(1);
    return rows[0] ?? null;
  }

  async findByIdScoped(args: {
    organizationId: string;
    profileId: string;
    id: string;
  }): Promise<Media | null> {
    const rows = await this.db
      .select()
      .from(media)
      .where(
        and(
          eq(media.id, args.id),
          eq(media.organizationId, args.organizationId),
          eq(media.profileId, args.profileId),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }
}
