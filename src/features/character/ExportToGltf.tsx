import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { selectedCharacterAtom } from "@/store/character";
import { DialogDescription } from "@radix-ui/react-dialog";
import { invoke } from "@tauri-apps/api/core";
import { useAtomValue } from "jotai";
import { Loader2 } from "lucide-react";
import { useState } from "react";

export default function ExportToGltf({ onOpenChange, open, onExportFinished }: { onOpenChange: (open: boolean) => void, open: boolean, onExportFinished: () => void }) {
  const selectedCharacter = useAtomValue(selectedCharacterAtom);
  const [isExporting, setIsExporting] = useState(false);
  const { toast } = useToast();

  let fileName = selectedCharacter?.id;

  async function exportGltf() {
    if (!selectedCharacter) {
      return;
    }

    setIsExporting(true);

    try {
      const response = await invoke<string>('export_to_gltf', {
        characterId: selectedCharacter.id
      });
      toast({
        title: "Exported to glTF",
        description: `Exported to ${response}`
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
        This will create a glTF file called <strong>{fileName}</strong> in the <strong>exports/gltf</strong> directory next to your
        pko-tools installation.
      </DialogDescription>
      <DialogFooter>
        <Button variant="default" onClick={exportGltf} disabled={isExporting}>
          {isExporting ? <><Loader2 className="animate-spin" /> Exporting...</> : 'Export'}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
}
