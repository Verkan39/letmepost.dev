import type { VercelRequest, VercelResponse } from "@vercel/node";

/**
 * Vercel cron entrypoint: fires once per day per `vercel.json`. The
 * marketing site is `output: "static"` so we can't regenerate Notion
 * content from inside an Astro endpoint — instead this function pings
 * the Vercel deploy hook URL, which kicks off a fresh build. During
 * that build, the Notion loader in `src/lib/notion-blog-loader.ts`
 * pulls the latest rows from the "Outrank <> LMP" database.
 *
 * Authentication: Vercel cron requests carry an
 * `Authorization: Bearer ${CRON_SECRET}` header (Vercel generates and
 * injects CRON_SECRET when you enable cron on the project). We reject
 * anything else so random pings to /api/cron/rebuild-blog don't drain
 * deploy minutes.
 */
export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return res
      .status(500)
      .json({ error: "CRON_SECRET is not configured on this deployment." });
  }
  if (req.headers.authorization !== `Bearer ${expected}`) {
    return res.status(401).json({ error: "unauthorized" });
  }

  const hookUrl = process.env.BLOG_REBUILD_DEPLOY_HOOK_URL;
  if (!hookUrl) {
    return res
      .status(500)
      .json({ error: "BLOG_REBUILD_DEPLOY_HOOK_URL is not configured." });
  }

  const response = await fetch(hookUrl, { method: "POST" });
  if (!response.ok) {
    return res.status(502).json({
      error: "deploy hook failed",
      status: response.status,
    });
  }

  const payload = await response.json().catch(() => ({}));
  return res.status(200).json({ ok: true, deployHook: payload });
}
