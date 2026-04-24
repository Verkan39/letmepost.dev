import { defineConfig } from "vitest/config";
import { config as loadDotenv } from "dotenv";

// Load .env into process.env before vitest reads env for workers.
loadDotenv();

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globals: false,
    reporters: ["default"],
  },
});
