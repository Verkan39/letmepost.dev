import { cn } from "@/lib/utils";

/**
 * Brand mark — same as `apps/web/src/components/Logo.astro`. Forest-green
 * circle with a paper-cream square rotated 16° inside. Color is taken via
 * `currentColor` on the circle so callers can recolor with text-* utilities;
 * the inner square uses `var(--background)` so it punches a hole through to
 * whatever the page bg is (works on either light or dark themes).
 */
export function LogoMark({
  size = 32,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className={cn("text-primary shrink-0", className)}
    >
      <circle cx="16" cy="16" r="15" fill="currentColor" />
      <rect
        x="9.5"
        y="9.5"
        width="13"
        height="13"
        fill="var(--background)"
        transform="rotate(16 16 16)"
      />
    </svg>
  );
}

/**
 * Mark + serif italic wordmark, matching the landing's `<Logo />`. Used on
 * the sign-in / sign-up / onboarding screens. The dashboard shell uses just
 * the mark so the org name has room.
 */
export function Logo({
  size = 32,
  showWordmark = true,
  showAlpha = true,
  className,
}: {
  size?: number;
  showWordmark?: boolean;
  showAlpha?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-[0.3rem] leading-none",
        className,
      )}
      aria-label="letmepost.dev"
    >
      <LogoMark size={size} />
      {showWordmark ? (
        <span className="inline-flex items-baseline">
          <span
            className="font-normal italic tracking-[-0.01em] leading-none text-foreground"
            style={{
              fontFamily: "var(--font-serif)",
              fontSize: `${size * 0.84}px`,
            }}
          >
            letmepost
          </span>
          <span
            className="font-normal italic tracking-[-0.01em] leading-none text-primary"
            style={{
              fontFamily: "var(--font-serif)",
              fontSize: `${size * 0.84}px`,
            }}
          >
            .dev
          </span>
          {showAlpha ? (
            <span
              className="ml-[0.4rem] font-mono font-semibold text-muted-foreground tracking-[0.04em] uppercase self-end"
              style={{
                fontSize: `${size * 0.32}px`,
                paddingBottom: `${size * 0.05}px`,
                opacity: 0.7,
              }}
            >
              [alpha]
            </span>
          ) : null}
        </span>
      ) : null}
    </span>
  );
}
