import type { Metadata } from "next";
import "@fontsource/commit-mono/400.css";
import "@fontsource/commit-mono/600.css";
import "@fontsource/commit-mono/700.css";
import "./globals.css";
import { cn } from "@/lib/utils";
import { Toaster } from "@/components/ui/sonner";

export const metadata: Metadata = {
  title: "letmepost dashboard",
  description: "Operator surface for letmepost.dev",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={cn("h-full antialiased")}>
      <body className="min-h-full flex flex-col">
        {children}
        <Toaster richColors closeButton position="top-right" />
      </body>
    </html>
  );
}
