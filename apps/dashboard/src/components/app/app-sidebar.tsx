"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  House,
  Plug,
  Key,
  Broadcast,
  SignOut,
  CaretUpDown,
  Check,
  Plus,
} from "@phosphor-icons/react";

import { authClient } from "@/lib/auth-client";
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
  { href: "/accounts", label: "Accounts", icon: Plug },
  { href: "/api-keys", label: "API keys", icon: Key },
  { href: "/webhooks", label: "Webhooks", icon: Broadcast },
] as const;

export function AppSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { data: session } = authClient.useSession();
  const { data: organizations } = authClient.useListOrganizations();
  const activeOrg = authClient.useActiveOrganization().data;

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
              <div className="flex size-8 items-center justify-center bg-primary text-primary-foreground text-xs font-semibold">
                LM
              </div>
              <div className="flex flex-col leading-none text-left">
                <span className="text-sm font-semibold truncate">
                  {activeOrg?.name ?? "No organization"}
                </span>
                <span className="text-xs text-muted-foreground">
                  letmepost.dev
                </span>
              </div>
              <CaretUpDown className="ml-auto size-4" />
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
              onSelect={() => {
                const name = window.prompt("New organization name?");
                if (!name) return;
                const slug =
                  name
                    .toLowerCase()
                    .trim()
                    .replace(/[^a-z0-9]+/g, "-")
                    .replace(/^-+|-+$/g, "")
                    .slice(0, 60) ||
                  `org-${Math.random().toString(36).slice(2, 8)}`;
                authClient.organization
                  .create({ name, slug })
                  .then(async ({ data, error }) => {
                    if (error || !data) {
                      toast.error(error?.message ?? "Create org failed.");
                      return;
                    }
                    await authClient.organization.setActive({
                      organizationId: data.id,
                    });
                    router.refresh();
                  });
              }}
            >
              <Plus className="size-4" />
              <span>New organization</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarHeader>

      <SidebarContent>
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
              <Avatar className="size-8">
                <AvatarFallback>{initials}</AvatarFallback>
              </Avatar>
              <div className="flex flex-col leading-none text-left overflow-hidden">
                <span className="text-sm font-semibold truncate">
                  {session?.user.name ?? session?.user.email ?? "Account"}
                </span>
                <span className="text-xs text-muted-foreground truncate">
                  {session?.user.email ?? ""}
                </span>
              </div>
              <CaretUpDown className="ml-auto size-4" />
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
    </Sidebar>
  );
}
