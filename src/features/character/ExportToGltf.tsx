import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { selectedCharacterAtom } from "@/store/character";
import { DialogDescription } from "@radix-ui/react-dialog";
import { invoke } from "@tauri-apps/api/core";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { useAtomValue } from "jotai";
import { Loader2 } from "lucide-react";
import { useState } from "react";

interface ExportResult {
  filePath: string;
  folderPath: string;
}

export default function ExportToGltf({ onOpenChange, open, onExportFinished }: { onOpenChange: (open: boolean) => void, open: boolean, onExportFinished: () => void }) {
  const selectedCharacter = useAtomValue(selectedCharacterAtom);
  const [isExporting, setIsExporting] = useState(false);
  const [yUp, setYUp] = useState(false);
  const { toast } = useToast();

  let fileName = selectedCharacter?.id;

  async function openInExplorer(filePath: string) {
    try {
      await revealItemInDir(filePath);
    } catch (err) {
      console.error("Failed to open folder:", err);
    }
  }

  async function exportGltf() {
    if (!selectedCharacter) {
      return;
    }

    setIsExporting(true);

    try {
      const response = await invoke<ExportResult>('export_to_gltf', {
        characterId: selectedCharacter.id,
        yUp,
      });
      toast({
        title: "Exported to glTF",
        description: (
          <div className="flex flex-col gap-1">
            <span>Exported to {response.filePath}</span>
            <button
              onClick={() => openInExplorer(response.filePath)}
              className="text-xs text-blue-400 hover:text-blue-300 underline text-left cursor-pointer"
            >
              Click to open in Explorer
            </button>
          </div>
        ),
      });
      onExportFinished();
    } catch (err: unknown) {
      toast({
        title: "Error exporting to glTF",
        description: (err as Error).toString(),
      });
    } finally {
      setIsExporting(false);
    }
  }

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent>
      <DialogHeader>
        <DialogTitle> Export {selectedCharacter?.name} to glTF </DialogTitle>
      </DialogHeader>
      <DialogDescription>
        This will create a glTF file called <strong>{fileName}.gltf</strong> in the <strong>pko-tools/exports/gltf</strong> folder
        inside your game client directory.
      </DialogDescription>
      <div className="flex items-center gap-2 py-2">
        <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
          <input
            type="checkbox"
            checked={yUp}
            onChange={(e) => setYUp(e.target.checked)}
            className="h-4 w-4 rounded border-zinc-600 accent-blue-500"
          />
          <span>Convert to Y-up coordinate system</span>
        </label>
        <span className="text-xs text-zinc-500">(recommended for Blender)</span>
      </div>
      <DialogFooter>
        <Button variant="default" onClick={exportGltf} disabled={isExporting}>
          {isExporting ? <><Loader2 className="animate-spin" /> Exporting...</> : 'Export'}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
}
