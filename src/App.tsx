import {
  Routes,
  Route,
  useNavigate,
} from "react-router";

import "./assets/index.css";
import SideNav from "./components/SideNav/SideNav";
import { SidebarProvider } from "./components/ui/sidebar";
import { getCurrentProject, getProjectList } from "./commands/project";
import { useAtom } from "jotai";
import { currentProjectAtom, projectListAtom } from "./store/project";
import { lazy, Suspense, useEffect } from "react";
import WorkspaceNavigator from "./components/WorkspaceNavigator/WorkspaceNavigator";
import { Toaster } from "./components/ui/toaster";
import { ImportWizard } from "./features/import/ImportWizard";
import { ActionKernelProvider, CommandPalette } from "./features/actions";

const CharacterPage = lazy(() => import("./pages/characters"));
const EffectsPage = lazy(() => import("./pages/effects-v2"));
const ItemsPage = lazy(() => import("./pages/items"));
const ForgeGlowsPage = lazy(() => import("./pages/forge-glows"));
const MapsPage = lazy(() => import("./pages/maps"));
const BuildingsPage = lazy(() => import("./pages/buildings"));
const ProjectCreator = lazy(() => import("./pages/project-creator/ProjectCreator"));

function App() {
  const [, setCurrentProject] = useAtom(currentProjectAtom);
  const [, setProjectList] = useAtom(projectListAtom);
  const navigate = useNavigate();

  useEffect(() => {
    async function bootstrap() {
      const [currentProject, projectList] = await Promise.all([
        getCurrentProject(),
        getProjectList(),
      ]);

      setCurrentProject(currentProject);
      setProjectList(projectList);

      if (projectList.length === 0) {
        navigate("/project-creator");
      }
    }

    bootstrap();
  }, []);

  return (
    <SidebarProvider>
      <ActionKernelProvider>
        <div className="grid h-dvh w-dvw overflow-hidden">
          <main className="grid h-full min-h-0 min-w-0 grid-cols-[auto,minmax(0,1fr),auto] overflow-hidden">
            <SideNav />
            <Suspense
              fallback={<div className="h-full min-h-0 w-full min-w-0 overflow-hidden bg-background" />}
            >
              <div className="h-full min-h-0 w-full min-w-0 overflow-hidden">
                <Routes>
                  <Route path="/" element={<div />} />
                  <Route path="/project-creator" element={<ProjectCreator />} />
                  <Route path="/characters" element={<CharacterPage/>} />
                  <Route path="/effects" element={<EffectsPage />} />
                  <Route path="/items" element={<ItemsPage />} />
                  <Route path="/forge-glows" element={<ForgeGlowsPage />} />
                  <Route path="/maps" element={<MapsPage />} />
                  <Route path="/buildings" element={<BuildingsPage />} />
                  <Route path="*" element={<div />} />
                </Routes>
              </div>
            </Suspense>
            <WorkspaceNavigator />
          </main>
          <ImportWizard />
          <CommandPalette />
          <Toaster />
        </div>
      </ActionKernelProvider>
    </SidebarProvider>
  );
}

export default App;
