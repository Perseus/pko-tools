import { Button } from "@/components/ui/button";
import { useAtomValue, useSetAtom } from "jotai";
import { importWizardStateAtom, resetImportWizardAtom } from "@/store/import";
import { currentProjectAtom } from "@/store/project";
import { registerImportedCharacter, loadModelPreview } from "@/commands/import";
import { createWorkbench } from "@/commands/item";
import { toast } from "@/hooks/use-toast";
import { Check, Eye, FolderOpen, Loader2, UserPlus, Wrench } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { invoke } from "@tauri-apps/api/core";
import { itemGltfJsonAtom, selectedItemAtom, itemMetadataAtom, itemLitInfoAtom } from "@/store/item";
import { characterGltfJsonAtom } from "@/store/character";
import { activeWorkbenchAtom, isWorkbenchModeAtom, workbenchListAtom } from "@/store/workbench";
import { listWorkbenches, loadWorkbench } from "@/commands/item";

export function ResultStep() {
  const state = useAtomValue(importWizardStateAtom);
  const currentProject = useAtomValue(currentProjectAtom);
  const resetWizard = useSetAtom(resetImportWizardAtom);
  const setItemGltfJson = useSetAtom(itemGltfJsonAtom);
  const setSelectedItem = useSetAtom(selectedItemAtom);
  const setItemMetadata = useSetAtom(itemMetadataAtom);
  const setItemLitInfo = useSetAtom(itemLitInfoAtom);
  const setCharacterGltfJson = useSetAtom(characterGltfJsonAtom);
  const setActiveWorkbench = useSetAtom(activeWorkbenchAtom);
  const setIsWorkbenchMode = useSetAtom(isWorkbenchModeAtom);
  const setWorkbenchList = useSetAtom(workbenchListAtom);
  const navigate = useNavigate();
  const [registering, setRegistering] = useState(false);
  const [registered, setRegistered] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [openingWorkbench, setOpeningWorkbench] = useState(false);

  const result = state.result;
  if (!result) return null;

  async function openFolder() {
    try {
      const dir = result?.import_dir || result?.lgo_file;
      if (dir) {
        await invoke("plugin:opener|reveal_item_in_dir", { path: dir });
      }
    } catch {
      // Fallback - not critical
    }
  }

  async function registerCharacter() {
    if (!currentProject?.id || !state.modelId) return;

    setRegistering(true);
    try {
      const modelIdNum = parseInt(state.modelId);
      const name = state.characterName || `Imported_${state.modelId}`;
      const res = await registerImportedCharacter(
        currentProject.id,
        modelIdNum,
        name
      );
      setRegistered(true);
      toast({
        title: "Registered",
        description: `Character registered with ID ${res.character_id}`,
      });
    } catch (err) {
      toast({
        title: "Registration failed",
        description: String(err),
      });
    } finally {
      setRegistering(false);
    }
  }

  async function openInWorkbench() {
    if (!result?.lgo_file || !currentProject?.id || !state.modelId) return;

    setOpeningWorkbench(true);
    try {
      // Create workbench entry
      await createWorkbench(
        currentProject.id,
        state.modelId,
        state.characterName || `Imported_${state.modelId}`,
        0,
        state.filePath || null,
        state.scaleFactor || 1.0,
        result.lgo_file
      );

      // Load the workbench state and glTF preview
      const wbState = await loadWorkbench(currentProject.id, state.modelId);
      const gltfJson = await loadModelPreview(result.lgo_file, wbState.hasGlowOverlay);

      // Refresh workbench list
      const wbList = await listWorkbenches(currentProject.id);
      setWorkbenchList(wbList);

      // Switch to workbench mode
      setSelectedItem(null);
      setItemMetadata(null);
      setItemLitInfo(null);
      setItemGltfJson(gltfJson);
      setActiveWorkbench(wbState);
      setIsWorkbenchMode(true);
      resetWizard();
      navigate("/items");
    } catch (err) {
      toast({
        title: "Failed to open workbench",
        description: String(err),
      });
    } finally {
      setOpeningWorkbench(false);
    }
  }

  async function viewModel() {
    if (!result?.lgo_file) return;

    setLoadingPreview(true);
    try {
      const gltfJson = await loadModelPreview(result.lgo_file);

      if (state.importType === "item") {
        setSelectedItem(null);
        setItemMetadata(null);
        setItemLitInfo(null);
        setItemGltfJson(gltfJson);
        resetWizard();
        navigate("/items");
      } else {
        setCharacterGltfJson(gltfJson);
        resetWizard();
        navigate("/characters");
      }
    } catch (err) {
      toast({
        title: "Preview failed",
        description: String(err),
      });
    } finally {
      setLoadingPreview(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-green-400">
        <Check className="h-5 w-5" />
        <span className="font-medium">Import complete</span>
      </div>

      <div className="space-y-2 text-sm">
        <p className="text-muted-foreground">Files created:</p>
        <div className="p-2 rounded bg-muted/50 text-xs font-mono break-all">
          {result.lgo_file}
        </div>
        {result.texture_files.length > 0 && (
          <div className="space-y-1">
            {result.texture_files.map((f, i) => (
              <div
                key={i}
                className="p-1.5 rounded bg-muted/30 text-xs font-mono break-all"
              >
                {f}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex gap-2 flex-wrap">
        <Button
          variant="outline"
          size="sm"
          onClick={viewModel}
          disabled={loadingPreview}
        >
          {loadingPreview ? (
            <Loader2 className="h-4 w-4 mr-1 animate-spin" />
          ) : (
            <Eye className="h-4 w-4 mr-1" />
          )}
          {loadingPreview ? "Loading..." : "View Model"}
        </Button>

        {state.importType === "item" && (
          <Button
            variant="outline"
            size="sm"
            onClick={openInWorkbench}
            disabled={openingWorkbench}
          >
            {openingWorkbench ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <Wrench className="h-4 w-4 mr-1" />
            )}
            {openingWorkbench ? "Opening..." : "Open in Workbench"}
          </Button>
        )}

        {result.import_dir && (
          <Button variant="outline" size="sm" onClick={openFolder}>
            <FolderOpen className="h-4 w-4 mr-1" />
            Open Folder
          </Button>
        )}

        {state.importType === "character" && !registered && (
          <Button
            variant="outline"
            size="sm"
            onClick={registerCharacter}
            disabled={registering}
          >
            <UserPlus className="h-4 w-4 mr-1" />
            {registering ? "Registering..." : "Register in CharacterInfo.txt"}
          </Button>
        )}

        {registered && (
          <span className="text-xs text-green-400 flex items-center gap-1">
            <Check className="h-3 w-3" /> Registered
          </span>
        )}
      </div>

      <Button variant="ghost" size="sm" onClick={resetWizard}>
        Import Another
      </Button>
    </div>
  );
}
