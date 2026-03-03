import { currentProjectAtom } from "@/store/project";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useVirtualizer, Virtualizer } from "@tanstack/react-virtual";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { ScrollAreaVirtualizable } from "@/components/ui/scroll-area-virtualizable";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SidebarContent, SidebarHeader } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Item, ITEM_TYPE_NAMES, ModelVariant } from "@/types/item";
import { getItemList, getItemLitInfo, getItemMetadata, loadItemModel, saveWorkbench } from "@/commands/item";
import {
  itemGltfJsonAtom,
  itemLitInfoAtom,
  itemLoadingAtom,
  itemMetadataAtom,
  selectedItemAtom,
  selectedModelVariantAtom,
} from "@/store/item";
import { Input } from "@/components/ui/input";
import { ExportItemToGltf } from "./ExportItemToGltf";
import { WorkbenchNavigator } from "./WorkbenchNavigator";
import { WorkbenchSidePanel } from "./WorkbenchSidePanel";
import { Download, Upload, ArrowLeft, Save, Loader2 } from "lucide-react";
import { openImportWizardAtom } from "@/store/import";
import { isWorkbenchModeAtom, activeWorkbenchAtom, dummyPlacementModeAtom } from "@/store/workbench";
import { toast } from "@/hooks/use-toast";
import { LatestOnly } from "@/lib/latestOnly";
import { actionIds, useRegisterActionRuntime } from "@/features/actions";

