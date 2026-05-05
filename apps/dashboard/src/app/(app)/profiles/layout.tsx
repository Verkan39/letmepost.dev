import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Profiles",
};

export default function ProfilesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
