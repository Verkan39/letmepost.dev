import { redirect } from "next/navigation";

/**
 * `/accounts/new` is folded into `/accounts` — the list page handles
 * both browsing existing accounts and opening the platform-picker drawer
 * (auto-opens when `?connect=1` is present). This file stays as a
 * permanent redirect so deep links, marketing-site CTAs that haven't
 * shipped the new URL yet, and bookmarks all land in the right place.
 */
export default function Page() {
  redirect("/accounts?connect=1");
}
