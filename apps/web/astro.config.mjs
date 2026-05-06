import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";
import icon from "astro-icon";
import tailwindcss from "@tailwindcss/vite";

/**
 * Per-route SEO weighting. Tells Google how to prioritize crawling the
 * marketing pages relative to each other. The home page + the platform /
 * API marketing pages carry the most commercial intent; legal pages stay
 * low so they don't outrank product content for brand queries.
 * `changefreq` is a hint, not a contract — Google uses its own freshness
 * signal — but it's still useful for less-aggressive crawlers (Bing,
 * AI-search ingestion bots).
 */
const ROUTE_WEIGHT = {
  home: { priority: 1.0, changefreq: "weekly" },
  product: { priority: 0.9, changefreq: "weekly" },
  pricing: { priority: 0.85, changefreq: "monthly" },
  utility: { priority: 0.6, changefreq: "monthly" },
  legal: { priority: 0.3, changefreq: "yearly" },
};

function classify(pathname) {
  if (pathname === "/" || pathname === "") return ROUTE_WEIGHT.home;
  if (pathname.startsWith("/platforms/") || pathname.startsWith("/api/")) {
    return ROUTE_WEIGHT.product;
  }
  if (pathname.startsWith("/pricing")) return ROUTE_WEIGHT.pricing;
  if (
    pathname.startsWith("/privacy") ||
    pathname.startsWith("/terms") ||
    pathname.startsWith("/data-deletion")
  ) {
    return ROUTE_WEIGHT.legal;
  }
  return ROUTE_WEIGHT.utility;
}

export default defineConfig({
  site: "https://letmepost.dev",
  integrations: [
    sitemap({
      // `serialize` runs per URL — Astro hands us the auto-discovered
      // entry, we add the priority + changefreq + lastmod that Google's
      // sitemap protocol expects. lastmod is set to build time, so each
      // deploy refreshes the freshness signal on every page.
      serialize(item) {
        const url = new URL(item.url);
        const weight = classify(url.pathname);
        return {
          ...item,
          priority: weight.priority,
          changefreq: weight.changefreq,
          lastmod: new Date().toISOString(),
        };
      },
    }),
    icon(),
  ],
  output: "static",
  build: {
    format: "directory",
  },
  vite: {
    plugins: [tailwindcss()],
  },
});
