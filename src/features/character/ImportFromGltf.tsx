import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Loader2 } from "lucide-react";
import { useState } from "react";
export default function ImportFromGltf({ onOpenChange, open, onImportFinished }: { onOpenChange: (open: boolean) => void, open: boolean, onImportFinished: () => void }) {
  const [gltfFile, setGltfFile] = useState<string | null>(null);
  const [modelId, setModelId] = useState<string>("");
  const [isImporting, setIsImporting] = useState(false);

  async function openGltfFilePicker() {
    const file = await openDialog({
      multiple: false,
      directory: false,
      filters: [
        {
          extensions: ["gltf", "glb"],
          name: "glTF files"
        }
      ]
    });

    if (file) {
      setGltfFile(file);
    }
  }

  async function importGltf() {
    if (!gltfFile || !modelId) {
      toast({
        title: "Error",
        description: "Please pick a glTF file and enter a character ID"
      });
      return;
    }

    const modelIdInt = parseInt(modelId);
    if (isNaN(modelIdInt) || modelIdInt < 1 || modelIdInt > 10000) {
      toast({
        title: "Error",
        description: "Model ID must be a number between 1 and 10000"
      });
      return;
    }

    try {
      const response = await invoke<string>('import_character_from_gltf', {
        modelId: modelIdInt,
        filePath: gltfFile
      });

      toast({
        title: "Success",
        description: response
      });
      onImportFinished();
    } catch (err: unknown) {
      toast({
        title: "Error",
        description: (err as Error).toString()
      });
    } finally {
      setIsImporting(false);
    }

  }

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Import from glTF</DialogTitle>
      </DialogHeader>
      <DialogDescription className="flex flex-col gap-4 max-w-[80%]">
        <div>
          Convert a .glTF file to a character (.lab + .lgo files). <br />
          This will create all the required files in the <strong>imports/characters</strong> directory.
        </div>
        <Button className="flex justify-start" onClick={openGltfFilePicker} type="button" variant="default">
          <div className="overflow-hidden text-ellipsis whitespace-nowrap">
            {gltfFile ? gltfFile : "Pick a glTF file"}
          </div>
        </Button>
        {gltfFile &&
          <div>
            <Label>Model ID (number between 1 and 10000)</Label>
            <Input type="text" value={modelId} onChange={(e) => setModelId(e.target.value)} />

            <Button className="mt-4" type="button" onClick={() => importGltf()} disabled={isImporting}>
              {isImporting ? <><Loader2 className="animate-spin" /> Importing...</> : 'Import'}
            </Button>
          </div>
        }
      </DialogDescription>

    </DialogContent>
  </Dialog>;
}