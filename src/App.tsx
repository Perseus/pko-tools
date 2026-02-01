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
import { useEffect } from "react";
import StatusBar from "./components/StatusBar/StatusBar";
import CharacterPage from "./pages/characters";
import EffectsPage from "./pages/effects";
import WorkspaceNavigator from "./components/WorkspaceNavigator/WorkspaceNavigator";
import ProjectCreator from "./pages/project-creator/ProjectCreator";
import { Toaster } from "./components/ui/toaster";

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
      <div className="grid h-screen w-screen">
        <main className="grid grid-cols-[auto,1fr,auto] h-full">
          <SideNav />
          <Routes>
            <Route path="/" element={<div />} />
            <Route path="/project-creator" element={<ProjectCreator />} />
            <Route path="/characters" element={<CharacterPage/>} />
            <Route path="/effects" element={<EffectsPage />} />
            <Route path="*" element={<div />} />
          </Routes>
          <WorkspaceNavigator />
        </main>
        <Toaster />
        <StatusBar className="fixed bottom-0 z-20" />
      </div>
    </SidebarProvider>
  );
}

export default App;
