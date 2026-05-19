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
import {
  runProfilesCurrent,
  runProfilesList,
  runProfilesUse,
} from "./commands/profiles.js";
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
  .option(
    "--profile <id>",
    "Scope to a profile id (overrides the stored default for this call).",
  )
  .action(
    wrap(async (opts: { platform?: string; profile?: string }) => {
      const args: Parameters<typeof runAccountsList>[0] = {};
      if (opts.platform !== undefined) args.platform = opts.platform;
      if (opts.profile !== undefined) args.profile = opts.profile;
      await runAccountsList(args);
    }),
  );
accounts
  .command("disconnect")
  .description("Disconnect a connected account by id.")
  .argument("<id>", "Account id (uuid)")
  .option(
    "--profile <id>",
    "Scope to a profile id (overrides the stored default for this call).",
  )
  .action(
    wrap(async (id: string, opts: { profile?: string }) => {
      const args: Parameters<typeof runAccountsDisconnect>[1] = {};
      if (opts.profile !== undefined) args.profile = opts.profile;
      await runAccountsDisconnect(id, args);
    }),
  );

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
  .option(
    "--profile <id>",
    "Scope to a profile id (overrides the stored default for this call).",
  )
  .action(
    wrap(async (opts: {
      limit?: string;
      status?: string;
      platform?: string;
      cursor?: string;
      profile?: string;
    }) => {
      const out: Parameters<typeof runPostsList>[0] = {};
      if (opts.limit !== undefined) out.limit = opts.limit;
      if (opts.status !== undefined) out.status = opts.status;
      if (opts.platform !== undefined) out.platform = opts.platform;
      if (opts.cursor !== undefined) out.cursor = opts.cursor;
      if (opts.profile !== undefined) out.profile = opts.profile;
      await runPostsList(out);
    }),
  );
posts
  .command("get")
  .description("Fetch a single post with its publish attempts.")
  .argument("<id>", "Post id")
  .option(
    "--profile <id>",
    "Scope to a profile id (overrides the stored default for this call).",
  )
  .action(
    wrap(async (id: string, opts: { profile?: string }) => {
      const args: Parameters<typeof runPostsGet>[1] = {};
      if (opts.profile !== undefined) args.profile = opts.profile;
      await runPostsGet(id, args);
    }),
  );

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
  .option(
    "--profile <id>",
    "Scope to a profile id (overrides the stored default for this call).",
  )
  .action(
    wrap(async (text: string, opts: {
      to: string;
      media?: string;
      firstComment?: string;
      schedule?: string;
      profile?: string;
    }) => {
      const out: Parameters<typeof runPost>[1] = { to: opts.to };
      if (opts.media !== undefined) out.media = opts.media;
      if (opts.firstComment !== undefined) out.firstComment = opts.firstComment;
      if (opts.schedule !== undefined) out.schedule = opts.schedule;
      if (opts.profile !== undefined) out.profile = opts.profile;
      await runPost(text, out);
    }),
  );

const profiles = program
  .command("profiles")
  .description("Manage the active profile scope for the CLI.");
profiles
  .command("list")
  .description("List every profile in the active org.")
  .action(wrap(async () => runProfilesList()));
profiles
  .command("use")
  .description(
    "Set the default profile id (persisted to ~/.letmepost/config.json).",
  )
  .argument("<id>", "Profile id from `lmp profiles list`")
  .action(wrap(async (id: string) => runProfilesUse(id)));
profiles
  .command("current")
  .description(
    "Print the currently-selected default profile id (or \"none — using key default\").",
  )
  .action(wrap(async () => runProfilesCurrent()));

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
