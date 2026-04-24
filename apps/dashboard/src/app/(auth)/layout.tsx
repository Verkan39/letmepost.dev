export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex-1 flex items-center justify-center bg-muted/30 px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="text-lg font-semibold tracking-tight">
            letmepost.dev
          </div>
          <div className="text-xs text-muted-foreground">
            operator dashboard
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}
