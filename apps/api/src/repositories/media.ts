import { and, desc, eq, lt, or } from "drizzle-orm";
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

export type ListMediaFilters = {
  organizationId: string;
  /** When set, scope to a specific profile; otherwise list all org media. */
  profileId?: string;
};

export type ListMediaOptions = {
  /** Page size. Repo clamps to [1, 100]. */
  limit?: number;
  /**
   * Opaque cursor from a previous response — encodes (createdAt, id) of the
   * last row on the previous page so we can keyset-paginate.
   */
  cursor?: string;
};

export type ListMediaResult = {
  data: Media[];
  nextCursor: string | null;
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
  list(
    filters: ListMediaFilters,
    opts?: ListMediaOptions,
  ): Promise<ListMediaResult>;
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

  async list(
    filters: ListMediaFilters,
    opts: ListMediaOptions = {},
  ): Promise<ListMediaResult> {
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100);
    const conds = [eq(media.organizationId, filters.organizationId)];
    if (filters.profileId) {
      conds.push(eq(media.profileId, filters.profileId));
    }

    if (opts.cursor) {
      const decoded = decodeCursor(opts.cursor);
      if (decoded) {
        // Keyset pagination on (createdAt desc, id desc) — strict less-than
        // tuple comparison, expressed as: createdAt < cursor.createdAt OR
        // (createdAt = cursor.createdAt AND id < cursor.id).
        conds.push(
          or(
            lt(media.createdAt, decoded.createdAt),
            and(
              eq(media.createdAt, decoded.createdAt),
              lt(media.id, decoded.id),
            ),
          )!,
        );
      }
    }

    const rows = await this.db
      .select()
      .from(media)
      .where(and(...conds))
      .orderBy(desc(media.createdAt), desc(media.id))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const data = hasMore ? rows.slice(0, limit) : rows;
    const last = data[data.length - 1];
    const nextCursor =
      hasMore && last ? encodeCursor(last.createdAt, last.id) : null;
    return { data, nextCursor };
  }
}

/**
 * Cursor format: base64url(JSON.stringify({ t: createdAt ISO, i: id })).
 * Opaque to callers — they round-trip the string verbatim.
 */
function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(
    JSON.stringify({ t: createdAt.toISOString(), i: id }),
    "utf-8",
  ).toString("base64url");
}

function decodeCursor(
  cursor: string,
): { createdAt: Date; id: string } | null {
  try {
    const parsed = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf-8"),
    ) as { t?: unknown; i?: unknown };
    if (typeof parsed.t !== "string" || typeof parsed.i !== "string") {
      return null;
    }
    const createdAt = new Date(parsed.t);
    if (Number.isNaN(createdAt.getTime())) return null;
    return { createdAt, id: parsed.i };
  } catch {
    return null;
  }
}

