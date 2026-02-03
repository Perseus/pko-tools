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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { selectedItemAtom, selectedModelVariantAtom } from "@/store/item";
import { importItemFromGltf } from "@/commands/item";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";
import { ModelVariant } from "@/types/item";

function getModelId(
  item: {
    model_ground: string;
    model_lance: string;
    model_carsise: string;
    model_phyllis: string;
    model_ami: string;
  },
  variant: ModelVariant
): string {
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

export function ImportItemFromGltf({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const selectedItem = useAtomValue(selectedItemAtom);
  const modelVariant = useAtomValue(selectedModelVariantAtom);
  const [gltfFile, setGltfFile] = useState<string | null>(null);
  const [modelId, setModelId] = useState<string>(() => {
    if (selectedItem) {
      const id = getModelId(selectedItem, modelVariant);
      return id !== "0" ? id : "";
    }
    return "";
  });
  const [isImporting, setIsImporting] = useState(false);
  const { toast } = useToast();

  async function openGltfFilePicker() {
    const file = await openDialog({
      multiple: false,
      directory: false,
      filters: [
        {
          extensions: ["gltf", "glb"],
          name: "glTF files",
        },
      ],
    });

    if (file) {
      setGltfFile(file);
    }
  }

  async function handleImport() {
    if (!gltfFile || !modelId.trim()) {
      toast({
        title: "Error",
        description: "Please pick a glTF file and enter a model ID",
      });
      return;
    }

    setIsImporting(true);
    try {
      const result = await importItemFromGltf(modelId.trim(), gltfFile);

      toast({
        title: "Import successful",
        description: (
          <div className="flex flex-col gap-1">
            <span>Created {result.lgo_file}</span>
            {result.texture_files.length > 0 && (
              <span>
                {result.texture_files.length} texture(s) saved
              </span>
            )}
            <button
              onClick={() => revealItemInDir(result.lgo_file)}
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
        title: "Import failed",
        description: (err as Error).toString(),
        variant: "destructive",
      });
    } finally {
      setIsImporting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Import Item from glTF</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            Convert a glTF file to an item model (.lgo + .bmp files). Files will
            be created in the <strong>pko-tools/imports/item</strong> directory.
          </p>
          <Button
            className="flex justify-start"
            onClick={openGltfFilePicker}
            type="button"
            variant="outline"
          >
            <div className="overflow-hidden text-ellipsis whitespace-nowrap">
              {gltfFile ? gltfFile : "Pick a glTF file..."}
            </div>
          </Button>
          {gltfFile && (
            <div className="flex flex-col gap-2">
              <Label>Model ID (e.g. 01010027)</Label>
              <Input
                type="text"
                value={modelId}
                onChange={(e) => setModelId(e.target.value)}
                placeholder="e.g. 01010027"
              />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button
            variant="default"
            onClick={handleImport}
            disabled={isImporting || !gltfFile || !modelId.trim()}
          >
            {isImporting ? (
              <>
                <Loader2 className="animate-spin" /> Importing...
              </>
            ) : (
              "Import"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
