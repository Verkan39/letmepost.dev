import type { CreatePostResponse } from "@letmepost/schemas";

/**
 * A Publisher turns a validated request into a `CreatePostResponse`. Each
 * platform implements this; the router dispatches to the right one based on
 * `account.platform`.
 *
 * `TContent` is intentionally generic — platforms accept richer input shapes
 * (e.g. text + media on Bluesky).
 */
export interface Publisher<TAccount, TContent = string> {
  publish(account: TAccount, content: TContent): Promise<CreatePostResponse>;
}
