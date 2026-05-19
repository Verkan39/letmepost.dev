#!/usr/bin/env node

import { Command } from "commander";
import {
  runAccountsDisconnect,
  runAccountsList,
} from "./commands/accounts.js";
import { runLogin } from "./commands/login.js";
import { runLogout } from "./commands/logout.js";
import { runPost } from "./commands/post.js";
import { runPostsGet, runPostsList } from "./commands/posts.js";
import { runVersion, CLI_VERSION } from "./commands/version.js";
import { runWhoami } from "./commands/whoami.js";
import { CliError } from "./client.js";

const program = new Command();
program
  .name("lmp")
  .description(
    "letmepost.dev — publish to Bluesky, X, LinkedIn, Threads, Instagram, Facebook, Pinterest from your terminal.",
  )
  .version(CLI_VERSION, "-v, --version", "Show the CLI version.")
  .showHelpAfterError("(run `lmp --help` for available commands)");

program
  .command("login")
  .description("Authenticate the CLI via OAuth (or fall back to API key paste).")
  .action(wrap(async () => runLogin()));

program
  .command("logout")
  .description("Clear stored credentials from ~/.letmepost/config.json.")
  .action(wrap(async () => runLogout()));

program
  .command("whoami")
  .description("Show the current credential, base URL, and connected-account count.")
  .action(wrap(async () => runWhoami()));

program
  .command("version")
  .description("Print the CLI version and configured API base URL.")
  .action(wrap(async () => runVersion()));

const accounts = program
  .command("accounts")
  .description("Manage connected social accounts.");
accounts
  .command("list")
  .description("List connected accounts (optionally filtered by platform).")
  .option("--platform <name>", "Filter to a single platform (twitter, bluesky, …).")
  .action(
    wrap(async (opts: { platform?: string }) =>
      runAccountsList(opts.platform ? { platform: opts.platform } : {}),
    ),
  );
accounts
  .command("disconnect")
  .description("Disconnect a connected account by id.")
  .argument("<id>", "Account id (uuid)")
  .action(wrap(async (id: string) => runAccountsDisconnect(id)));

const posts = program
  .command("posts")
  .description("Browse the post log.");
posts
  .command("list")
  .description("List recent posts.")
  .option("--limit <n>", "Number of rows (1-200).")
  .option("--status <status>", "Filter by status: queued, published, failed, …")
  .option("--platform <platform>", "Filter by platform.")
  .option("--cursor <cursor>", "Pagination cursor returned by a previous list.")
  .action(
    wrap(async (opts: {
      limit?: string;
      status?: string;
      platform?: string;
      cursor?: string;
    }) => {
      const out: Parameters<typeof runPostsList>[0] = {};
      if (opts.limit !== undefined) out.limit = opts.limit;
      if (opts.status !== undefined) out.status = opts.status;
      if (opts.platform !== undefined) out.platform = opts.platform;
      if (opts.cursor !== undefined) out.cursor = opts.cursor;
      await runPostsList(out);
    }),
  );
posts
  .command("get")
  .description("Fetch a single post with its publish attempts.")
  .argument("<id>", "Post id")
  .action(wrap(async (id: string) => runPostsGet(id)));

program
  .command("post")
  .description("Publish a post to one or more platforms.")
  .argument("<text>", "Post text")
  .requiredOption(
    "--to <platforms>",
    "Comma-separated platforms: e.g. twitter,bluesky",
  )
  .option(
    "--media <paths>",
    "Comma-separated local file paths to upload as media.",
  )
  .option("--first-comment <text>", "Auto-posted reply (Bluesky-only today).")
  .option("--schedule <iso>", "ISO-8601 timestamp to queue the batch.")
  .action(
    wrap(async (text: string, opts: {
      to: string;
      media?: string;
      firstComment?: string;
      schedule?: string;
    }) => {
      const out: Parameters<typeof runPost>[1] = { to: opts.to };
      if (opts.media !== undefined) out.media = opts.media;
      if (opts.firstComment !== undefined) out.firstComment = opts.firstComment;
      if (opts.schedule !== undefined) out.schedule = opts.schedule;
      await runPost(text, out);
    }),
  );

await program.parseAsync(process.argv);

/**
 * Wraps an async action so commander surfaces the right exit code.
 * CliError carries an explicit `exitCode` (0/1/2) and an optional message
 * (empty when we already wrote a styled error to stderr).
 */
function wrap<TArgs extends unknown[]>(
  fn: (...args: TArgs) => Promise<void> | void,
): (...args: TArgs) => Promise<void> {
  return async (...args: TArgs) => {
    try {
      await fn(...args);
    } catch (err) {
      if (err instanceof CliError) {
        if (err.message) process.stderr.write(`${err.message}\n`);
        process.exit(err.exitCode);
      }
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`Error: ${msg}\n`);
      process.exit(1);
    }
  };
}
