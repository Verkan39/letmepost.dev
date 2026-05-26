import { Client, isFullPage } from "@notionhq/client";
import { NotionToMarkdown } from "notion-to-md";
import type { Loader } from "astro/loaders";

/**
 * Astro content loader backed by a Notion database. The DB is the source
 * of truth for blog posts — Outrank writes rows there, this loader picks
 * them up at build time and renders them through the same `blog` schema
 * as code-authored MDX.
 *
 * Build-time only. Vercel rebuilds (triggered by a Railway cron hitting
 * a deploy hook) re-run this loader and pull fresh content. If the
 * Notion API is unreachable we fail the build loudly — empty blog is a
 * worse outcome than a 5-minute deploy delay.
 */

type NotionBlogLoaderOptions = {
  databaseId: string;
  token: string;
};

type RichText = { plain_text: string };
type NotionCover =
  | { type: "external"; external: { url: string } }
  | { type: "file"; file: { url: string } }
  | null;
type NotionPage = {
  id: string;
  properties: Record<string, unknown>;
  cover: NotionCover;
};

function plainText(prop: unknown): string | undefined {
  if (!prop || typeof prop !== "object") return undefined;
  const p = prop as {
    type?: string;
    title?: RichText[];
    rich_text?: RichText[];
  };
  const arr = p.type === "title" ? p.title : p.rich_text;
  if (!arr || arr.length === 0) return undefined;
  return arr
    .map((t) => t.plain_text)
    .join("")
    .trim() || undefined;
}

function dateStart(prop: unknown): string | undefined {
  if (!prop || typeof prop !== "object") return undefined;
  const p = prop as { date?: { start?: string } };
  return p.date?.start;
}

function coverUrl(cover: NotionCover): string | undefined {
  if (!cover) return undefined;
  if (cover.type === "external") return cover.external.url;
  if (cover.type === "file") return cover.file.url;
  return undefined;
}

/**
 * Notion's `<table_of_contents/>` block is converted by notion-to-md into
 * nothing useful — but Outrank's articles precede it with a literal
 * `**Table of Contents**` line, which then renders as a stray inline H?
 * in the body. Strip it so the post page can render its own right-rail
 * TOC from the actual heading tree.
 */
function stripInlineToc(markdown: string): string {
  return markdown.replace(
    /^[\s>*_]*\*?\*?Table of Contents\*?\*?[\s>*_]*$/gim,
    "",
  );
}

/**
 * Walk the markdown line-by-line, track the latest heading, and rewrite
 * bare `![](url)` images to `![Figure: <heading>](url)` so every body
 * image has descriptive alt text. Images that already have alt text are
 * left alone.
 */
function addImageAlts(markdown: string, fallback: string): string {
  let currentHeading = fallback;
  return markdown
    .split("\n")
    .map((line) => {
      const heading = line.match(/^#{1,6}\s+(.+?)\s*$/);
      if (heading) {
        currentHeading = heading[1].trim();
        return line;
      }
      return line.replace(
        /!\[\]\((https?:\/\/[^\s)]+)\)/g,
        (_, url) => `![Figure: ${currentHeading}](${url})`,
      );
    })
    .join("\n");
}

/**
 * Outrank stamps every generated article with a "Built with the Outrank
 * app" attribution link at the bottom. Strip it — we don't want a follow
 * link out to a vendor on every post.
 */
function stripOutrankAttribution(markdown: string): string {
  return markdown.replace(
    /\n?\*Built with \*\[\*the Outrank app\*\]\([^)]+\)\s*$/i,
    "",
  );
}

export function notionBlogLoader(opts: NotionBlogLoaderOptions): Loader {
  return {
    name: "notion-blog",
    load: async ({ store, parseData, generateDigest, renderMarkdown, logger }) => {
      if (!opts.token || !opts.databaseId) {
        // Warn rather than throw — `astro check` and `astro sync` run
        // this loader to generate types and must succeed without env.
        // A real deploy missing these vars ships an empty blog, which
        // is loud enough on its own once the blog index is empty.
        logger.warn(
          "NOTION_TOKEN / NOTION_BLOG_DATABASE_ID are not set — blog will be empty. Set them in the Vercel project env to populate it.",
        );
        store.clear();
        return;
      }
      const notion = new Client({ auth: opts.token });
      // notion-to-md v3 wraps the official SDK and walks block trees into
      // a markdown tree we flatten with toMarkdownString.
      const n2m = new NotionToMarkdown({
        notionClient: notion,
        config: { parseChildPages: false },
      });

      logger.info("Querying Notion database for blog posts…");
      // @notionhq/client v5 moved query off `databases` and onto
      // `dataSources` (Notion now models a DB as a container of one or
      // more data sources). For a single-collection DB — which this one
      // is — the first data source is the one we want.
      const dbResp = (await notion.databases.retrieve({
        database_id: opts.databaseId,
      })) as { data_sources?: { id: string }[] };
      const dataSourceId = dbResp.data_sources?.[0]?.id;
      if (!dataSourceId) {
        throw new Error(
          `Notion database ${opts.databaseId} has no data sources — cannot query blog posts.`,
        );
      }

      const pages: NotionPage[] = [];
      let cursor: string | undefined;
      do {
        const res = await notion.dataSources.query({
          data_source_id: dataSourceId,
          start_cursor: cursor,
          page_size: 100,
        });
        for (const r of res.results) {
          if (isFullPage(r)) {
            pages.push({
              id: r.id,
              properties: r.properties,
              cover: r.cover as NotionCover,
            });
          }
        }
        cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
      } while (cursor);

      logger.info(`Fetched ${pages.length} pages from Notion. Rendering…`);
      store.clear();

      for (const page of pages) {
        const props = page.properties;
        const slug = plainText(props["slug"]);
        if (!slug) {
          logger.warn(`Skipping page ${page.id}: missing slug`);
          continue;
        }
        const title =
          plainText(props["Title"]) ?? plainText(props["Name"]);
        const description = plainText(props["Meta Description"]);
        const pubDateRaw = dateStart(props["Publish Date"]);
        if (!title || !description || !pubDateRaw) {
          logger.warn(
            `Skipping ${slug}: missing title, description, or publish date`,
          );
          continue;
        }

        const mdBlocks = await n2m.pageToMarkdown(page.id);
        const mdResult = n2m.toMarkdownString(mdBlocks);
        const cleaned = stripInlineToc(mdResult.parent ?? "");
        const noAttribution = stripOutrankAttribution(cleaned);
        const body = addImageAlts(noAttribution, title);
        if (!body.trim()) {
          logger.warn(`Skipping ${slug}: empty body`);
          continue;
        }

        // The cover image is the Notion page's actual cover (set in the
        // page header in Notion). Falls through to undefined if no cover
        // is set — the post page treats that as "no hero image."
        const heroImage = coverUrl(page.cover);
        logger.info(
          `  ${slug}: cover=${heroImage ? "✓ " + heroImage.slice(0, 80) : "✗ (no page cover set in Notion)"}`,
        );

        const data = await parseData({
          id: slug,
          data: {
            title,
            description,
            pubDate: new Date(pubDateRaw),
            tags: [],
            category: "engineering",
            author: "letmepost.dev",
            draft: false,
            ...(heroImage ? { heroImage } : {}),
          },
        });

        const rendered = await renderMarkdown(body);
        store.set({
          id: slug,
          data,
          body,
          rendered,
          digest: generateDigest(body),
        });
      }
      logger.info(`Loaded ${store.keys().length} Notion blog entries.`);
    },
  };
}
