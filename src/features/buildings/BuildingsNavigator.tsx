import { currentProjectAtom } from "@/store/project";
import { useAtom, useAtomValue } from "jotai";
import { useVirtualizer, Virtualizer } from "@tanstack/react-virtual";
import React, { useEffect, useState } from "react";
import { ScrollAreaVirtualizable } from "@/components/ui/scroll-area-virtualizable";
import { SidebarHeader } from "@/components/ui/sidebar";
import { BuildingEntry } from "@/types/buildings";
import { getBuildingList, loadBuildingModel, exportBuildingToGltf } from "@/commands/buildings";
import {
  buildingGltfJsonAtom,
  buildingLoadingAtom,
  selectedBuildingAtom,
} from "@/store/buildings";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Download, Loader2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";

export default function BuildingsNavigator() {
  const [buildings, setBuildings] = useState<BuildingEntry[]>([]);
  const [filteredBuildings, setFilteredBuildings] = useState<BuildingEntry[]>(
    []
  );
  const [exporting, setExporting] = useState(false);
  const currentProject = useAtomValue(currentProjectAtom);
  const [, setBuildingGltfJson] = useAtom(buildingGltfJsonAtom);
  const [, setBuildingLoading] = useAtom(buildingLoadingAtom);
  const [query, setQuery] = useState("");
  const [selectedBuilding, setSelectedBuilding] = useAtom(selectedBuildingAtom);

  useEffect(() => {
    async function fetchBuildings() {
      if (currentProject) {
        try {
          const list = await getBuildingList(currentProject.id);
          setBuildings(list);
        } catch (err) {
          console.error("Failed to load building list:", err);
        }
      }
    }
    fetchBuildings();
  }, [currentProject]);

  useEffect(() => {
    setFilteredBuildings(
      buildings.filter(
        (b) =>
          b.display_name.toLowerCase().includes(query.toLowerCase()) ||
          b.filename.toLowerCase().includes(query.toLowerCase()) ||
          String(b.id).includes(query)
      )
    );
  }, [query, buildings]);

  const parentRef = React.useRef(null);
  const rowVirtualizer: Virtualizer<Element, Element> = useVirtualizer({
    count: filteredBuildings.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 48,
    overscan: 5,
  });

  async function selectBuilding(building: BuildingEntry) {
    if (!currentProject) return;
    setSelectedBuilding(building);
    setBuildingGltfJson(null);
    setBuildingLoading(true);

    try {
      const gltfJson = await loadBuildingModel(
        currentProject.id,
        building.id
      );
      setBuildingGltfJson(gltfJson);
    } catch (err) {
      console.error("Failed to load building:", err);
      toast({
        title: "Failed to load building",
        description: String(err),
        variant: "destructive",
      });
    } finally {
      setBuildingLoading(false);
    }
  }

  async function handleExport() {
    if (!currentProject || !selectedBuilding) return;
    setExporting(true);
    try {
      const outputDir = `${currentProject.projectDirectory}/pko-tools/exports/buildings`;
      const result = await exportBuildingToGltf(
        currentProject.id,
        selectedBuilding.id,
        outputDir
      );
      toast({
        title: "Export complete",
        description: `Saved to ${result}`,
      });
    } catch (err) {
      toast({
        title: "Export failed",
        description: String(err),
        variant: "destructive",
      });
    } finally {
      setExporting(false);
    }
  }

  return (
    <>
      <SidebarHeader className="p-2 border-b">
        <div className="flex items-center justify-between mb-1.5">
          <h3 className="text-sm font-semibold">Buildings</h3>
          <span className="text-xs text-muted-foreground">
            {buildings.length} models
          </span>
        </div>
        <Input
          placeholder="Search buildings..."
          className="h-7 text-xs"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {selectedBuilding && (
          <Button
            variant="outline"
            size="sm"
            className="w-full mt-1.5 h-7 text-xs"
            onClick={handleExport}
            disabled={exporting}
          >
            {exporting ? (
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            ) : (
              <Download className="mr-1 h-3 w-3" />
            )}
            Export to glTF
          </Button>
        )}
      </SidebarHeader>

      <ScrollAreaVirtualizable ref={parentRef} className="flex-1">
        <div
          className="relative w-full"
          style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
        >
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const building = filteredBuildings[virtualRow.index];
            const isSelected = selectedBuilding?.id === building.id;

            return (
              <div
                key={building.id}
                className={`absolute top-0 left-0 w-full px-2 py-1.5 cursor-pointer text-xs hover:bg-accent ${
                  isSelected ? "bg-accent" : ""
                }`}
                style={{
                  height: `${virtualRow.size}px`,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
                onClick={() => selectBuilding(building)}
              >
                <div className="font-medium truncate">
                  {building.display_name}
                </div>
                <div className="text-muted-foreground">
                  ID: {building.id}
                </div>
              </div>
            );
          })}
        </div>
      </ScrollAreaVirtualizable>
    </>
  );
}
