"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, FunnelSimple, X } from "@phosphor-icons/react";
import { ApiRequestError } from "@/lib/api";
import {
  listPosts,
  POST_STATUSES,
  statusTone,
  type ListPostsFilters,
  type PostListItem,
  type PostStatus,
} from "@/lib/posts";
import { CONNECTABLE_PLATFORMS } from "@/lib/accounts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FadeIn, StaggerList, StaggerItem } from "@/components/app/motion";

/**
 * Post Log — the operator's "where did my post go?" screen.
 *
 * Filters: platform × status. (Profile filter and time range come in a
 * follow-up once the dashboard has a profile switcher.) Pagination via the
 * opaque cursor returned by the API; we keep a stack so "back" works.
 */
export default function PostsPage() {
  const [items, setItems] = useState<PostListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [platform, setPlatform] = useState<string>("");
  const [status, setStatus] = useState<string>("");
  const [cursorStack, setCursorStack] = useState<(string | undefined)[]>([
    undefined,
  ]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);

  const filters = useMemo<ListPostsFilters>(() => {
    const f: ListPostsFilters = { limit: 25 };
    if (platform) f.platform = [platform];
    if (status) f.status = [status as PostStatus];
    const cur = cursorStack[cursorStack.length - 1];
    if (cur) f.cursor = cur;
    return f;
  }, [platform, status, cursorStack]);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setItems(null);
    listPosts(filters)
      .then((res) => {
        if (cancelled) return;
        setItems(res.data);
        setNextCursor(res.nextCursor);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(
          err instanceof ApiRequestError
            ? err.payload.message
            : err instanceof Error
              ? err.message
              : "Failed to load posts.",
        );
        setItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, [filters]);

  function resetCursor() {
    setCursorStack([undefined]);
  }

  function clearFilters() {
    setPlatform("");
    setStatus("");
    resetCursor();
  }

  const hasActiveFilters = platform !== "" || status !== "";
  const onFirstPage = cursorStack.length === 1;

  return (
    <div className="space-y-6">
      <FadeIn>
        <h1 className="text-lg font-semibold">Post log</h1>
        <p className="text-xs text-muted-foreground">
          Every post your org has sent through letmepost. When something fails,
          this is where you see the rule, the upstream response, and the
          remediation.
        </p>
      </FadeIn>

      <div className="flex items-center gap-2 flex-wrap">
        <FunnelSimple className="size-4 text-muted-foreground" />
        <Select
          value={platform || "all"}
          onValueChange={(v) => {
            setPlatform(v === "all" ? "" : v);
            resetCursor();
          }}
        >
          <SelectTrigger className="h-8 w-[160px]">
            <SelectValue placeholder="Platform" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All platforms</SelectItem>
            {CONNECTABLE_PLATFORMS.map((p) => (
              <SelectItem key={p} value={p}>
                {p}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={status || "all"}
          onValueChange={(v) => {
            setStatus(v === "all" ? "" : v);
            resetCursor();
          }}
        >
          <SelectTrigger className="h-8 w-[160px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {POST_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {hasActiveFilters ? (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            <X className="size-3" />
            Clear
          </Button>
        ) : null}
      </div>

      {error ? (
        <Card>
          <CardHeader>
            <CardTitle>Couldn&apos;t load posts</CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
        </Card>
      ) : items === null ? (
        <div className="space-y-2">
          <Skeleton className="h-14" />
          <Skeleton className="h-14" />
          <Skeleton className="h-14" />
        </div>
      ) : items.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No posts yet</CardTitle>
            <CardDescription>
              {hasActiveFilters
                ? "Nothing matches the current filters."
                : "Once you publish a post via the API, it shows up here — including the failures."}
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <StaggerList className="space-y-2">
          {items.map((post) => (
            <StaggerItem key={post.id}>
              <PostRow post={post} />
            </StaggerItem>
          ))}
        </StaggerList>
      )}

      {(items?.length ?? 0) > 0 && (nextCursor || !onFirstPage) ? (
        <div className="flex items-center justify-between gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={onFirstPage}
            onClick={() => setCursorStack((s) => s.slice(0, -1))}
          >
            Newer
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!nextCursor}
            onClick={() => {
              if (nextCursor) setCursorStack((s) => [...s, nextCursor]);
            }}
          >
            Older
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function PostRow({ post }: { post: PostListItem }) {
  const when = post.publishedAt ?? post.createdAt;
  const excerpt = post.text.length > 120 ? `${post.text.slice(0, 120)}…` : post.text;
  return (
    <Link
      href={`/posts/${post.id}`}
      className="block rounded-none ring-1 ring-foreground/10 hover:ring-foreground/30 hover:bg-muted/40 transition-[box-shadow,background] px-4 py-3"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className="uppercase tracking-wide">
              {post.platform}
            </Badge>
            <Badge variant={statusTone(post.status)}>{post.status}</Badge>
            {post.error?.code ? (
              <Badge variant="outline" className="font-mono">
                {post.error.code}
              </Badge>
            ) : null}
          </div>
          <div className="text-sm text-foreground line-clamp-2">{excerpt}</div>
          <div className="text-xs text-muted-foreground flex items-center gap-2">
            <span>{post.account.displayName ?? post.account.platformAccountId}</span>
            <span aria-hidden="true">·</span>
            <span>{new Date(when).toLocaleString()}</span>
          </div>
        </div>
        <ArrowRight className="size-4 text-muted-foreground shrink-0 mt-1" />
      </div>
    </Link>
  );
}
