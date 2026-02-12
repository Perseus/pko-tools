import { currentProjectAtom } from "@/store/project";
import { useAtom, useAtomValue } from "jotai";
import { useVirtualizer, Virtualizer } from "@tanstack/react-virtual";
import React, { useEffect, useState } from "react";
import { ScrollAreaVirtualizable } from "@/components/ui/scroll-area-virtualizable";
import { SidebarHeader } from "@/components/ui/sidebar";
import { BuildingEntry } from "@/types/buildings";
import {
  getBuildingList,
  loadBuildingModel,
  exportBuildingToGltf,
  exportBuildingForEditing,
  importBuildingFromGltf,
} from "@/commands/buildings";
import {
  buildingGltfJsonAtom,
  buildingLoadingAtom,
  selectedBuildingAtom,
} from "@/store/buildings";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Download, Loader2, Pencil, Upload } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { toast } from "@/hooks/use-toast";

export default function BuildingsNavigator() {
  const [buildings, setBuildings] = useState<BuildingEntry[]>([]);
  const [filteredBuildings, setFilteredBuildings] = useState<BuildingEntry[]>(
    []
  );
  const [exporting, setExporting] = useState(false);
  const [exportingForEdit, setExportingForEdit] = useState(false);
  const [importing, setImporting] = useState(false);
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

  async function handleExportForEditing() {
    if (!currentProject || !selectedBuilding) return;
    setExportingForEdit(true);
    try {
      const result = await exportBuildingForEditing(
        currentProject.id,
        selectedBuilding.id
      );
      toast({
        title: "Exported for editing",
        description: `Saved to ${result}`,
      });
    } catch (err) {
      toast({
        title: "Export failed",
        description: String(err),
        variant: "destructive",
      });
    } finally {
      setExportingForEdit(false);
    }
  }

  async function handleImport() {
    if (!currentProject) return;
    const filePath = await open({
      multiple: false,
      filters: [{ name: "glTF/GLB", extensions: ["gltf", "glb"] }],
    });
    if (!filePath) return;

    const buildingId = prompt("Enter building ID (e.g., 100):");
    if (!buildingId) return;

    setImporting(true);
    try {
      const result = await importBuildingFromGltf(
        currentProject.id,
        buildingId,
        filePath,
        1.0
      );
      toast({
        title: "Import complete",
        description: `LMO saved to ${result.lmo_path}`,
      });
    } catch (err) {
      toast({
        title: "Import failed",
        description: String(err),
        variant: "destructive",
      });
    } finally {
      setImporting(false);
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
          <div className="flex gap-1 mt-1.5">
            <Button
              variant="outline"
              size="sm"
              className="flex-1 h-7 text-xs"
              onClick={handleExport}
              disabled={exporting}
            >
              {exporting ? (
                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
              ) : (
                <Download className="mr-1 h-3 w-3" />
              )}
              Export
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="flex-1 h-7 text-xs"
              onClick={handleExportForEditing}
              disabled={exportingForEdit}
            >
              {exportingForEdit ? (
                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
              ) : (
                <Pencil className="mr-1 h-3 w-3" />
              )}
              Edit
            </Button>
          </div>
        )}
        <Button
          variant="outline"
          size="sm"
          className="w-full mt-1.5 h-7 text-xs"
          onClick={handleImport}
          disabled={importing || !currentProject}
        >
          {importing ? (
            <Loader2 className="mr-1 h-3 w-3 animate-spin" />
          ) : (
            <Upload className="mr-1 h-3 w-3" />
          )}
          Import Building
        </Button>
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
