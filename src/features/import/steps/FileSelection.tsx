import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useSetAtom, useAtomValue } from "jotai";
import {
  importWizardStateAtom,
  setImportFileAtom,
  setImportTypeAtom,
} from "@/store/import";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { FileUp } from "lucide-react";

export function FileSelection() {
  const state = useAtomValue(importWizardStateAtom);
  const setFile = useSetAtom(setImportFileAtom);
  const setImportType = useSetAtom(setImportTypeAtom);

  async function pickFile() {
    const file = await openDialog({
      multiple: false,
      directory: false,
      filters: [
        {
          extensions: ["gltf", "glb"],
          name: "3D Model files",
        },
      ],
    });

    if (file) {
      const parts = file.split(/[/\\]/);
      const fileName = parts[parts.length - 1] || file;
      setFile(file, fileName);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <Label className="text-sm font-medium">Import Type</Label>
        <div className="flex gap-2 mt-2">
          <Button
            variant={state.importType === "character" ? "default" : "outline"}
            size="sm"
            onClick={() => setImportType("character")}
          >
            Character
          </Button>
          <Button
            variant={state.importType === "item" ? "default" : "outline"}
            size="sm"
            onClick={() => setImportType("item")}
          >
            Item
          </Button>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          {state.importType === "character"
            ? "Character models include skeleton and animations (.lab + .lgo)"
            : "Item models are static meshes (.lgo only)"}
        </p>
      </div>

      <div>
        <Label className="text-sm font-medium">Model File</Label>
        <Button
          className="w-full mt-2 justify-start gap-2"
          variant="outline"
          onClick={pickFile}
        >
          <FileUp className="h-4 w-4" />
          <span className="overflow-hidden text-ellipsis whitespace-nowrap">
            {state.fileName || "Select a .gltf or .glb file..."}
          </span>
        </Button>
      </div>

      {state.filePath && (
        <p className="text-xs text-muted-foreground break-all">
          {state.filePath}
        </p>
      )}
    </div>
  );
}
