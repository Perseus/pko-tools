import { Button } from "@/components/ui/button";
import { selectedCharacterAtom } from "@/store/character";
import { useAtomValue } from "jotai";
import { useState } from "react";
import ExportToGltf from "./ExportToGltf";
import ImportFromGltf from "./ImportFromGltf";

export default function CharacterActions() {
  const selectedCharacter = useAtomValue(selectedCharacterAtom);
  const [isExportToGltfDialogOpen, setIsExportToGltfDialogOpen] = useState(false);
  const [isImportFromGltfDialogOpen, setIsImportFromGltfDialogOpen] = useState(false);

  return <div className="flex flex-col mt-4 gap-2">
    <ExportToGltf onOpenChange={setIsExportToGltfDialogOpen} open={isExportToGltfDialogOpen} onExportFinished={() => setIsExportToGltfDialogOpen(false)} />
    <ImportFromGltf onOpenChange={setIsImportFromGltfDialogOpen} open={isImportFromGltfDialogOpen} onImportFinished={() => setIsImportFromGltfDialogOpen(false)} />
    {selectedCharacter && (
      <div className="flex flex-col gap-2">
        <div className="text-sm mb-4">
          Selected character: <strong> {selectedCharacter.name} </strong>
        </div>
        <Button variant="default" onClick={() => setIsExportToGltfDialogOpen(true)}>
          Export to glTF
        </Button>
      </div>
    )}

    <Button className="mt-2" variant="default" onClick={() => setIsImportFromGltfDialogOpen(true)}>
      Import from glTF
    </Button>
  </div>;
}
