"use client";

import { usePathname } from "next/navigation";

/**
 * Shared chrome for /posts/* — page title + lead copy. The view switcher
 * lives in the sidebar (Posts ▾ Grid / List / Calendar), not in the page
 * header, so this layout intentionally stays minimal.
 *
 * /posts/new gets its own chrome (full-bleed composer with its own back
 * arrow), so it bypasses the wrapper entirely.
 */
export default function PostsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  if (pathname.startsWith("/posts/new")) {
    return <>{children}</>;
  }
  return (
    <div className="space-y-4" data-page-wide>
      <div>
        <h1 className="text-lg font-semibold">Posts</h1>
        <p className="text-xs text-muted-foreground">
          Compose, schedule, and review your queued and published content.
        </p>
      </div>
      {children}
    </div>
  );
}