export default function ItemNavigator() {
  const [items, setItems] = useState<Item[]>([]);
  const [filteredItems, setFilteredItems] = useState<Item[]>([]);
  const [showExport, setShowExport] = useState(false);
  const [saving, setSaving] = useState(false);
  const openImportWizard = useSetAtom(openImportWizardAtom);
  const [isWorkbenchMode, setIsWorkbenchMode] = useAtom(isWorkbenchModeAtom);
  const [activeWorkbench, setActiveWorkbench] = useAtom(activeWorkbenchAtom);
  const setPlacementMode = useSetAtom(dummyPlacementModeAtom);
  const currentProject = useAtomValue(currentProjectAtom);
  const [itemGltfJson, setItemGltfJson] = useAtom(itemGltfJsonAtom);
  const [, setItemLitInfo] = useAtom(itemLitInfoAtom);
  const [, setItemMetadata] = useAtom(itemMetadataAtom);
  const [, setItemLoading] = useAtom(itemLoadingAtom);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const modelVariant = useAtomValue(selectedModelVariantAtom);
  const [selectedItem, setSelectedItem] = useAtom(selectedItemAtom);
  const listRequestGuard = useRef(new LatestOnly());
  const modelLoadGuard = useRef(new LatestOnly());

  useEffect(() => {
    async function fetchItems() {
      const requestVersion = listRequestGuard.current.begin();
      if (!currentProject) {
        setItems([]);
        return;
      }

      const itemList = await getItemList(currentProject.id);
      if (!listRequestGuard.current.isLatest(requestVersion)) {
        return;
      }
      setItems(itemList);
    }
    fetchItems();

    return () => {
      listRequestGuard.current.invalidate();
    };
  }, [currentProject]);

  // Get unique item types for the filter dropdown
  const itemTypes = useMemo(() => {
    const types = new Set(items.map((i) => i.item_type));
    return Array.from(types).sort((a, b) => a - b);
  }, [items]);

  useEffect(() => {
    setFilteredItems(
      items.filter((item) => {
        const matchesQuery = item.name
          .toLowerCase()
          .includes(query.toLowerCase()) ||
          item.id.toString().includes(query);
        const matchesType =
          typeFilter === "all" || item.item_type === Number(typeFilter);
        return matchesQuery && matchesType;
      })
    );
  }, [query, items, typeFilter]);

  const parentRef = React.useRef(null);
  const rowVirtualizer: Virtualizer<Element, Element> = useVirtualizer({
    count: filteredItems.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 40,
  });

  function getModelId(item: Item, variant: ModelVariant): string {
    switch (variant) {
      case "ground":
        return item.model_ground;
      case "lance":
        return item.model_lance;
      case "carsise":
        return item.model_carsise;
      case "phyllis":
        return item.model_phyllis;
      case "ami":
        return item.model_ami;
    }
  }

  async function loadModel(item: Item, variant: ModelVariant) {
    if (!item || !currentProject) return;
    const requestVersion = modelLoadGuard.current.begin();

    const modelId = getModelId(item, variant);

    setItemLoading(true);
    setItemGltfJson(null);
    setItemMetadata(null);
    setItemLitInfo(null);

    try {
      if (modelId && modelId !== "0") {
        const [gltfJson, metadata, litInfo] = await Promise.all([
          loadItemModel(currentProject.id, modelId),
          getItemMetadata(currentProject.id, item.id, modelId),
          getItemLitInfo(currentProject.id, item.id),
        ]);
        if (!modelLoadGuard.current.isLatest(requestVersion)) {
          return;
        }
        setItemGltfJson(gltfJson);
        setItemMetadata(metadata);
        setItemLitInfo(litInfo);
      }
    } catch (error) {
      if (modelLoadGuard.current.isLatest(requestVersion)) {
        console.error("Error loading item:", error);
      }
    } finally {
      if (modelLoadGuard.current.isLatest(requestVersion)) {
        setItemLoading(false);
      }
    }
  }

  async function selectItem(item: Item) {
    // Exit workbench mode when selecting a regular item
    setIsWorkbenchMode(false);
    setActiveWorkbench(null);
    setSelectedItem(item);
    await loadModel(item, modelVariant);
  }

  // Reload model when variant changes while an item is selected
  useEffect(() => {
    if (selectedItem) {
      loadModel(selectedItem, modelVariant);
    }
  }, [modelVariant]);

  useEffect(() => {
    return () => {
      modelLoadGuard.current.invalidate();
    };
  }, []);

  function exitWorkbench() {
    setIsWorkbenchMode(false);
    setActiveWorkbench(null);
    setPlacementMode(false);
  }

  async function handleSaveWorkbench() {
    if (!activeWorkbench || !currentProject) return;
    setSaving(true);
    try {
      await saveWorkbench(currentProject.id, activeWorkbench);
      toast({ title: "Workbench saved" });
    } catch (err) {
      toast({ title: "Save failed", description: String(err) });
    } finally {
      setSaving(false);
    }
  }

  const itemExportActionRuntime = useMemo(
    () => ({
      run: () => {
        setShowExport(true);
      },
      isEnabled: () => Boolean(!isWorkbenchMode && selectedItem && itemGltfJson),
      disabledReason: () => {
        if (isWorkbenchMode) return "Unavailable while editing a workbench";
        if (!selectedItem || !itemGltfJson) return "No item preview loaded";
        return undefined;
      },
    }),
    [isWorkbenchMode, itemGltfJson, selectedItem],
  );
  const itemImportActionRuntime = useMemo(
    () => ({
      run: () => {
        openImportWizard("item");
      },
      isEnabled: () => !isWorkbenchMode,
      disabledReason: () => (isWorkbenchMode ? "Exit workbench mode first" : undefined),
    }),
    [isWorkbenchMode, openImportWizard],
  );
  const itemWorkbenchSaveActionRuntime = useMemo(
    () => ({
      run: () => {
        if (!saving) {
          void handleSaveWorkbench();
        }
      },
      isEnabled: () => Boolean(isWorkbenchMode && activeWorkbench && currentProject && !saving),
      disabledReason: () => {
        if (!isWorkbenchMode) return "Not in workbench mode";
        if (!activeWorkbench) return "No active workbench";
        if (!currentProject) return "No project selected";
        if (saving) return "Save already in progress";
        return undefined;
      },
    }),
    [activeWorkbench, currentProject, handleSaveWorkbench, isWorkbenchMode, saving],
  );

  useRegisterActionRuntime(actionIds.itemExportGltf, itemExportActionRuntime);
  useRegisterActionRuntime(actionIds.itemImportGltf, itemImportActionRuntime);
  useRegisterActionRuntime(actionIds.itemWorkbenchSave, itemWorkbenchSaveActionRuntime);

  // ── Workbench mode: replace navigator with editing tools ──
  if (isWorkbenchMode && activeWorkbench) {
    return (
      <div className="flex flex-col h-full">
        <SidebarHeader className="shrink-0">
          <SidebarContent>
            <div className="flex items-center justify-between">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs -ml-1"
                onClick={exitWorkbench}
              >
                <ArrowLeft className="h-3 w-3 mr-1" /> Items
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7"
                onClick={handleSaveWorkbench}
                disabled={saving}
              >
                {saving ? (
                  <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                ) : (
                  <Save className="h-3 w-3 mr-1" />
                )}
                Save
              </Button>
            </div>

            <div className="pt-1">
              <div className="flex items-center gap-2 mb-1">
                <div className="h-2 w-2 rounded-full bg-amber-400 shrink-0" />
                <span className="text-sm font-medium truncate">
                  {activeWorkbench.itemName || "Untitled Item"}
                </span>
              </div>
              <div className="text-[11px] text-muted-foreground font-mono">
                {activeWorkbench.modelId}
              </div>
            </div>
          </SidebarContent>
        </SidebarHeader>

        <ScrollArea className="flex-1 px-3 pb-4">
          <WorkbenchSidePanel />
        </ScrollArea>
      </div>
    );
  }

  // ── Normal mode: item browser ──
  return (
    <>
      <SidebarHeader>
        <SidebarContent>
          <span className="text-md font-semibold">Items</span>

          <label className="text-xs text-muted-foreground">Search</label>
          <Input
            id="item-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Name or ID..."
          />

          <label className="text-xs text-muted-foreground">Type</label>
          <select
            className="h-8 text-xs rounded-md border border-input bg-background px-2"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
          >
            <option value="all">All Types</option>
            {itemTypes.map((t) => (
              <option key={t} value={String(t)}>
                {ITEM_TYPE_NAMES[t] ?? `Type ${t}`}
              </option>
            ))}
          </select>

          <div className="text-xs text-muted-foreground">
            {filteredItems.length} items
          </div>

          <ScrollAreaVirtualizable
            className="h-96 w-full border overflow-auto"
            ref={parentRef}
          >
            <div
              style={{
                height: `${rowVirtualizer.getTotalSize()}px`,
                width: "100%",
                position: "relative",
              }}
            >
              {rowVirtualizer.getVirtualItems().map((virtualRow) => (
                <div
                  key={virtualRow.index}
                  style={{
                    position: "absolute",
                    top: virtualRow.start,
                    left: 0,
                    width: "100%",
                    height: virtualRow.size,
                  }}
                >
                  <Button
                    className="text-sm w-full justify-start truncate"
                    variant="link"
                    onClick={() =>
                      selectItem(filteredItems[virtualRow.index])
                    }
                  >
                    {filteredItems[virtualRow.index].id}:{" "}
                    {filteredItems[virtualRow.index].name}
                  </Button>
                </div>
              ))}
            </div>
          </ScrollAreaVirtualizable>

          <div className="flex gap-2 pt-2">
            <Button
              variant="outline"
              size="sm"
              className="flex-1"
              disabled={!selectedItem || !itemGltfJson}
              onClick={() => setShowExport(true)}
            >
              <Download className="h-3 w-3 mr-1" /> Export
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="flex-1"
              onClick={() => openImportWizard("item")}
            >
              <Upload className="h-3 w-3 mr-1" /> Import
            </Button>
          </div>

          <WorkbenchNavigator />
        </SidebarContent>
      </SidebarHeader>

      <ExportItemToGltf open={showExport} onOpenChange={setShowExport} />
    </>
  );
}
