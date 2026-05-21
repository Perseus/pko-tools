import CharacterNavigator from "@/features/character/CharacterNavigator";
import EffectV2Navigator from "@/features/effect-v2/EffectV2Navigator";
import ItemNavigator from "@/features/item/ItemNavigator";
import ForgeGlowNavigator from "@/features/forge-glow/ForgeGlowNavigator";
import MapNavigator from "@/features/map/MapNavigator";
import BuildingsNavigator from "@/features/buildings/BuildingsNavigator";
import { selectedMapAtom } from "@/store/map";
import { useAtomValue } from "jotai";
import { useEffect, useState, type CSSProperties } from "react";
import { Route, Routes, useLocation } from "react-router";
import { Sidebar, SidebarContent, SidebarProvider } from "../ui/sidebar";

export default function WorkspaceNavigator() {
  const location = useLocation();
  const selectedMap = useAtomValue(selectedMapAtom);
  const isMapsRoute =
    location.pathname === "/maps" || location.pathname.startsWith("/maps/");
  const [isMapsNavigatorExpanded, setIsMapsNavigatorExpanded] = useState(isMapsRoute);
  const hasSelectedMapOnMapsRoute = isMapsRoute && Boolean(selectedMap);
  const isMapsNavigatorCompact =
    hasSelectedMapOnMapsRoute && !isMapsNavigatorExpanded;
  const isMapsNavigatorOverlay =
    hasSelectedMapOnMapsRoute && isMapsNavigatorExpanded;

  useEffect(() => {
    if (isMapsRoute) {
      setIsMapsNavigatorExpanded(true);
    } else {
      setIsMapsNavigatorExpanded(false);
    }
  }, [isMapsRoute]);

  useEffect(() => {
    if (!isMapsNavigatorOverlay || !isMapsNavigatorExpanded) {
      return;
    }

    function collapseAfterOutsideInteraction(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }

      const panel = document.getElementById("map-navigator-panel");
      const rail = document.querySelector('[data-testid="map-navigator-rail"]');
      if (panel?.contains(target) || rail?.contains(target)) {
        return;
      }

      setIsMapsNavigatorExpanded(false);
    }

    document.addEventListener("pointerdown", collapseAfterOutsideInteraction, true);
    return () => {
      document.removeEventListener("pointerdown", collapseAfterOutsideInteraction, true);
    };
  }, [isMapsNavigatorExpanded, isMapsNavigatorOverlay]);

  const sidebarStyle = location.pathname.startsWith("/forge-glows")
    ? ({ "--sidebar-width": "22rem" } as CSSProperties)
    : hasSelectedMapOnMapsRoute
      ? ({ "--sidebar-width": "3rem" } as CSSProperties)
      : undefined;

  return (
    <SidebarProvider className="[display:contents]">
      <div data-testid="workspace-navigator-shell" style={sidebarStyle}>
        <Sidebar side="right" className={isMapsNavigatorOverlay ? "z-50" : undefined}>
          <SidebarContent>
            <Routes>
              <Route path="/" element={<div></div>} />
              <Route path="/characters" element={<CharacterNavigator/>} />
              <Route path="/effects" element={<EffectV2Navigator />} />
              <Route path="/items" element={<ItemNavigator />} />
              <Route path="/forge-glows" element={<ForgeGlowNavigator />} />
              <Route
                path="/maps"
                element={
                  <MapNavigator
                    compact={isMapsNavigatorCompact}
                    overlay={isMapsNavigatorOverlay}
                    onExpand={() => setIsMapsNavigatorExpanded(true)}
                    onCollapse={() => setIsMapsNavigatorExpanded(false)}
                  />
                }
              />
              <Route path="/buildings" element={<BuildingsNavigator />} />
              <Route path="*" element={<div />} />
            </Routes>
          </SidebarContent>
        </Sidebar>
      </div>
    </SidebarProvider>
  );
}
