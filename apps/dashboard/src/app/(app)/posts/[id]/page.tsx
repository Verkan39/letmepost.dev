"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Clipboard } from "@phosphor-icons/react";
import { toast } from "sonner";
import { ApiRequestError } from "@/lib/api";
import { getPost, statusTone, type PostDetail } from "@/lib/posts";
import { API_URL } from "@/lib/env";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Post detail — the full error contract, raw upstream response, and the
 * timeline of attempts. This is where the "fails loudly" promise becomes
 * visible to the operator. Don't truncate, don't summarize.
 */
export default function PostDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [post, setPost] = useState<PostDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    getPost(id)
      .then((p) => {
        if (!cancelled) setPost(p);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(
          err instanceof ApiRequestError
            ? err.payload.message
            : err instanceof Error
              ? err.message
              : "Failed to load post.",
        );
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" asChild>
        <Link href="/posts">
          <ArrowLeft className="size-4" />
          Back to log
        </Link>
      </Button>

      {error ? (
        <Card>
          <CardHeader>
            <CardTitle>Couldn&apos;t load post</CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
        </Card>
      ) : post === null ? (
        <div className="space-y-3">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-32" />
          <Skeleton className="h-48" />
        </div>
      ) : (
        <>
          <Header post={post} />
          {post.error ? <ErrorContract error={post.error} /> : null}
          <RecordSummary post={post} />
          {post.attempts.length > 0 ? (
            <Attempts attempts={post.attempts} />
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>Attempts</CardTitle>
                <CardDescription>
                  Per-attempt history is captured for retried posts. This post
                  hasn&apos;t recorded individual attempts yet — the canonical
                  state above is what we have.
                </CardDescription>
              </CardHeader>
            </Card>
          )}
          <CopyAsCurl post={post} />
        </>
      )}
    </div>
  );
}

function Header({ post }: { post: PostDetail }) {
  return (
    <div className="space-y-2">
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
      <h1 className="text-base font-semibold whitespace-pre-wrap break-words">
        {post.text}
      </h1>
      <div className="text-xs text-muted-foreground">
        {post.account.displayName ?? post.account.platformAccountId} ·{" "}
        {new Date(post.publishedAt ?? post.createdAt).toLocaleString()}
      </div>
    </div>
  );
}

function ErrorContract({ error }: { error: NonNullable<PostDetail["error"]> }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-destructive">Error</CardTitle>
        <CardDescription>
          The full error contract — code, rule, upstream response, remediation.
          Same shape your client SDK receives.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Field label="Code" value={error.code} mono />
        {error.rule ? <Field label="Rule" value={error.rule} mono /> : null}
        {error.platform ? (
          <Field label="Platform" value={error.platform} />
        ) : null}
        {error.platformVersion ? (
          <Field label="Platform version" value={error.platformVersion} mono />
        ) : null}
        {error.message ? (
          <Field label="Message" value={error.message} />
        ) : null}
        {error.remediation ? (
          <Field
            label="Remediation"
            value={error.remediation}
            description="Suggested fix"
          />
        ) : null}
        {error.platformResponse !== undefined ? (
          <div className="space-y-1.5">
            <div className="text-xs text-muted-foreground">
              Raw platform response
            </div>
            <pre className="bg-muted px-3 py-2 text-xs overflow-x-auto whitespace-pre-wrap break-all font-mono">
              {JSON.stringify(error.platformResponse, null, 2)}
            </pre>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function RecordSummary({ post }: { post: PostDetail }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Record</CardTitle>
        <CardDescription>Lifecycle + identifiers.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Field label="Post id" value={post.id} mono />
        <Field label="Account" value={post.accountId} mono />
        <Field label="Profile" value={post.profileId} mono />
        {post.platformUri ? (
          <Field label="Platform URI" value={post.platformUri} mono />
        ) : null}
        {post.platformCid ? (
          <Field label="Platform CID" value={post.platformCid} mono />
        ) : null}
        {post.scheduledAt ? (
          <Field
            label="Scheduled at"
            value={new Date(post.scheduledAt).toLocaleString()}
          />
        ) : null}
        {post.publishedAt ? (
          <Field
            label="Published at"
            value={new Date(post.publishedAt).toLocaleString()}
          />
        ) : null}
        <Field
          label="Created at"
          value={new Date(post.createdAt).toLocaleString()}
        />
      </CardContent>
    </Card>
  );
}

function Attempts({ attempts }: { attempts: PostDetail["attempts"] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Attempts</CardTitle>
        <CardDescription>
          Per-attempt history — useful for debugging retried posts.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {attempts.map((a, idx) => (
          <div key={a.id}>
            {idx > 0 ? <Separator className="my-3" /> : null}
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="font-mono">
                #{a.attemptNumber}
              </Badge>
              {a.succeeded === true ? (
                <Badge variant="default">succeeded</Badge>
              ) : a.succeeded === false ? (
                <Badge variant="destructive">failed</Badge>
              ) : (
                <Badge variant="secondary">in-flight</Badge>
              )}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              Started {new Date(a.startedAt).toLocaleString()}
              {a.finishedAt
                ? ` · Finished ${new Date(a.finishedAt).toLocaleString()}`
                : null}
            </div>
            {a.errorCode ? (
              <div className="mt-2 text-xs">
                <span className="font-mono">{a.errorCode}</span>
                {a.errorMessage ? `: ${a.errorMessage}` : ""}
              </div>
            ) : null}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function Field({
  label,
  value,
  mono,
  description,
}: {
  label: string;
  value: string;
  mono?: boolean;
  description?: string;
}) {
  return (
    <div className="space-y-1">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={`text-sm break-all ${
          mono ? "font-mono text-xs bg-muted px-2 py-1" : ""
        }`}
      >
        {value}
      </div>
      {description ? (
        <div className="text-xs text-muted-foreground">{description}</div>
      ) : null}
    </div>
  );
}

function CopyAsCurl({ post }: { post: PostDetail }) {
  const curl = `curl -X POST '${API_URL}/v1/posts' \\
  -H 'Authorization: Bearer lmp_live_…' \\
  -H 'Content-Type: application/json' \\
  -H 'Idempotency-Key: <generate>' \\
  -d '${JSON.stringify({
    account: { platform: post.platform, id: post.accountId },
    text: post.text,
  })}'`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(curl);
      toast.success("Copied curl to clipboard.");
    } catch {
      toast.error("Clipboard access denied.");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Reproduce</CardTitle>
        <CardDescription>
          Same request, ready to paste — replace the API key + idempotency
          token before running.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <pre className="bg-muted px-3 py-2 text-xs overflow-x-auto whitespace-pre-wrap break-all font-mono">
          {curl}
        </pre>
        <Button variant="outline" size="sm" onClick={copy}>
          <Clipboard className="size-4" />
          Copy as curl
        </Button>
      </CardContent>
    </Card>
  );
}
