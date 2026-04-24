import type { APIRoute } from "astro";
import { Resvg } from "@resvg/resvg-js";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";
import path from "node:path";

export const prerender = true;

const require = createRequire(import.meta.url);

const FONT_REQUESTS = [
  "@fontsource/instrument-serif/files/instrument-serif-latin-400-italic.woff2",
  "@fontsource/instrument-serif/files/instrument-serif-latin-400-normal.woff2",
  "@fontsource/commit-mono/files/commit-mono-latin-400-normal.woff2",
  "@fontsource/commit-mono/files/commit-mono-latin-700-normal.woff2",
];

function resolveFontFiles(): string[] {
  const files: string[] = [];
  for (const rel of FONT_REQUESTS) {
    try {
      files.push(require.resolve(rel));
    } catch {
      console.warn(`[og-image] missing font file: ${rel}`);
    }
  }
  return files;
}

export const GET: APIRoute = async () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const svgPath = path.resolve(here, "../../public/og-image.svg");
  const svg = await fs.readFile(svgPath, "utf-8");

  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: 1200 },
    font: {
      fontFiles: resolveFontFiles(),
      loadSystemFonts: true,
      defaultFontFamily: "Instrument Serif",
    },
    background: "#F2EDE3",
  });

  const png = resvg.render().asPng();

  return new Response(new Uint8Array(png), {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
};
