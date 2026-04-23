import { and, desc, eq, lt } from "drizzle-orm";
import type { PostStatus } from "@letmepost/schemas";
import type { DrizzleClient } from "../db/index.js";
import { posts, type Post } from "../db/schema/posts.js";

export type CreatePostInput = {
  organizationId: string;
  accountId: string;
  text: string;
  status?: PostStatus;
  mediaRefs?: unknown[];
  scheduledAt?: Date | null;
};

export type UpdatePostStatusInput = {
  status: PostStatus;
  publishedAt?: Date | null;
  platformUri?: string | null;
  platformCid?: string | null;
  error?: Record<string, unknown> | null;
};

export type ListByOrgOptions = {
  limit?: number;
  /** Return rows with `createdAt` strictly before this cursor (descending pagination). */
  before?: Date;
};

export interface PostsRepository {
  create(input: CreatePostInput): Promise<Post>;
  findById(id: string): Promise<Post | null>;
  updateStatus(id: string, input: UpdatePostStatusInput): Promise<Post>;
  listByOrg(organizationId: string, options?: ListByOrgOptions): Promise<Post[]>;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export class DrizzlePostsRepository implements PostsRepository {
  constructor(private readonly db: DrizzleClient) {}

  async create(input: CreatePostInput): Promise<Post> {
    const [row] = await this.db
      .insert(posts)
      .values({
        organizationId: input.organizationId,
        accountId: input.accountId,
        text: input.text,
        status: input.status ?? "queued",
        mediaRefs: input.mediaRefs ?? [],
        scheduledAt: input.scheduledAt ?? null,
      })
      .returning();
    if (!row) throw new Error("posts.create returned no row");
    return row;
  }

  async findById(id: string): Promise<Post | null> {
    const rows = await this.db
      .select()
      .from(posts)
      .where(eq(posts.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async updateStatus(
    id: string,
    input: UpdatePostStatusInput,
  ): Promise<Post> {
    const [row] = await this.db
      .update(posts)
      .set({
        status: input.status,
        ...(input.publishedAt !== undefined
          ? { publishedAt: input.publishedAt }
          : {}),
        ...(input.platformUri !== undefined
          ? { platformUri: input.platformUri }
          : {}),
        ...(input.platformCid !== undefined
          ? { platformCid: input.platformCid }
          : {}),
        ...(input.error !== undefined ? { error: input.error } : {}),
      })
      .where(eq(posts.id, id))
      .returning();
    if (!row) throw new Error(`posts.updateStatus: no post with id=${id}`);
    return row;
  }

  async listByOrg(
    organizationId: string,
    options: ListByOrgOptions = {},
  ): Promise<Post[]> {
    const limit = Math.min(options.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
    const where = options.before
      ? and(
          eq(posts.organizationId, organizationId),
          lt(posts.createdAt, options.before),
        )
      : eq(posts.organizationId, organizationId);
    return this.db
      .select()
      .from(posts)
      .where(where)
      .orderBy(desc(posts.createdAt))
      .limit(limit);
  }
}
