import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";
import icon from "astro-icon";

export default defineConfig({
  site: "https://letmepost.dev",
  integrations: [sitemap(), icon()],
  output: "static",
  build: {
    format: "directory",
  },
});
