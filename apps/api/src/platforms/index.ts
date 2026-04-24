import { registerProvider } from "./_shared/provider.js";
import { blueskyProvider } from "./bluesky/provider.js";

/**
 * Boot-time provider registration. `createApp` imports this module for its
 * side effects so every route can look up providers by platform. New
 * platforms add a single line here.
 */
registerProvider(blueskyProvider);

export { getProvider, listRegisteredProviders } from "./_shared/provider.js";
