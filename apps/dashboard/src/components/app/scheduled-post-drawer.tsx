"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Trash, ArrowSquareOut, Clock } from "@phosphor-icons/react";
import {
  cancelPost,
  reschedulePost,
  type PostListItem,
} from "@/lib/posts";
import { ApiRequestError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { PLATFORM_BRANDS } from "@/components/app/platform-icons";

/**
 * Drawer for inspecting and mutating a single scheduled post. Driven by an
 * optional `post` prop; rendered open whenever a post is provided. Used from
 * both /calendar (click chip on day cell) and /posts (compose surface).
 *
 * Reschedule + cancel call the new PATCH/DELETE endpoints and invalidate the
 * posts query so every surface re-renders consistently.
 */
export function ScheduledPostDrawer({
  post,
  onOpenChange,
}: {
  post: PostListItem | null;
  onOpenChange: (open: boolean) => void;
}) {
  const qc = useQueryClient();
  const [draftWhen, setDraftWhen] = useState<Date | null>(null);
  const open = post != null;

  useEffect(() => {
    setDraftWhen(post?.scheduledAt ? new Date(post.scheduledAt) : null);
  }, [post]);

  const reschedule = useMutation({
    mutationFn: (when: Date) => {
      if (!post) throw new Error("No post selected");
      return reschedulePost(post.id, when.toISOString());
    },
    onSuccess: () => {
      toast.success("Rescheduled");
      qc.invalidateQueries({ queryKey: ["posts"] });
      onOpenChange(false);
    },
    onError: (err: unknown) => {
      const msg =
        err instanceof ApiRequestError
          ? err.payload.message ?? "Reschedule failed"
          : err instanceof Error
            ? err.message
            : "Reschedule failed";
      toast.error(msg);
    },
  });

  const cancel = useMutation({
    mutationFn: () => {
      if (!post) throw new Error("No post selected");
      return cancelPost(post.id);
    },
    onSuccess: () => {
      toast.success("Canceled");
      qc.invalidateQueries({ queryKey: ["posts"] });
      onOpenChange(false);
    },
    onError: (err: unknown) => {
      const msg =
        err instanceof ApiRequestError
          ? err.payload.message ?? "Cancel failed"
          : err instanceof Error
            ? err.message
            : "Cancel failed";
      toast.error(msg);
    },
  });

  const editable = post?.status === "queued";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md flex flex-col p-0">
        <SheetHeader className="p-4 border-b">
          <SheetTitle className="flex items-center gap-2">
            <Badge variant="outline" className="uppercase tracking-wide">
              {post?.platform}
            </Badge>
            <span className="text-sm font-normal capitalize">
              {post?.status}
            </span>
          </SheetTitle>
          <SheetDescription className="sr-only">
            Reschedule or cancel the scheduled post.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {post ? (
            <>
              <div>
                <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                  Content
                </Label>
                <p className="text-sm whitespace-pre-wrap mt-1">{post.text}</p>
              </div>

              <Separator />

              {editable ? (
                <div className="space-y-2">
                  <Label className="flex items-center gap-1.5">
                    <Clock className="size-3" />
                    Scheduled for
                  </Label>
                  <DateTimePicker
                    value={draftWhen}
                    onChange={setDraftWhen}
                    minDate={new Date(Date.now() + 60_000)}
                  />
                </div>
              ) : (
                <PostedStatusLine post={post} />
              )}

              <Separator />

              <div>
                <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                  {editable ? "Posting to" : "Posted to"}
                </Label>
                <AccountLine post={post} />
              </div>

              <div className="text-xs">
                <Link
                  href={`/logs/${post.id}`}
                  className="text-muted-foreground hover:text-foreground transition-colors inline-flex items-center gap-1"
                >
                  Open full log
                  <ArrowSquareOut className="size-3" />
                </Link>
              </div>
            </>
          ) : null}
        </div>

        {editable ? (
          <div className="p-4 border-t flex items-center justify-between gap-2">
            <Button
              variant="destructive"
              size="sm"
              onClick={() => cancel.mutate()}
              disabled={cancel.isPending}
            >
              <Trash className="size-3" />
              {cancel.isPending ? "Canceling…" : "Cancel"}
            </Button>
            <Button
              size="sm"
              onClick={() => draftWhen && reschedule.mutate(draftWhen)}
              disabled={reschedule.isPending || !draftWhen}
            >
              {reschedule.isPending ? "Saving…" : "Reschedule"}
            </Button>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function PostedStatusLine({ post }: { post: PostListItem }) {
  // Pick the most informative timestamp: actual publish time beats the
  // schedule (since the row fired and we know exactly when), and the
  // canceled state has no time so falls through to scheduledAt.
  const showPublished = post.publishedAt;
  const showCanceled = post.status === "canceled";
  const showScheduled =
    !showPublished && post.scheduledAt && !showCanceled;
  return (
    <div className="space-y-1">
      <Label className="flex items-center gap-1.5">
        <Clock className="size-3" />
        {showPublished
          ? "Posted on"
          : showCanceled
            ? "Was scheduled for"
            : showScheduled
              ? "Scheduled for"
              : "Created"}
      </Label>
      <p className="text-sm tabular-nums">
        {formatStamp(
          post.publishedAt ?? post.scheduledAt ?? post.createdAt,
        )}
      </p>
      {showCanceled ? (
        <p className="text-xs text-muted-foreground">
          This post was canceled before it fired.
        </p>
      ) : showPublished ? null : (
        <p className="text-xs text-muted-foreground">
          This post has already fired and can't be changed.
        </p>
      )}
    </div>
  );
}

function AccountLine({ post }: { post: PostListItem }) {
  const brand = PLATFORM_BRANDS.find((b) => b.id === post.platform);
  const Icon = brand?.Icon;
  const handle = post.account.displayName ?? post.account.platformAccountId;
  return (
    <div className="flex items-center gap-2 mt-1">
      {Icon ? <Icon className="size-4 shrink-0" /> : null}
      <div className="min-w-0">
        <p className="text-sm font-semibold capitalize">
          {brand?.label ?? post.platform}
        </p>
        <p className="text-xs text-muted-foreground truncate">{handle}</p>
      </div>
    </div>
  );
}

function formatStamp(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
