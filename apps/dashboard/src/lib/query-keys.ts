/**
 * Centralized query keys. Keep all keys here so invalidation can be
 * targeted (`queryClient.invalidateQueries({ queryKey: keys.posts.list() })`)
 * without grepping for stringly-typed tuples spread across the codebase.
 */
export const queryKeys = {
  profiles: {
    list: () => ["profiles"] as const,
  },
  accounts: {
    list: () => ["accounts"] as const,
    pinterestBoards: (accountId: string) =>
      ["accounts", accountId, "pinterest", "boards"] as const,
  },
  apiKeys: {
    list: () => ["apiKeys"] as const,
  },
  webhooks: {
    list: () => ["webhooks"] as const,
  },
  posts: {
    list: (filters: unknown) => ["posts", "list", filters] as const,
    detail: (id: string) => ["posts", "detail", id] as const,
  },
} as const;
