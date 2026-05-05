import { AppSidebar } from "@/components/app/app-sidebar";
import { AuthGuard } from "@/components/app/auth-guard";
import { Breadcrumbs } from "@/components/app/breadcrumbs";
import { PageTransition } from "@/components/app/motion";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { ProfileProvider } from "@/lib/profiles";

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthGuard>
      {/*
        ProfileProvider must wrap the entire authed surface so the sidebar
        switcher and every page share the same `activeProfileId`. Mounting
        it here (instead of inside each page) is what makes profile
        switching actually propagate.
      */}
      <ProfileProvider>
        <SidebarProvider>
          <AppSidebar />
          <SidebarInset>
            <header className="flex h-12 items-center gap-2 border-b px-4">
              <SidebarTrigger />
              <Breadcrumbs />
            </header>
            <div className="flex-1 p-6 md:p-8 [&>*]:max-w-5xl [&:has([data-page-wide])>*]:max-w-none">
              <PageTransition>{children}</PageTransition>
            </div>
          </SidebarInset>
        </SidebarProvider>
      </ProfileProvider>
    </AuthGuard>
  );
}
