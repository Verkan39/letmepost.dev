/**
 * Public env accessors. `NEXT_PUBLIC_API_URL` is the letmepost API origin the
 * dashboard talks to — defaults to localhost:3000 so a fresh checkout works
 * without a .env.local file. Keep this list short; anything server-only should
 * live outside `NEXT_PUBLIC_`.
 */
export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";
