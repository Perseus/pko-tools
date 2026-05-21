import {
  Building2,
  ChevronsUpDown,
  Flame,
  GalleryVerticalEnd,
  Map,
  Package,
  Sparkles,
  UserRound,
} from "lucide-react";
import { modLabel } from "@/lib/platform";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
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
  SidebarTrigger,
} from "../ui/sidebar";
import CharacterStatusBar from "@/features/character/CharacterStatusBar";
import { useAtom } from "jotai";
import { currentProjectAtom, projectListAtom } from "@/store/project";
import { NavLink, useLocation, useNavigate } from "react-router";
import { invokeTimed as invoke } from "@/commands/invokeTimed";
import { Project } from "@/types/project";

export default function SideNav() {
  const [projectList] = useAtom(projectListAtom);
  const [currentProject, setCurrentProject] = useAtom(currentProjectAtom);
  const navigate = useNavigate();
  const pathname = useLocation().pathname;

  async function selectProject(project: Project) {
    setCurrentProject(project);
    await invoke('select_project', { projectId: project.id });
  }

  function navToProjectCreator() {
    navigate("/project-creator", { state: { ts: Date.now() } });
  }

  const navigationData = {
    navMain: [
      {
        title: "Client",
        url: "#",
        items: [
          {
            title: "Characters",
            url: "/characters",
            isActive: pathname.startsWith("/characters"),
            icon: UserRound,
          },
          {
            title: "Effects",
            url: "/effects",
            isActive: pathname.startsWith("/effects"),
            icon: Sparkles,
          },
          {
            title: "Items",
            url: "/items",
            isActive: pathname.startsWith("/items"),
            icon: Package,
          },
          {
            title: "Forge Glows",
            url: "/forge-glows",
            isActive: pathname.startsWith("/forge-glows"),
            icon: Flame,
          },
          {
            title: "Maps",
            url: "/maps",
            isActive: pathname.startsWith("/maps"),
            icon: Map,
          },
          {
            title: "Buildings",
            url: "/buildings",
            isActive: pathname.startsWith("/buildings"),
            icon: Building2,
          },
        ],
      },
    ],
  };

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <div className="flex items-center gap-1 group-data-[collapsible=icon]:justify-center">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <SidebarMenuButton
                    size="lg"
                    className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden"
                  >
                    <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                      <GalleryVerticalEnd className="size-4" />
                    </div>
                    <div className="flex min-w-0 flex-col gap-0.5 leading-none">
                      {currentProject ? (
                        <>
                          <span className="truncate text-sm font-semibold">
                            {currentProject.name}
                          </span>
                          <span className="truncate text-xs">
                            {currentProject.projectDirectory}
                          </span>
                        </>
                      ) : (
                        <>
                          <span className="truncate text-sm font-semibold">
                            Projects
                          </span>
                          <span className="truncate text-xs">Select a project </span>
                        </>
                      )}
                    </div>
                    <ChevronsUpDown className="ml-auto" />
                  </SidebarMenuButton>
                </DropdownMenuTrigger>

                <DropdownMenuContent className="w-[--radix-popper-anchor-width]">
                  {projectList.map((project) => (
                    <DropdownMenuItem
                      key={project.id}
                      onClick={() => selectProject(project)}
                      className="hover:cursor-pointer"
                    >
                      {project.name}
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuItem
                    key={"project-creator"}
                    onSelect={() => navToProjectCreator()}
                    className="hover:cursor-pointer"
                  >
                    Create a new project
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <SidebarTrigger
                aria-label="Toggle app sidebar"
                title="Toggle app sidebar"
                className="size-8 shrink-0"
              />
            </div>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      {currentProject && (
        <SidebarContent>
          {navigationData.navMain.map((navItem) => (
            <SidebarGroup key={navItem.title}>
              <SidebarGroupLabel>{navItem.title}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {navItem.items.map((item) => {
                    const Icon = item.icon;

                    return (
                      <SidebarMenuItem key={item.title}>
                        <SidebarMenuButton
                          asChild
                          isActive={item.isActive}
                          tooltip={item.title}
                        >
                          <NavLink to={item.url}>
                            <Icon aria-hidden="true" />
                            <span>{item.title}</span>
                          </NavLink>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ))}
        </SidebarContent>
      )}

      <SidebarFooter>
        {pathname.startsWith("/characters") && (
          <div className="group-data-[collapsible=icon]:hidden">
            <CharacterStatusBar />
          </div>
        )}
        <div className="flex items-center justify-between text-sm text-sidebar-foreground/80 group-data-[collapsible=icon]:hidden">
          <span>pko-tools {__APP_VERSION__} by Perseus</span>
          <kbd className="pointer-events-none select-none rounded border border-sidebar-border bg-sidebar-accent px-1.5 py-0.5 font-mono text-xs text-sidebar-foreground">
            {modLabel}K
          </kbd>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
