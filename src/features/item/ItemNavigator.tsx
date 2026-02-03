import { currentProjectAtom } from "@/store/project";
import { useAtom, useAtomValue } from "jotai";
import { useVirtualizer, Virtualizer } from "@tanstack/react-virtual";
import React, { useEffect, useMemo, useState } from "react";
import { ScrollAreaVirtualizable } from "@/components/ui/scroll-area-virtualizable";
import { SidebarContent, SidebarHeader } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Item, ITEM_TYPE_NAMES, ModelVariant } from "@/types/item";
import { getItemList, getItemLitInfo, getItemMetadata, loadItemModel } from "@/commands/item";
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
import { ImportItemFromGltf } from "./ImportItemFromGltf";
import { Download, Upload } from "lucide-react";

export default function ItemNavigator() {
  const [items, setItems] = useState<Item[]>([]);
  const [filteredItems, setFilteredItems] = useState<Item[]>([]);
  const [showExport, setShowExport] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [itemGltfJson, setItemGltfJson] = useAtom(itemGltfJsonAtom);
  const [, setItemLitInfo] = useAtom(itemLitInfoAtom);
  const [, setItemMetadata] = useAtom(itemMetadataAtom);
  const [, setItemLoading] = useAtom(itemLoadingAtom);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const modelVariant = useAtomValue(selectedModelVariantAtom);

  const currentProject = useAtomValue(currentProjectAtom);
  const [selectedItem, setSelectedItem] = useAtom(selectedItemAtom);

  useEffect(() => {
    async function fetchItems() {
      if (currentProject) {
        const itemList = await getItemList(currentProject.id);
        setItems(itemList);
      }
    }
    fetchItems();
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
        setItemGltfJson(gltfJson);
        setItemMetadata(metadata);
        setItemLitInfo(litInfo);
      }
    } catch (error) {
      console.error("Error loading item:", error);
    } finally {
      setItemLoading(false);
    }
  }

  async function selectItem(item: Item) {
    setSelectedItem(item);
    await loadModel(item, modelVariant);
  }

  // Reload model when variant changes while an item is selected
  useEffect(() => {
    if (selectedItem) {
      loadModel(selectedItem, modelVariant);
    }
  }, [modelVariant]);

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
              onClick={() => setShowImport(true)}
            >
              <Upload className="h-3 w-3 mr-1" /> Import
            </Button>
          </div>
        </SidebarContent>
      </SidebarHeader>

      <ExportItemToGltf open={showExport} onOpenChange={setShowExport} />
      <ImportItemFromGltf open={showImport} onOpenChange={setShowImport} />
    </>
  );
}
