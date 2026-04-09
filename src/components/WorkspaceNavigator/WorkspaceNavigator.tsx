import CharacterNavigator from "@/features/character/CharacterNavigator";
import EffectV2Navigator from "@/features/effect-v2/EffectV2Navigator";
import ItemNavigator from "@/features/item/ItemNavigator";
import MapNavigator from "@/features/map/MapNavigator";
import BuildingsNavigator from "@/features/buildings/BuildingsNavigator";
import { Route, Routes } from "react-router";
import { Sidebar, SidebarContent } from "../ui/sidebar";

export default function WorkspaceNavigator() {
  return (
    <Sidebar side="right">
      <SidebarContent>
        <Routes>
          <Route path="/" element={<div></div>} />
          <Route path="/characters" element={<CharacterNavigator/>} />
          <Route path="/effects" element={<EffectV2Navigator />} />
          <Route path="/items" element={<ItemNavigator />} />
          <Route path="/maps" element={<MapNavigator />} />
          <Route path="/buildings" element={<BuildingsNavigator />} />
          <Route path="*" element={<div />} />
        </Routes>
      </SidebarContent>
    </Sidebar>
  );
}
