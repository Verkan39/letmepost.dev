import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { TwitterProvider } from "../src/platforms/twitter/provider.js";

const server = setupServer();
beforeAll(() => {
  server.listen({ onUnhandledRequest: "error" });
});
afterEach(() => {
  server.resetHandlers();
});
afterAll(() => {
  server.close();
});

const AUTHORIZE_URL = "https://test.example/twitter/authorize";
const TOKEN_URL = "https://test.example/twitter/token";

describe("TwitterProvider", () => {
  it("describeConnect includes a PKCE codeVerifier + S256 challenge and narrow scopes", () => {
    const p = new TwitterProvider({
      clientId: "client_x",
      clientSecret: "secret_x",
      authorizeUrl: AUTHORIZE_URL,
    });
    const descriptor = p.describeConnect({
      organizationId: "org_1",
      baseUrl: "https://api.letmepost.dev",
    });
    expect(descriptor.kind).toBe("oauth");
    if (descriptor.kind !== "oauth") throw new Error("expected oauth");

    expect(descriptor.codeVerifier).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(descriptor.codeVerifier!.length).toBeGreaterThanOrEqual(43);
    expect(descriptor.redirectUri).toBe(
      "https://api.letmepost.dev/v1/accounts/oauth/twitter/callback",
    );
    const url = new URL(descriptor.authorizationUrl);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(url.searchParams.get("scope")).toBe(
      "tweet.write tweet.read users.read offline.access",
    );
  });

  it("completeConnect exchanges code + codeVerifier for tokens and packs grantedScopes", async () => {
    server.use(
      http.post(TOKEN_URL, async ({ request }) => {
        const form = new URLSearchParams(await request.text());
        expect(form.get("grant_type")).toBe("authorization_code");
        expect(form.get("code")).toBe("auth-code");
        expect(form.get("code_verifier")).toBe("verifier-xyz");
        return HttpResponse.json({
          access_token: "tw-access",
          refresh_token: "tw-refresh",
          token_type: "bearer",
          expires_in: 7200,
          scope: "tweet.write tweet.read users.read offline.access",
        });
      }),
    );
    const p = new TwitterProvider({
      clientId: "cid",
      clientSecret: "cs",
      tokenUrl: TOKEN_URL,
    });
    const account = await p.completeConnect(
      { organizationId: "o", baseUrl: "https://api.letmepost.dev" },
      {
        code: "auth-code",
        state: "s",
        redirectUri: "https://api.letmepost.dev/v1/accounts/oauth/twitter/callback",
        codeVerifier: "verifier-xyz",
      },
    );
    expect(account.token).toBe("tw-access");
    expect(account.tokenMetadata).toMatchObject({ refreshToken: "tw-refresh" });
    expect(account.tokenExpiresAt).toBeInstanceOf(Date);
    expect(account.platformAccountId).toMatch(/^twitter-/);
  });

  it("completeConnect rejects payloads missing codeVerifier (PKCE required)", async () => {
    const p = new TwitterProvider({ tokenUrl: TOKEN_URL });
    await expect(
      p.completeConnect(
        { organizationId: "o", baseUrl: "https://x.example" },
        { code: "c", state: "s", redirectUri: "https://x.example/cb" },
      ),
    ).rejects.toMatchObject({ code: "validation_failed", status: 400 });
  });

  it("refreshToken rotates tokens using the stored refresh_token", async () => {
    server.use(
      http.post(TOKEN_URL, async ({ request }) => {
        const form = new URLSearchParams(await request.text());
        expect(form.get("grant_type")).toBe("refresh_token");
        expect(form.get("refresh_token")).toBe("stored-refresh");
        return HttpResponse.json({
          access_token: "rotated-access",
          refresh_token: "rotated-refresh",
          token_type: "bearer",
          expires_in: 7200,
          scope: "tweet.write tweet.read users.read offline.access",
        });
      }),
    );
    const p = new TwitterProvider({
      clientId: "cid",
      clientSecret: "cs",
      tokenUrl: TOKEN_URL,
    });
    const result = await p.refreshToken({
      token: "old-access",
      tokenMetadata: { refreshToken: "stored-refresh" },
    });
    expect(result.token).toBe("rotated-access");
    expect(result.tokenMetadata).toMatchObject({ refreshToken: "rotated-refresh" });
  });

  it("refreshToken throws platform_auth_failed when no refresh token is present", async () => {
    const p = new TwitterProvider({ tokenUrl: TOKEN_URL });
    await expect(
      p.refreshToken({ token: "old", tokenMetadata: null }),
    ).rejects.toMatchObject({
      code: "platform_auth_failed",
      status: 401,
      platform: "twitter",
    });
  });
});
