import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "API keys",
};

export default function ApiKeysLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
