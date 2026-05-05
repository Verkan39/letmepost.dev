import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Connect account",
};

export default function ConnectAccountLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
