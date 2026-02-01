import { useState } from "react";
import { useAtomValue } from "jotai";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { selectedItemAtom, selectedModelVariantAtom, itemGltfJsonAtom } from "@/store/item";
import { invoke } from "@tauri-apps/api/core";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";
import { ModelVariant } from "@/types/item";
import { DialogDescription } from "@radix-ui/react-dialog";

interface ExportResult {
  file_path: string;
  folder_path: string;
}

function getModelId(item: { model_ground: string; model_lance: string; model_carsise: string; model_phyllis: string; model_ami: string }, variant: ModelVariant): string {
  switch (variant) {
    case "ground": return item.model_ground;
    case "lance": return item.model_lance;
    case "carsise": return item.model_carsise;
    case "phyllis": return item.model_phyllis;
    case "ami": return item.model_ami;
  }
}

export function ExportItemToGltf({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const selectedItem = useAtomValue(selectedItemAtom);
  const gltfJson = useAtomValue(itemGltfJsonAtom);
  const modelVariant = useAtomValue(selectedModelVariantAtom);
  const [isExporting, setIsExporting] = useState(false);
  const { toast } = useToast();

  async function openInExplorer(filePath: string) {
    try {
      await revealItemInDir(filePath);
    } catch (err) {
      console.error("Failed to open folder:", err);
    }
  }

  async function handleExport() {
    if (!selectedItem) return;

    const modelId = getModelId(selectedItem, modelVariant);
    if (!modelId || modelId === "0") return;

    setIsExporting(true);
    try {
      const response = await invoke<ExportResult>("export_item_to_gltf", {
        itemId: selectedItem.id,
        modelId,
      });

      toast({
        title: "Exported to glTF",
        description: (
          <div className="flex flex-col gap-1">
            <span>Exported to {response.file_path}</span>
            <button
              onClick={() => openInExplorer(response.file_path)}
              className="text-xs text-blue-400 hover:text-blue-300 underline text-left cursor-pointer"
            >
              Click to open in Explorer
            </button>
          </div>
        ),
      });
      onOpenChange(false);
    } catch (err: unknown) {
      toast({
        title: "Error exporting to glTF",
        description: (err as Error).toString(),
        variant: "destructive",
      });
    } finally {
      setIsExporting(false);
    }
  }

  if (!selectedItem || !gltfJson) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Export {selectedItem.name} to glTF</DialogTitle>
        </DialogHeader>
        <DialogDescription>
          This will create a glTF file for the {modelVariant} model variant in
          the <strong>pko-tools/exports/item</strong> folder inside your game
          client directory.
        </DialogDescription>
        <DialogFooter>
          <Button
            variant="default"
            onClick={handleExport}
            disabled={isExporting}
          >
            {isExporting ? (
              <>
                <Loader2 className="animate-spin" /> Exporting...
              </>
            ) : (
              "Export"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
