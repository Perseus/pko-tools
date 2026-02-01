import CharacterNavigator from "@/features/character/CharacterNavigator";
import EffectNavigator from "@/features/effect/EffectNavigator";
import { Route, Routes } from "react-router";
import { Sidebar, SidebarContent } from "../ui/sidebar";

export default function WorkspaceNavigator() {
  return (
    <Sidebar side="right">
      <SidebarContent>
        <Routes>
          <Route path="/" element={<div></div>} />
          <Route path="/characters" element={<CharacterNavigator/>} />
          <Route path="/effects" element={<EffectNavigator />} />
          <Route path="*" element={<div />} />
        </Routes>
      </SidebarContent>
    </Sidebar>
  );
}
