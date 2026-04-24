import type { NextConfig } from "next";
import path from "node:path";

/**
 * Pin Turbopack's workspace-root inference to the monorepo root. Without this
 * Next picks the home-directory-level `package-lock.json` and spews a warning
 * on every build. The root is two levels up from `apps/dashboard`.
 */
const nextConfig: NextConfig = {
  turbopack: {
    root: path.join(__dirname, "../.."),
  },
};

export default nextConfig;
