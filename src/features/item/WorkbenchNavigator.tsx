import { useEffect } from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { currentProjectAtom } from "@/store/project";
import { activeWorkbenchAtom, isWorkbenchModeAtom, workbenchListAtom } from "@/store/workbench";
import { itemGltfJsonAtom, selectedItemAtom, itemMetadataAtom, itemLitInfoAtom } from "@/store/item";
import { listWorkbenches, loadWorkbench, deleteWorkbench } from "@/commands/item";
import { loadModelPreview } from "@/commands/import";
import { WorkbenchSummary, ITEM_TYPE_NAMES } from "@/types/item";
import { Button } from "@/components/ui/button";
import { Trash2, Wrench } from "lucide-react";
import { toast } from "@/hooks/use-toast";

export function WorkbenchNavigator() {
  const currentProject = useAtomValue(currentProjectAtom);
  const [workbenches, setWorkbenches] = useAtom(workbenchListAtom);
  const setActiveWorkbench = useSetAtom(activeWorkbenchAtom);
  const setIsWorkbenchMode = useSetAtom(isWorkbenchModeAtom);
  const setItemGltfJson = useSetAtom(itemGltfJsonAtom);
  const setSelectedItem = useSetAtom(selectedItemAtom);
  const setItemMetadata = useSetAtom(itemMetadataAtom);
  const setItemLitInfo = useSetAtom(itemLitInfoAtom);

  useEffect(() => {
    if (!currentProject) return;
    listWorkbenches(currentProject.id)
      .then(setWorkbenches)
      .catch(() => setWorkbenches([]));
  }, [currentProject?.id, setWorkbenches]);

  async function openWorkbench(summary: WorkbenchSummary) {
    if (!currentProject) return;
    try {
      const state = await loadWorkbench(currentProject.id, summary.modelId);

      // Load the glTF preview
      const gltfJson = await loadModelPreview(state.lgoPath, state.hasGlowOverlay);

      // Switch to workbench mode
      setSelectedItem(null);
      setItemMetadata(null);
      setItemLitInfo(null);
      setItemGltfJson(gltfJson);
      setActiveWorkbench(state);
      setIsWorkbenchMode(true);
    } catch (err) {
      toast({ title: "Failed to load workbench", description: String(err) });
    }
  }

  async function handleDelete(e: React.MouseEvent, modelId: string) {
    e.stopPropagation();
    if (!currentProject) return;
    try {
      await deleteWorkbench(currentProject.id, modelId);
      setWorkbenches(workbenches.filter((w) => w.modelId !== modelId));
      toast({ title: "Workbench deleted" });
    } catch (err) {
      toast({ title: "Delete failed", description: String(err) });
    }
  }

  if (workbenches.length === 0) return null;

  return (
    <div className="space-y-1.5 pt-2">
      <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground flex items-center gap-1">
        <Wrench className="h-3 w-3" />
        Imported ({workbenches.length})
      </label>
      <div className="space-y-0.5">
        {workbenches.map((wb) => (
          <div
            key={wb.modelId}
            className="flex items-center gap-1 group"
          >
            <Button
              variant="link"
              className="text-xs justify-start truncate flex-1 h-7 px-1"
              onClick={() => openWorkbench(wb)}
            >
              <span className="truncate">
                {wb.itemName || wb.modelId}
              </span>
              <span className="text-muted-foreground ml-1 shrink-0">
                {ITEM_TYPE_NAMES[wb.itemType] ?? ""}
              </span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-5 w-5 p-0 opacity-0 group-hover:opacity-100"
              onClick={(e) => handleDelete(e, wb.modelId)}
            >
              <Trash2 className="h-3 w-3 text-muted-foreground" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
