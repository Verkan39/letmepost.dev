/**
 * Inline brand SVGs for the v1 connectable platforms. Paths sourced from
 * simple-icons (CC0). Each icon is single-color (currentColor) so the
 * caller controls the rendered color via `style={{ color }}` — that lets
 * the onboarding grid go grayscale → brand color on hover with one CSS
 * filter.
 */

import type { ConnectablePlatform } from "@/lib/accounts";

type IconProps = { className?: string };

export function BlueskyIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 64 57"
      fill="currentColor"
      aria-hidden="true"
      className={className}
    >
      <path d="M13.873 3.805C21.21 9.332 29.103 20.537 32 26.55v15.882c0-.338-.13.044-.41.867-1.512 4.456-7.418 21.847-20.923 7.944-7.111-7.32-3.819-14.64 9.125-16.85-7.405 1.264-15.73-.825-18.014-9.015C1.12 23.022 0 8.51 0 6.55 0-3.268 8.579-.182 13.873 3.805ZM50.127 3.805C42.79 9.332 34.897 20.537 32 26.55v15.882c0-.338.13.044.41.867 1.512 4.456 7.418 21.847 20.923 7.944 7.111-7.32 3.819-14.64-9.125-16.85 7.405 1.264 15.73-.825 18.014-9.015C62.88 23.022 64 8.51 64 6.55 64-3.268 55.421-.182 50.127 3.805Z" />
    </svg>
  );
}

export function LinkedInIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className={className}
    >
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
    </svg>
  );
}

export function PinterestIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className={className}
    >
      <path d="M12 0a12 12 0 0 0-4.373 23.178c-.103-.95-.2-2.405.041-3.443.218-.937 1.404-5.965 1.404-5.965s-.359-.719-.359-1.781c0-1.668.967-2.914 2.171-2.914 1.024 0 1.518.769 1.518 1.69 0 1.029-.655 2.568-.994 3.995-.283 1.194.6 2.169 1.777 2.169 2.133 0 3.772-2.249 3.772-5.495 0-2.873-2.064-4.882-5.012-4.882-3.414 0-5.418 2.561-5.418 5.207 0 1.031.397 2.138.893 2.738.098.119.112.224.083.345l-.333 1.36c-.053.22-.174.267-.402.161-1.499-.698-2.436-2.889-2.436-4.649 0-3.785 2.75-7.262 7.929-7.262 4.163 0 7.398 2.967 7.398 6.931 0 4.136-2.607 7.464-6.227 7.464-1.216 0-2.359-.631-2.75-1.378l-.748 2.853c-.271 1.043-1.002 2.35-1.492 3.146C9.57 23.812 10.763 24 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0z" />
    </svg>
  );
}

export function ThreadsIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 192 192"
      fill="currentColor"
      aria-hidden="true"
      className={className}
    >
      <path d="M141.537 88.988a66.667 66.667 0 0 0-2.518-1.143c-1.482-27.307-16.403-42.94-41.457-43.1h-.34c-14.986 0-27.449 6.396-35.12 18.036l13.779 9.452c5.733-8.695 14.726-10.548 21.348-10.548h.229c8.249.053 14.474 2.452 18.503 7.129 2.932 3.405 4.893 8.111 5.864 14.05-7.314-1.243-15.224-1.626-23.68-1.14-23.82 1.371-39.134 15.264-38.105 34.572.522 9.793 5.4 18.216 13.735 23.715 7.047 4.648 16.124 6.92 25.557 6.402 12.458-.683 22.231-5.436 29.057-14.127 5.184-6.6 8.46-15.153 9.93-25.94 6.04 3.644 10.518 8.443 12.992 14.21 4.21 9.808 4.456 25.929-8.701 39.074-11.531 11.521-25.388 16.504-46.336 16.658-23.234-.172-40.8-7.62-52.213-22.138-10.685-13.594-16.207-33.244-16.413-58.401.206-25.156 5.728-44.806 16.413-58.4 11.413-14.518 28.978-21.966 52.212-22.138 23.404.173 41.277 7.658 53.116 22.241 5.806 7.151 10.184 16.143 13.079 26.589l16.169-4.308c-3.513-12.852-9.036-23.94-16.539-33.196C148.235 9.234 125.589.187 97.18 0h-.113C68.718.187 46.325 9.27 30.47 26.99 16.364 42.762 9.087 64.708 8.844 92.232L8.84 96l.004 3.768c.243 27.524 7.52 49.47 21.625 65.243C46.325 182.73 68.718 191.813 97.066 192h.113c25.198-.175 42.964-6.783 57.605-21.42 19.144-19.13 18.566-43.114 12.255-57.825-4.526-10.553-13.156-19.118-24.962-24.767ZM98.44 129.507c-10.44.588-21.286-4.098-21.82-14.135-.397-7.442 5.296-15.746 22.461-16.735 1.966-.114 3.895-.169 5.79-.169 6.235 0 12.068.606 17.371 1.765-1.978 24.702-13.58 28.713-23.802 29.274Z" />
    </svg>
  );
}

export function TwitterXIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className={className}
    >
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

export type PlatformBrand = {
  id: ConnectablePlatform;
  label: string;
  /** Brand color — usually a CSS var so it can flip per theme. */
  color: string;
  Icon: (props: IconProps) => React.ReactElement;
};

// Brand colors come from CSS vars in globals.css (--brand-*) so they flip
// between light and dark mode. The dark-mode overrides brighten X / Threads
// (pure black) and Pinterest / LinkedIn (sub-3:1 contrast) so brand icons
// stay legible on the deep ink background.
export const PLATFORM_BRANDS: PlatformBrand[] = [
  { id: "bluesky", label: "Bluesky", color: "var(--brand-bluesky)", Icon: BlueskyIcon },
  { id: "linkedin", label: "LinkedIn", color: "var(--brand-linkedin)", Icon: LinkedInIcon },
  { id: "pinterest", label: "Pinterest", color: "var(--brand-pinterest)", Icon: PinterestIcon },
  { id: "threads", label: "Threads", color: "var(--brand-threads)", Icon: ThreadsIcon },
  { id: "twitter", label: "X", color: "var(--brand-twitter)", Icon: TwitterXIcon },
];
