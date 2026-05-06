import rss from "@astrojs/rss";
import { getCollection } from "astro:content";
import type { APIContext } from "astro";

/**
 * RSS feed for the blog — discovered automatically by feed readers
 * via the BaseLayout `<link rel="alternate" type="application/rss+xml">`
 * (we add it below the `<link rel="sitemap">`). Drafts excluded in
 * production builds; otherwise an unfinished post would land in
 * subscribers' readers immediately.
 *
 * Feed ordering: newest first by `pubDate`. Limit to 30 entries —
 * RSS clients tend to keep their own history, and a too-large feed
 * is itself a flag to some aggregators.
 */
export async function GET(context: APIContext) {
  const posts = await getCollection("blog", ({ data }) => {
    return import.meta.env.PROD ? data.draft !== true : true;
  });

  const sorted = posts.sort(
    (a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf(),
  );

  const items = sorted.slice(0, 30).map((post) => ({
    title: post.data.title,
    description: post.data.description,
    pubDate: post.data.pubDate,
    link: `/blog/${post.id}/`,
    categories: post.data.tags,
    author: post.data.author,
  }));

  return rss({
    title: "letmepost.dev — Blog",
    description:
      "Field notes from the team building letmepost.dev. API design, platform-integration gotchas, and the failure-modes corpus that drove our product principles.",
    site: context.site!,
    items,
    customData: `<language>en-us</language>`,
  });
}
