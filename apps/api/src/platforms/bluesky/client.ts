import { platformFetch } from "../_shared/http.js";
import { authFailed, extractUpstreamMessage, rejected } from "../_shared/errors.js";

const DEFAULT_PDS = "https://bsky.social";
const PLATFORM = "bluesky";

export interface BlueskySession {
  accessJwt: string;
  refreshJwt: string;
  did: string;
  handle: string;
}

export interface BlueskyPostResult {
  uri: string;
  cid: string;
}

export class BlueskyClient {
  constructor(
    private readonly identifier: string,
    private readonly password: string,
    private readonly pdsUrl: string = DEFAULT_PDS,
  ) {}

  async createSession(): Promise<BlueskySession> {
    const res = await platformFetch<BlueskySession>({
      method: "POST",
      url: `${this.pdsUrl}/xrpc/com.atproto.server.createSession`,
      body: { identifier: this.identifier, password: this.password },
      platform: PLATFORM,
    });
    if (!res.ok || !res.body) {
      throw authFailed({
        platform: PLATFORM,
        platformResponse: res.body ?? res.raw ?? undefined,
        remediation:
          "Verify the identifier (handle or email) and use a Bluesky app password, not the account password. Generate one at https://bsky.app/settings/app-passwords.",
      });
    }
    return res.body;
  }

  async createPost(
    session: BlueskySession,
    text: string,
  ): Promise<BlueskyPostResult> {
    const record = {
      $type: "app.bsky.feed.post",
      text,
      createdAt: new Date().toISOString(),
    };
    const res = await platformFetch<BlueskyPostResult>({
      method: "POST",
      url: `${this.pdsUrl}/xrpc/com.atproto.repo.createRecord`,
      headers: { Authorization: `Bearer ${session.accessJwt}` },
      body: {
        repo: session.did,
        collection: "app.bsky.feed.post",
        record,
      },
      platform: PLATFORM,
    });
    if (!res.ok || !res.body) {
      throw rejected({
        platform: PLATFORM,
        platformResponse: res.body ?? res.raw ?? undefined,
        ...(extractUpstreamMessage(res.body) !== undefined
          ? { upstreamMessage: extractUpstreamMessage(res.body)! }
          : {}),
      });
    }
    return res.body;
  }
}
