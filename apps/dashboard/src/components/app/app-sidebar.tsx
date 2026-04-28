"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  House,
  Plug,
  Key,
  Broadcast,
  ListBullets,
  Folders,
  ImageSquare,
  SignOut,
  CaretUpDown,
  Check,
  Plus,
} from "@phosphor-icons/react";

import { authClient } from "@/lib/auth-client";
import { NewOrgDialog } from "@/components/app/new-org-dialog";
import { LogoMark } from "@/components/app/logo";
import { useActiveProfile } from "@/lib/profiles";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

const NAV_ITEMS = [
  { href: "/", label: "Dashboard", icon: House },
  { href: "/posts", label: "Logs", icon: ListBullets },
  { href: "/accounts", label: "Accounts", icon: Plug },
  { href: "/profiles", label: "Profiles", icon: Folders },
  { href: "/media", label: "Media", icon: ImageSquare },
  { href: "/api-keys", label: "API keys", icon: Key },
  { href: "/webhooks", label: "Webhooks", icon: Broadcast },
] as const;

export function AppSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { data: session } = authClient.useSession();
  const { data: organizations } = authClient.useListOrganizations();
  const activeOrg = authClient.useActiveOrganization().data;
  const [newOrgOpen, setNewOrgOpen] = useState(false);
  const {
    profiles,
    activeProfile,
    setActiveProfile,
    isLoading: profilesLoading,
  } = useActiveProfile();

  const initials = (session?.user.name ?? session?.user.email ?? "?")
    .split(/\s+/)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("")
    .slice(0, 2) || "?";

  async function handleSignOut() {
    await authClient.signOut();
    router.push("/sign-in");
  }

  async function switchOrg(id: string) {
    try {
      await authClient.organization.setActive({ organizationId: id });
      // Force a refresh so server components / API calls pick up the new active org.
      router.refresh();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to switch organization.",
      );
    }
  }

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent"
            >
              <LogoMark size={28} />

              <div className="flex flex-col leading-none text-left min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
                <span className="text-sm font-semibold truncate">
                  {activeOrg?.name ?? "No organization"}
                </span>
                <span className="text-xs text-muted-foreground truncate">
                  letmepost.dev
                </span>
              </div>
              <CaretUpDown className="ml-auto size-4 shrink-0 group-data-[collapsible=icon]:hidden" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuLabel>Organizations</DropdownMenuLabel>
            {organizations?.map((org) => (
              <DropdownMenuItem
                key={org.id}
                onSelect={() => switchOrg(org.id)}
              >
                <span className="truncate flex-1">{org.name}</span>
                {activeOrg?.id === org.id ? (
                  <Check className="size-4 text-muted-foreground" />
                ) : null}
              </DropdownMenuItem>
            ))}
            {organizations == null || organizations.length === 0 ? (
              <DropdownMenuItem disabled>No organizations yet</DropdownMenuItem>
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault();
                setNewOrgOpen(true);
              }}
            >
              <Plus className="size-4" />
              <span>New organization</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup className="group-data-[collapsible=icon]:hidden">
          <SidebarGroupLabel>Working in</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <SidebarMenuButton
                      className="data-[state=open]:bg-sidebar-accent"
                      disabled={profilesLoading || profiles.length === 0}
                    >
                      <Folders className="size-4" />
                      <span className="truncate flex-1 text-left">
                        {profilesLoading
                          ? "Loading…"
                          : activeProfile?.name ?? "No profile"}
                      </span>
                      {profiles.length > 1 ? (
                        <CaretUpDown className="ml-auto size-4 shrink-0" />
                      ) : null}
                    </SidebarMenuButton>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-56">
                    <DropdownMenuLabel>Profiles</DropdownMenuLabel>
                    {profiles.map((p) => (
                      <DropdownMenuItem
                        key={p.id}
                        onSelect={() => setActiveProfile(p.id)}
                      >
                        <span className="truncate flex-1">{p.name}</span>
                        {activeProfile?.id === p.id ? (
                          <Check className="size-4 text-muted-foreground" />
                        ) : null}
                      </DropdownMenuItem>
                    ))}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => router.push("/profiles")}>
                      <Plus className="size-4" />
                      <span>Manage profiles</span>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Operate</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const active =
                  item.href === "/"
                    ? pathname === "/"
                    : pathname === item.href ||
                      pathname.startsWith(`${item.href}/`);
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton asChild isActive={active}>
                      <Link href={item.href}>
                        <Icon className="size-4" />
                        <span>{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton size="lg">
              <Avatar className="size-8 shrink-0">
                <AvatarFallback>{initials}</AvatarFallback>
              </Avatar>
              <div className="flex flex-col leading-none text-left min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
                <span className="text-sm font-semibold truncate">
                  {session?.user.name ?? session?.user.email ?? "Account"}
                </span>
                <span className="text-xs text-muted-foreground truncate">
                  {session?.user.email ?? ""}
                </span>
              </div>
              <CaretUpDown className="ml-auto size-4 shrink-0 group-data-[collapsible=icon]:hidden" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>{session?.user.email}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={handleSignOut}>
              <SignOut className="size-4" />
              <span>Sign out</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarFooter>

      <NewOrgDialog open={newOrgOpen} onOpenChange={setNewOrgOpen} />
    </Sidebar>
  );
}
