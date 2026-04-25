import { cn } from "@/lib/utils";

/**
 * Brand mark — forest-green square with "LM" in paper-cream Commit Mono.
 * Matches the badge in the sidebar so the brand reads consistently from the
 * sign-in screen through the app shell. SVG-based so it scales without
 * pixelating on retina + favicon contexts.
 */
export function Logo({
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
      className={cn("inline-block", className)}
      aria-label="letmepost"
    >
      <rect width="32" height="32" fill="hsl(150 45% 32%)" />
      <text
        x="16"
        y="22"
        textAnchor="middle"
        fontFamily="'Commit Mono', ui-monospace, Menlo, monospace"
        fontWeight="700"
        fontSize="14"
        fill="hsl(30 25% 98%)"
      >
        LM
      </text>
    </svg>
  );
}
