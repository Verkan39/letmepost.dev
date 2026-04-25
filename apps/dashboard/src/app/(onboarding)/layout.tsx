import { Logo } from "@/components/app/logo";

export default function OnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="flex flex-col items-center gap-6">
        <Logo size={40} />
        {children}
      </div>
    </div>
  );
}
