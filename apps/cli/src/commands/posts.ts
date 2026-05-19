import kleur from "kleur";
import { apiFetch, failWithApiError } from "../client.js";
import { resolveProfileId } from "../config.js";
import { formatDate, renderTable } from "../format.js";

type Post = {
  id: string;
  accountId: string;
  platform: string;
  status: string;
  text: string;
  publishedAt: string | null;
  platformUri: string | null;
  createdAt: string;
};

type PostListResponse = {
  data: Post[];
  nextCursor: string | null;
};

export type PostsListOptions = {
  limit?: string;
  status?: string;
  platform?: string;
  cursor?: string;
  profile?: string;
};

/**
 * `lmp posts list` — paginated log of every per-target post row. We pass
 * `status` / `platform` through as comma-separated query params (the API
 * accepts repeated values or comma-joined; comma keeps the query string short).
 */
export async function runPostsList(options: PostsListOptions): Promise<void> {
  const params = new URLSearchParams();
  if (options.limit) params.set("limit", options.limit);
  if (options.status) params.set("status", options.status);
  if (options.platform) params.set("platform", options.platform);
  if (options.cursor) params.set("cursor", options.cursor);
  const profileId = resolveProfileId(options.profile);
  if (profileId) params.set("profileId", profileId);
  const qs = params.toString();
  const path = qs ? `/v1/posts?${qs}` : "/v1/posts";

  const result = await apiFetch<PostListResponse>(path);
  if (!result.ok) failWithApiError(result);

  const rows = result.body.data.map((p) => [
    p.id,
    p.platform,
    p.status,
    truncate(p.text, 40),
    formatDate(p.publishedAt ?? p.createdAt),
  ]);

  if (rows.length === 0) {
    process.stdout.write("No posts yet.\n");
    return;
  }
  process.stdout.write(
    `${renderTable(["ID", "PLATFORM", "STATUS", "TEXT", "TIME"], rows)}\n`,
  );
  if (result.body.nextCursor) {
    process.stdout.write(
      `${kleur.gray(`\nMore results — pass --cursor=${result.body.nextCursor} to continue.`)}\n`,
    );
  }
}

export type PostsGetOptions = {
  profile?: string;
};

/** `lmp posts get <id>` — JSON dump of the post detail (attempts + envelope). */
export async function runPostsGet(
  id: string,
  options: PostsGetOptions = {},
): Promise<void> {
  const profileId = resolveProfileId(options.profile);
  const qs = profileId
    ? `?${new URLSearchParams({ profileId }).toString()}`
    : "";
  const result = await apiFetch<unknown>(
    `/v1/posts/${encodeURIComponent(id)}${qs}`,
  );
  if (!result.ok) failWithApiError(result);
  process.stdout.write(`${JSON.stringify(result.body, null, 2)}\n`);
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}
