export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex-1 flex min-h-screen items-center justify-center px-4 py-16">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center space-y-1.5">
          <div className="text-xl font-semibold tracking-tight">
            letmepost.dev
          </div>
          <div className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
            operator dashboard
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}
