import { AppSidebar } from "@/components/app/app-sidebar";
import { AuthGuard } from "@/components/app/auth-guard";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthGuard>
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset>
          <header className="flex h-12 items-center gap-2 border-b px-4">
            <SidebarTrigger />
            <span className="text-xs text-muted-foreground">
              letmepost.dev / dashboard
            </span>
          </header>
          <div className="flex-1 p-6 md:p-8">{children}</div>
        </SidebarInset>
      </SidebarProvider>
    </AuthGuard>
  );
}
