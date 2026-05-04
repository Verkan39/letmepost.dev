import { platformFetch } from "../_shared/http.js";
import {
  META_GRAPH_BASE,
  META_GRAPH_VERSION,
  mapMetaError,
} from "../meta/client.js";

const PLATFORM = "facebook";

/**
 * FB Page publishing client. Wraps the three /v23.0/{page-id}/* write
 * endpoints we use:
 *
 *   - POST /{page-id}/feed        → text or link share, optionally
 *                                   `attached_media` for multi-photo
 *   - POST /{page-id}/photos      → single photo (or unpublished photo
 *                                   when building a multi-photo post)
 *   - POST /{page-id}/videos      → video upload via `file_url`
 *
 * Auth is the Page Access Token, NOT the User Access Token. Pass it in
 * the constructor — we never derive Page tokens here; the provider does
 * that during connect via `GET /me/accounts`.
 */
export class FacebookClient {
  constructor(
    private readonly accessToken: string,
    private readonly pageId: string,
    private readonly graphBase: string = META_GRAPH_BASE,
    private readonly version: string = META_GRAPH_VERSION,
  ) {}

  private url(path: string, query: Record<string, string> = {}): string {
    const u = new URL(`${this.graphBase}/${this.version}${path}`);
    u.searchParams.set("access_token", this.accessToken);
    for (const [k, v] of Object.entries(query)) u.searchParams.set(k, v);
    return u.toString();
  }

  /**
   * `POST /{page-id}/feed` — text post, link share, or multi-photo post
   * (when `attached_media` is supplied with previously-uploaded photo
   * fbids). Returns the new post's id.
   */
  async createFeedPost(input: {
    message?: string;
    link?: string;
    /** Array of `{ media_fbid }` from prior unpublished /photos calls. */
    attachedMedia?: Array<{ media_fbid: string }>;
  }): Promise<{ id: string }> {
    const body: Record<string, unknown> = {};
    if (input.message !== undefined) body.message = input.message;
    if (input.link !== undefined) body.link = input.link;
    if (input.attachedMedia && input.attachedMedia.length > 0) {
      // FB wants attached_media as a JSON-encoded string in form data.
      body.attached_media = JSON.stringify(input.attachedMedia);
    }

    const res = await platformFetch<{ id: string }>({
      method: "POST",
      url: this.url(`/${encodeURIComponent(this.pageId)}/feed`),
      headers: { "Content-Type": "application/json" },
      body,
      platform: PLATFORM,
    });
    if (!res.ok || !res.body?.id) {
      throw mapMetaError(res, { platform: PLATFORM });
    }
    return res.body;
  }

  /**
   * `POST /{page-id}/photos` — upload a photo. Set `published=false` to
   * use this as a child of a multi-photo /feed post; set true (default)
   * for a standalone single-photo post.
   *
   * Returns `{ id }` — for unpublished photos, this id is the
   * `media_fbid` value to put in /feed's `attached_media`.
   */
  async uploadPhoto(input: {
    url: string;
    caption?: string;
    published?: boolean;
  }): Promise<{ id: string; post_id?: string }> {
    const body: Record<string, unknown> = { url: input.url };
    if (input.caption !== undefined) body.caption = input.caption;
    if (input.published === false) body.published = false;

    const res = await platformFetch<{ id: string; post_id?: string }>({
      method: "POST",
      url: this.url(`/${encodeURIComponent(this.pageId)}/photos`),
      headers: { "Content-Type": "application/json" },
      body,
      platform: PLATFORM,
    });
    if (!res.ok || !res.body?.id) {
      throw mapMetaError(res, { platform: PLATFORM });
    }
    return res.body;
  }

  /**
   * `POST /{page-id}/videos` — upload a video by URL. Returns the new
   * video's id; the post-on-feed id arrives lazily after Meta finishes
   * transcoding (we don't poll for it here — the response id is enough
   * to surface as `platformAccountId` of the post).
   */
  async uploadVideo(input: {
    fileUrl: string;
    description?: string;
    title?: string;
  }): Promise<{ id: string }> {
    const body: Record<string, unknown> = { file_url: input.fileUrl };
    if (input.description !== undefined) body.description = input.description;
    if (input.title !== undefined) body.title = input.title;

    const res = await platformFetch<{ id: string }>({
      method: "POST",
      url: this.url(`/${encodeURIComponent(this.pageId)}/videos`),
      headers: { "Content-Type": "application/json" },
      body,
      platform: PLATFORM,
    });
    if (!res.ok || !res.body?.id) {
      throw mapMetaError(res, { platform: PLATFORM });
    }
    return res.body;
  }
}
