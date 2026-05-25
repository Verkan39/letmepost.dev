import { cn } from "@/lib/utils";

/**
 * Brand mark — forest-green disc, three offset cream sheets, dashed ring.
 * Sourced from /public/logo.png so it stays in lockstep with the favicon
 * and the marketing site's logo without bitrotting into a hand-maintained
 * inline SVG.
 */
export function LogoMark({
  size = 32,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <img
      src="/logo.png"
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      className={cn("shrink-0 select-none", className)}
      draggable={false}
    />
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
