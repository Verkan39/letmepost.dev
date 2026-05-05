import type { Metadata } from "next";
import { LogoMark } from "@/components/app/logo";

export const metadata: Metadata = {
  title: "Welcome",
};

export default function OnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="flex flex-col items-center gap-6">
        <LogoMark size={32} />
        {children}
      </div>
    </div>
  );
}
