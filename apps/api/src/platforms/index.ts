import { registerProvider } from "./_shared/provider.js";
import { blueskyProvider } from "./bluesky/provider.js";
import { linkedinProvider } from "./linkedin/provider.js";
import { pinterestProvider } from "./pinterest/provider.js";
import { twitterProvider } from "./twitter/provider.js";

/**
 * Boot-time provider registration. `createApp` imports this module for its
 * side effects so every route can look up providers by platform. New
 * platforms add a single line here.
 */
registerProvider(blueskyProvider);
registerProvider(linkedinProvider);
registerProvider(pinterestProvider);
registerProvider(twitterProvider);

export { getProvider, listRegisteredProviders } from "./_shared/provider.js";
