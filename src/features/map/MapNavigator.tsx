import { currentProjectAtom } from "@/store/project";
import { useAtom, useAtomValue } from "jotai";
import { useVirtualizer, Virtualizer } from "@tanstack/react-virtual";
import React, { useEffect, useState } from "react";
import { ScrollAreaVirtualizable } from "@/components/ui/scroll-area-virtualizable";
import { SidebarHeader } from "@/components/ui/sidebar";
import { MapEntry } from "@/types/map";
import { getMapList, getMapMetadata, loadMapTerrain, exportMapToGltf } from "@/commands/map";
import {
  mapGltfJsonAtom,
  mapLoadingAtom,
  mapMetadataAtom,
  selectedMapAtom,
} from "@/store/map";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Download, Loader2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";

export default function MapNavigator() {
  const [maps, setMaps] = useState<MapEntry[]>([]);
  const [filteredMaps, setFilteredMaps] = useState<MapEntry[]>([]);
  const [exporting, setExporting] = useState(false);
  const currentProject = useAtomValue(currentProjectAtom);
  const [, setMapGltfJson] = useAtom(mapGltfJsonAtom);
  const [, setMapMetadata] = useAtom(mapMetadataAtom);
  const [, setMapLoading] = useAtom(mapLoadingAtom);
  const [query, setQuery] = useState("");
  const [selectedMap, setSelectedMap] = useAtom(selectedMapAtom);

  useEffect(() => {
    async function fetchMaps() {
      if (currentProject) {
        const mapList = await getMapList(currentProject.id);
        setMaps(mapList);
      }
    }
    fetchMaps();
  }, [currentProject]);

  useEffect(() => {
    setFilteredMaps(
      maps.filter((m) =>
        m.name.toLowerCase().includes(query.toLowerCase()) ||
        m.display_name.toLowerCase().includes(query.toLowerCase())
      )
    );
  }, [query, maps]);

  const parentRef = React.useRef(null);
  const rowVirtualizer: Virtualizer<Element, Element> = useVirtualizer({
    count: filteredMaps.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 48,
    overscan: 5,
  });

  async function selectMap(map: MapEntry) {
    if (!currentProject) return;
    setSelectedMap(map);
    setMapGltfJson(null);
    setMapMetadata(null);
    setMapLoading(true);

    try {
      const [gltfJson, metadata] = await Promise.all([
        loadMapTerrain(currentProject.id, map.name),
        getMapMetadata(currentProject.id, map.name),
      ]);
      setMapGltfJson(gltfJson);
      setMapMetadata(metadata);
    } catch (err) {
      console.error("Failed to load map:", err);
      toast({
        title: "Failed to load map",
        description: String(err),
        variant: "destructive",
      });
    } finally {
      setMapLoading(false);
    }
  }

  async function handleExport() {
    if (!currentProject || !selectedMap) return;
    setExporting(true);
    try {
      const result = await exportMapToGltf(currentProject.id, selectedMap.name);
      toast({
        title: "Export complete",
        description: `Saved to ${result.gltf_path}`,
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
          <h3 className="text-sm font-semibold">Maps</h3>
          <span className="text-xs text-muted-foreground">
            {maps.length} maps
          </span>
        </div>
        <Input
          placeholder="Search maps..."
          className="h-7 text-xs"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {selectedMap && (
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
            const map = filteredMaps[virtualRow.index];
            const isSelected = selectedMap?.name === map.name;

            return (
              <div
                key={map.name}
                className={`absolute top-0 left-0 w-full px-2 py-1.5 cursor-pointer text-xs hover:bg-accent ${
                  isSelected ? "bg-accent" : ""
                }`}
                style={{
                  height: `${virtualRow.size}px`,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
                onClick={() => selectMap(map)}
              >
                <div className="font-medium truncate">{map.display_name}</div>
                <div className="text-muted-foreground flex gap-2">
                  <span>{map.width}x{map.height}</span>
                  {map.has_obj && <span>obj</span>}
                  {map.has_rbo && <span>rbo</span>}
                </div>
              </div>
            );
          })}
        </div>
      </ScrollAreaVirtualizable>
    </>
  );
}
