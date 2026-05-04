import { registerProvider } from "./_shared/provider.js";
import { blueskyProvider } from "./bluesky/provider.js";
import { linkedinProvider } from "./linkedin/provider.js";
import { metaProvider } from "./meta/provider.js";
import { pinterestProvider } from "./pinterest/provider.js";
import { threadsProvider } from "./threads/provider.js";
import { twitterProvider } from "./twitter/provider.js";

/**
 * Boot-time provider registration. `createApp` imports this module for its
 * side effects so every route can look up providers by platform. New
 * platforms add a single line here.
 *
 * Note: `metaProvider` registers under the `facebook` platform key — its
 * single OAuth grant fans out to both `facebook` and `instagram` rows on
 * completeConnect (one Page → one FB row + optional IG row). Users
 * connect via /v1/accounts/connect/facebook; there is no separate
 * /connect/instagram endpoint.
 */
registerProvider(blueskyProvider);
registerProvider(linkedinProvider);
registerProvider(metaProvider);
registerProvider(pinterestProvider);
registerProvider(threadsProvider);
registerProvider(twitterProvider);

export { getProvider, listRegisteredProviders } from "./_shared/provider.js";
