import { Button } from "@/components/ui/button";
import { selectedCharacterAtom } from "@/store/character";
import { useAtomValue } from "jotai";
import { useState } from "react";
import ExportToGltf from "./ExportToGltf";

export default function CharacterActions() {
  const selectedCharacter = useAtomValue(selectedCharacterAtom);
  const [isExportToGltfDialogOpen, setIsExportToGltfDialogOpen] = useState(false);

  return <div className="flex mt-4">
    {isExportToGltfDialogOpen && <ExportToGltf onOpenChange={setIsExportToGltfDialogOpen} />}
    {selectedCharacter && (
      <div>
        <div className="text-sm mb-4">
          Selected character: <strong> {selectedCharacter.name} </strong>
        </div>
        <Button variant="default" onClick={() => setIsExportToGltfDialogOpen(true)}>
          Export to glTF
        </Button>
      </div>
    )}
  </div>;
}
