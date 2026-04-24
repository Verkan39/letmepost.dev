import { z } from "zod";
import { LetmepostError } from "../../errors.js";
import type {
  AccountProvider,
  ConnectDescriptor,
  ConnectedAccount,
  RefreshInput,
  RefreshResult,
} from "../_shared/provider.js";
import { scopeSetFor } from "../_shared/scopes.js";
import { BlueskyClient, type BlueskySession } from "./client.js";

/**
 * Bluesky doesn't use OAuth for the AT Proto PDS flow — it uses app passwords.
 * The provider surfaces a credentials form instead of a redirect URL, which
 * the framework passes through `/v1/accounts/connect/:platform` to the client.
 *
 * What we persist after connect:
 *   - `token`      = the app password itself (source of truth; re-auth needs it).
 *   - `tokenMetadata` = `{ accessJwt, refreshJwt, did, handle, pdsUrl }`.
 *   - `tokenExpiresAt` = the access JWT's `exp` claim (roughly 2h out).
 *
 * Why keep the app password around? `refreshJwt` rotates every ~2 months and
 * can be revoked server-side; the app password is what lets us re-issue a
 * session unilaterally. If the user wants full revocation they delete the
 * app password from Bluesky settings — at which point our refresh fails and
 * we emit `token.revoked`.
 */

const BLUESKY_PDS_DEFAULT = "https://bsky.social";
/** Access JWTs last ~2h on the reference PDS; refresh well before that. */
const BLUESKY_EXPIRING_HORIZON_MS = 30 * 60 * 1000;

const CompleteConnectInput = z.object({
  identifier: z
    .string()
    .min(1, "identifier is required — use the Bluesky handle or email."),
  appPassword: z
    .string()
    .min(1, "appPassword is required.")
    .refine((pw) => pw !== pw.toUpperCase() || pw.length >= 12, {
      // App passwords are typically 4x4 lowercase: abcd-efgh-ijkl-mnop. Don't
      // hard-reject — Bluesky may change format — just nudge obvious mistakes.
      message:
        "This doesn't look like a Bluesky app password. Generate one at https://bsky.app/settings/app-passwords (don't use your account password).",
    }),
  pdsUrl: z
    .string()
    .url()
    .optional()
    .describe("Override the default PDS (https://bsky.social) for self-hosted PDSes."),
});

export type BlueskyCompleteConnectInput = z.infer<typeof CompleteConnectInput>;

export type BlueskyTokenMetadata = {
  accessJwt: string;
  refreshJwt: string;
  did: string;
  handle: string;
  pdsUrl: string;
};

function decodeJwtExp(jwt: string): Date | null {
  // JWT = header.payload.signature — we only need payload.exp.
  const parts = jwt.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(parts[1]!, "base64url").toString("utf8"),
    ) as { exp?: number };
    if (typeof payload.exp !== "number") return null;
    return new Date(payload.exp * 1000);
  } catch {
    return null;
  }
}

function asMetadata(session: BlueskySession, pdsUrl: string): BlueskyTokenMetadata {
  return {
    accessJwt: session.accessJwt,
    refreshJwt: session.refreshJwt,
    did: session.did,
    handle: session.handle,
    pdsUrl,
  };
}

function readMetadata(raw: Record<string, unknown> | null): BlueskyTokenMetadata | null {
  if (!raw) return null;
  const { accessJwt, refreshJwt, did, handle, pdsUrl } = raw as Partial<BlueskyTokenMetadata>;
  if (
    typeof accessJwt !== "string" ||
    typeof refreshJwt !== "string" ||
    typeof did !== "string" ||
    typeof handle !== "string" ||
    typeof pdsUrl !== "string"
  ) {
    return null;
  }
  return { accessJwt, refreshJwt, did, handle, pdsUrl };
}

export const blueskyProvider: AccountProvider = {
  platform: "bluesky",
  expiringHorizonMs: BLUESKY_EXPIRING_HORIZON_MS,

  describeConnect(): ConnectDescriptor {
    return {
      kind: "credentials",
      helpText:
        "Bluesky uses app passwords, not OAuth. Generate one at https://bsky.app/settings/app-passwords and paste it here. Never use your account password.",
      fields: [
        {
          name: "identifier",
          label: "Handle or email",
          type: "text",
          required: true,
          placeholder: "yourname.bsky.social",
        },
        {
          name: "appPassword",
          label: "App password",
          type: "password",
          required: true,
          placeholder: "xxxx-xxxx-xxxx-xxxx",
          helpText:
            "Must be an app password, not your account password. Scopes: " +
            (scopeSetFor("bluesky").write.join(", ") || "(no OAuth scopes — app password grants write)"),
        },
        {
          name: "pdsUrl",
          label: "PDS URL (advanced)",
          type: "url",
          required: false,
          placeholder: BLUESKY_PDS_DEFAULT,
          helpText: "Leave blank for the default Bluesky PDS.",
        },
      ],
    };
  },

  async completeConnect(_ctx, raw): Promise<ConnectedAccount> {
    const parsed = CompleteConnectInput.safeParse(raw);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new LetmepostError({
        code: "validation_failed",
        status: 400,
        message: issue?.message ?? "Invalid Bluesky connect payload.",
        rule: issue?.path.join(".") || "body",
        platformResponse: parsed.error.issues,
      });
    }
    const { identifier, appPassword, pdsUrl } = parsed.data;
    const effectivePds = pdsUrl ?? BLUESKY_PDS_DEFAULT;

    const client = new BlueskyClient(identifier, appPassword, effectivePds);
    const session = await client.createSession();

    return {
      platformAccountId: session.did,
      displayName: session.handle,
      token: appPassword,
      tokenMetadata: asMetadata(session, effectivePds),
      tokenExpiresAt: decodeJwtExp(session.accessJwt),
    };
  },

  async refreshToken(input: RefreshInput): Promise<RefreshResult> {
    const metadata = readMetadata(input.tokenMetadata);
    const pdsUrl = metadata?.pdsUrl ?? BLUESKY_PDS_DEFAULT;

    // Try the cheap refresh path first. On failure, fall back to full login
    // with the stored app password — that's what `token` holds for Bluesky.
    if (metadata) {
      try {
        const session = await BlueskyClient.refreshSession(metadata.refreshJwt, pdsUrl);
        return {
          token: input.token,
          tokenMetadata: asMetadata(session, pdsUrl),
          tokenExpiresAt: decodeJwtExp(session.accessJwt),
        };
      } catch {
        // Refresh JWT may be revoked or expired. Fall through to re-login.
      }
    }

    const identifier = metadata?.handle ?? metadata?.did;
    if (!identifier) {
      throw new LetmepostError({
        code: "platform_auth_failed",
        status: 401,
        platform: "bluesky",
        message:
          "Cannot refresh Bluesky session: no cached handle or DID in token metadata.",
        remediation: "Reconnect the account via POST /v1/accounts/connect/bluesky.",
      });
    }
    const client = new BlueskyClient(identifier, input.token, pdsUrl);
    const session = await client.createSession();
    return {
      token: input.token,
      tokenMetadata: asMetadata(session, pdsUrl),
      tokenExpiresAt: decodeJwtExp(session.accessJwt),
    };
  },
};
