import { ChevronsUpDown, GalleryVerticalEnd } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "../ui/sidebar";
import { useAtom } from "jotai";
import { currentProjectAtom, projectListAtom } from "@/store/project";
import { NavLink, useLocation } from "react-router";
import { invoke } from "@tauri-apps/api/core";
import { Project } from "@/types/project";

export default function SideNav() {
  const [projectList] = useAtom(projectListAtom);
  const [currentProject, setCurrentProject] = useAtom(currentProjectAtom);
  const pathname = useLocation().pathname;

  async function selectProject(project: Project) {
    setCurrentProject(project);
    await invoke('select_project', { projectId: project.id });
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
          },
          {
            title: "Effects",
            url: "/effects",
            isActive: pathname.startsWith("/effects"),
          },
          {
            title: "Items",
            url: "/items",
            isActive: pathname.startsWith("/items"),
          },
          {
            title: "Maps",
            url: "/maps",
            isActive: pathname.startsWith("/maps"),
          },
          {
            title: "Buildings",
            url: "/buildings",
            isActive: pathname.startsWith("/buildings"),
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
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton size="lg">
                  <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                    <GalleryVerticalEnd className="size-4" />
                  </div>
                  <div className="flex flex-col gap-0.5 leading-none">
                    {currentProject ? (
                      <>
                        <span className="text-sm font-semibold">
                          {currentProject.name}
                        </span>
                        <span className="text-xs">
                          {currentProject.projectDirectory}
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="text-sm font-semibold">Projects</span>
                        <span className="text-xs">Select a project </span>
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
              </DropdownMenuContent>
            </DropdownMenu>
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
                  {navItem.items.map((item) => (
                    <SidebarMenuItem key={item.title}>
                      <SidebarMenuButton asChild isActive={item.isActive}>
                        <NavLink to={item.url}>{item.title}</NavLink>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ))}
        </SidebarContent>
      )}
    </Sidebar>
  );
}
