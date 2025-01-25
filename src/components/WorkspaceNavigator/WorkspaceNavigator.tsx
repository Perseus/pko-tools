import CharacterNavigator from "@/features/character/CharacterNavigator";
import { Route, Routes } from "react-router";
import { Sidebar, SidebarContent } from "../ui/sidebar";

export default function WorkspaceNavigator() {
  return (
    <Sidebar side="right">
      <SidebarContent>
        <Routes>
          <Route path="/" element={<div>norm</div>} />
          <Route path="/characters" element={<CharacterNavigator/>} />
        </Routes>
      </SidebarContent>
    </Sidebar>
  );
}
