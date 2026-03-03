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
const EffectsPage = lazy(() => import("./pages/effects"));
const ItemsPage = lazy(() => import("./pages/items"));
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
        <div className="grid h-screen w-screen">
          <main className="grid grid-cols-[auto,1fr,auto] h-full">
            <SideNav />
            <Suspense fallback={<div className="h-full w-full bg-background" />}>
              <Routes>
                <Route path="/" element={<div />} />
                <Route path="/project-creator" element={<ProjectCreator />} />
                <Route path="/characters" element={<CharacterPage/>} />
                <Route path="/effects" element={<EffectsPage />} />
                <Route path="/items" element={<ItemsPage />} />
                <Route path="/maps" element={<MapsPage />} />
                <Route path="/buildings" element={<BuildingsPage />} />
                <Route path="*" element={<div />} />
              </Routes>
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
