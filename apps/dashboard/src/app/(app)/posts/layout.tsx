"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { ComposePostSheet } from "@/components/app/compose-post-sheet";

export default function PostsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [composeOpen, setComposeOpen] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (searchParams.get("compose") === "1") {
      setComposeOpen(true);
      const next = new URLSearchParams(searchParams.toString());
      next.delete("compose");
      const qs = next.toString();
      router.replace(qs ? `?${qs}` : "?", { scroll: false });
    }
  }, [searchParams, router]);

  return (
    <div className="space-y-4" data-page-wide>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold">Posts</h1>
          <p className="text-xs text-muted-foreground">
            Compose, schedule, and review your queued and published content.
          </p>
        </div>
        <Button size="sm" onClick={() => setComposeOpen(true)}>
          <Plus className="size-4" />
          Create post
        </Button>
      </div>
      {children}
      <ComposePostSheet open={composeOpen} onOpenChange={setComposeOpen} />
    </div>
  );
}
