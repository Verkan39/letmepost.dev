import { platformFetch } from "../_shared/http.js";
import {
  META_GRAPH_BASE,
  META_GRAPH_VERSION,
  mapMetaError,
} from "../meta/client.js";

const PLATFORM = "instagram";

/**
 * Instagram Business publishing client. Uses the same Graph API host as
 * Facebook; the only auth difference is that the Page Access Token comes
 * from the linked Page (which the provider stores on each `instagram`
 * row at connect time).
 *
 * Three-step publish flow:
 *   1. POST /{ig-user-id}/media         → returns container `creation_id`
 *   2. GET  /{creation-id}?fields=status_code → poll until FINISHED
 *   3. POST /{ig-user-id}/media_publish → flips container into a real post
 *
 * For carousels, repeat (1) per child with `is_carousel_item=true`,
 * wait for each to FINISHED, then create a CAROUSEL container with
 * `children=[id1,id2,...]` and run (2) + (3) on the parent.
 */

export type InstagramContainerStatus =
  | "IN_PROGRESS"
  | "FINISHED"
  | "ERROR"
  | "EXPIRED"
  | "PUBLISHED";

export interface InstagramContainerStatusResponse {
  status_code: InstagramContainerStatus;
  /** Set when status_code === ERROR — the upstream reason. */
  status?: string;
}

export type InstagramMediaType = "IMAGE" | "VIDEO" | "REELS" | "CAROUSEL";

export interface InstagramCreateContainerInput {
  mediaType: InstagramMediaType;
  /** Required for IMAGE / single carousel-IMAGE child. */
  imageUrl?: string;
  /** Required for VIDEO / REELS / single carousel-VIDEO child. */
  videoUrl?: string;
  /** Caption — only valid on the parent (CAROUSEL or single-item) container. */
  caption?: string;
  /** Mark child containers as carousel items so they're not auto-published. */
  isCarouselItem?: boolean;
  /** Carousel parent only — child container ids in display order. */
  children?: string[];
  /** Per-image accessibility text (Meta calls this `alt_text`). */
  altText?: string;
}

export class InstagramClient {
  constructor(
    private readonly accessToken: string,
    private readonly igUserId: string,
    private readonly graphBase: string = META_GRAPH_BASE,
    private readonly version: string = META_GRAPH_VERSION,
  ) {}

  private url(path: string, query: Record<string, string> = {}): string {
    const u = new URL(`${this.graphBase}/${this.version}${path}`);
    u.searchParams.set("access_token", this.accessToken);
    for (const [k, v] of Object.entries(query)) u.searchParams.set(k, v);
    return u.toString();
  }

  /** `POST /{ig-user-id}/media` — create a media container. */
  async createContainer(
    input: InstagramCreateContainerInput,
  ): Promise<{ id: string }> {
    const body: Record<string, unknown> = {};
    // Only non-CAROUSEL containers carry media_type explicitly on the IG
    // API — single IMAGE containers are inferred from the presence of
    // `image_url`. We always set it for clarity / forward-compat.
    body.media_type = input.mediaType;
    if (input.imageUrl !== undefined) body.image_url = input.imageUrl;
    if (input.videoUrl !== undefined) body.video_url = input.videoUrl;
    if (input.caption !== undefined) body.caption = input.caption;
    if (input.isCarouselItem) body.is_carousel_item = true;
    if (input.altText !== undefined) body.alt_text = input.altText;
    if (input.children && input.children.length > 0) {
      body.children = input.children.join(",");
    }

    const res = await platformFetch<{ id: string }>({
      method: "POST",
      url: this.url(`/${encodeURIComponent(this.igUserId)}/media`),
      headers: { "Content-Type": "application/json" },
      body,
      platform: PLATFORM,
    });
    if (!res.ok || !res.body?.id) {
      throw mapMetaError(res, { platform: PLATFORM });
    }
    return res.body;
  }

  /** `GET /{container-id}?fields=status_code,status`. */
  async getContainerStatus(
    containerId: string,
  ): Promise<InstagramContainerStatusResponse> {
    const res = await platformFetch<InstagramContainerStatusResponse>({
      method: "GET",
      url: this.url(`/${encodeURIComponent(containerId)}`, {
        fields: "status_code,status",
      }),
      platform: PLATFORM,
    });
    if (!res.ok || !res.body?.status_code) {
      throw mapMetaError(res, { platform: PLATFORM });
    }
    return res.body;
  }

  /** `POST /{ig-user-id}/media_publish` — flip a FINISHED container live. */
  async publishContainer(creationId: string): Promise<{ id: string }> {
    const res = await platformFetch<{ id: string }>({
      method: "POST",
      url: this.url(`/${encodeURIComponent(this.igUserId)}/media_publish`),
      headers: { "Content-Type": "application/json" },
      body: { creation_id: creationId },
      platform: PLATFORM,
    });
    if (!res.ok || !res.body?.id) {
      throw mapMetaError(res, { platform: PLATFORM });
    }
    return res.body;
  }

  /**
   * `GET /{media-id}?fields=permalink` — best-effort permalink fetch
   * after publish. IG's publish response only returns the post id; the
   * caller-facing URL needs a follow-up call.
   */
  async getPermalink(mediaId: string): Promise<string | null> {
    const res = await platformFetch<{ permalink?: string }>({
      method: "GET",
      url: this.url(`/${encodeURIComponent(mediaId)}`, {
        fields: "permalink",
      }),
      platform: PLATFORM,
    });
    if (!res.ok || !res.body?.permalink) return null;
    return res.body.permalink;
  }
}
