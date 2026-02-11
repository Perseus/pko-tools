import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAtomValue, useSetAtom } from "jotai";
import {
  importWizardStateAtom,
  setImportModelIdAtom,
  setImportCharacterNameAtom,
  setImportScaleAtom,
} from "@/store/import";
import { currentProjectAtom } from "@/store/project";
import { useEffect, useRef, useState } from "react";
import { checkModelIdAvailable, getNextAvailableModelId } from "@/commands/import";
import { Loader2, Check, X } from "lucide-react";

export function ConfigurationStep() {
  const state = useAtomValue(importWizardStateAtom);
  const setModelId = useSetAtom(setImportModelIdAtom);
  const setCharName = useSetAtom(setImportCharacterNameAtom);
  const setScale = useSetAtom(setImportScaleAtom);
  const currentProject = useAtomValue(currentProjectAtom);

  const [idAvailable, setIdAvailable] = useState<boolean | null>(null);
  const [checking, setChecking] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  // Suggest next available model ID on mount
  useEffect(() => {
    if (currentProject?.id && state.modelId === "") {
      getNextAvailableModelId(currentProject.id)
        .then((nextId) => {
          setModelId(nextId.toString());
        })
        .catch(() => {});
    }
  }, [currentProject?.id]);

  // Debounced availability check
  useEffect(() => {
    if (!currentProject?.id || !state.modelId) {
      setIdAvailable(null);
      return;
    }

    const modelIdNum = parseInt(state.modelId);
    if (isNaN(modelIdNum) || modelIdNum < 1) {
      setIdAvailable(null);
      return;
    }

    setChecking(true);
    clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(() => {
      checkModelIdAvailable(currentProject.id, modelIdNum)
        .then((available) => {
          setIdAvailable(available);
          setChecking(false);
        })
        .catch(() => {
          setIdAvailable(null);
          setChecking(false);
        });
    }, 500);

    return () => clearTimeout(debounceRef.current);
  }, [state.modelId, currentProject?.id]);

  return (
    <div className="space-y-4">
      <div>
        <Label className="text-sm font-medium">Model ID</Label>
        <div className="flex items-center gap-2 mt-1">
          <Input
            type="number"
            min={1}
            max={9999}
            value={state.modelId}
            onChange={(e) => setModelId(e.target.value)}
            placeholder="e.g. 800"
            className="w-32"
          />
          {checking && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          {!checking && idAvailable === true && (
            <span className="flex items-center gap-1 text-green-400 text-xs">
              <Check className="h-3 w-3" /> Available
            </span>
          )}
          {!checking && idAvailable === false && (
            <span className="flex items-center gap-1 text-red-400 text-xs">
              <X className="h-3 w-3" /> Already in use
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Framework Number used in CharacterInfo.txt
        </p>
      </div>

      {state.importType === "character" && (
        <div>
          <Label className="text-sm font-medium">Character Name</Label>
          <Input
            value={state.characterName}
            onChange={(e) => setCharName(e.target.value)}
            placeholder="e.g. Custom Warrior"
            className="mt-1"
          />
          <p className="text-xs text-muted-foreground mt-1">
            Display name in CharacterInfo.txt (optional for registration)
          </p>
        </div>
      )}

      <div>
        <Label className="text-sm font-medium">Scale Factor</Label>
        <div className="flex items-center gap-3 mt-1">
          <Input
            type="number"
            step={0.01}
            min={0.001}
            value={state.scaleFactor}
            onChange={(e) => setScale(parseFloat(e.target.value) || 1.0)}
            className="w-28"
          />
          <span className="text-xs text-muted-foreground">
            PKO height ~2.0 units
          </span>
        </div>
      </div>
    </div>
  );
}
