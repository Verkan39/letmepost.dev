import { LetmepostError } from "../../errors.js";

const DEFAULT_PDS = "https://bsky.social";

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

async function safeJson(res: Response): Promise<unknown> {
  try {
    return (await res.json()) as unknown;
  } catch {
    return undefined;
  }
}

export class BlueskyClient {
  constructor(
    private readonly identifier: string,
    private readonly password: string,
    private readonly pdsUrl: string = DEFAULT_PDS,
  ) {}

  async createSession(): Promise<BlueskySession> {
    const res = await fetch(`${this.pdsUrl}/xrpc/com.atproto.server.createSession`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier: this.identifier, password: this.password }),
    });
    if (!res.ok) {
      const body = await safeJson(res);
      throw new LetmepostError({
        code: "platform_auth_failed",
        status: 401,
        message: "Bluesky authentication failed.",
        platform: "bluesky",
        platformResponse: body,
        remediation:
          "Verify the identifier (handle or email) and use a Bluesky app password, not the account password. Generate one at https://bsky.app/settings/app-passwords.",
      });
    }
    return (await res.json()) as BlueskySession;
  }

  async createPost(session: BlueskySession, text: string): Promise<BlueskyPostResult> {
    const record = {
      $type: "app.bsky.feed.post",
      text,
      createdAt: new Date().toISOString(),
    };
    const res = await fetch(`${this.pdsUrl}/xrpc/com.atproto.repo.createRecord`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.accessJwt}`,
      },
      body: JSON.stringify({
        repo: session.did,
        collection: "app.bsky.feed.post",
        record,
      }),
    });
    if (!res.ok) {
      const body = await safeJson(res);
      const upstreamMessage =
        body && typeof body === "object" && "message" in body && typeof body.message === "string"
          ? body.message
          : undefined;
      throw new LetmepostError({
        code: "platform_rejected",
        status: 502,
        message: upstreamMessage
          ? `Bluesky rejected the post: ${upstreamMessage}`
          : "Bluesky rejected the post.",
        platform: "bluesky",
        platformResponse: body,
        remediation: "Inspect platformResponse for the upstream error detail.",
      });
    }
    return (await res.json()) as BlueskyPostResult;
  }
}
