import { Button } from "@/components/ui/button";
import { actionIds, useRegisterActionRuntime } from "@/features/actions";
import { selectedCharacterAtom } from "@/store/character";
import { useAtomValue, useSetAtom } from "jotai";
import { useMemo, useState } from "react";
import ExportToGltf from "./ExportToGltf";
import { openImportWizardAtom } from "@/store/import";

export default function CharacterActions() {
  const selectedCharacter = useAtomValue(selectedCharacterAtom);
  const [isExportToGltfDialogOpen, setIsExportToGltfDialogOpen] = useState(false);
  const openImportWizard = useSetAtom(openImportWizardAtom);

  const exportActionRuntime = useMemo(
    () => ({
      run: () => {
        setIsExportToGltfDialogOpen(true);
      },
      isEnabled: () => Boolean(selectedCharacter),
      disabledReason: () => (selectedCharacter ? undefined : "No character selected"),
    }),
    [selectedCharacter],
  );
  const importActionRuntime = useMemo(
    () => ({
      run: () => {
        openImportWizard("character");
      },
      isEnabled: () => true,
    }),
    [openImportWizard],
  );

  useRegisterActionRuntime(actionIds.characterExportGltf, exportActionRuntime);
  useRegisterActionRuntime(actionIds.characterImportGltf, importActionRuntime);

  return <div className="flex flex-col mt-4 gap-2">
    <ExportToGltf onOpenChange={setIsExportToGltfDialogOpen} open={isExportToGltfDialogOpen} onExportFinished={() => setIsExportToGltfDialogOpen(false)} />
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

    <Button className="mt-2" variant="default" onClick={() => openImportWizard("character")}>
      Import from glTF
    </Button>
  </div>;
}
