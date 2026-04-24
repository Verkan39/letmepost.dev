import { AppSidebar } from "@/components/app/app-sidebar";
import { AuthGuard } from "@/components/app/auth-guard";
import { Breadcrumbs } from "@/components/app/breadcrumbs";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";

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
            <Separator orientation="vertical" className="h-4" />
            <Breadcrumbs />
          </header>
          <div className="flex-1 p-6 md:p-8">{children}</div>
        </SidebarInset>
      </SidebarProvider>
    </AuthGuard>
  );
}
