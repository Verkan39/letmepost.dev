"use client";

import { useState } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { ThemeProvider } from "next-themes";
import { makeQueryClient } from "@/lib/query-client";

/**
 * Client-side providers root. The QueryClient is created lazily inside a
 * useState initializer so React 19 + Next 16's strict-mode + concurrent
 * rendering can't accidentally instantiate two clients on first render.
 *
 * Devtools are tree-shaken out of production by their own package (only the
 * `production` build of react-query-devtools renders nothing); leaving the
 * import in place is fine.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(() => makeQueryClient());
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      <QueryClientProvider client={client}>
        {children}
        <ReactQueryDevtools
          initialIsOpen={false}
          buttonPosition="bottom-right"
        />
      </QueryClientProvider>
    </ThemeProvider>
  );
}
