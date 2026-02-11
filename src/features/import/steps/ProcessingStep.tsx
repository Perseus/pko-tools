import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { useAtom } from "jotai";
import { importWizardStateAtom } from "@/store/import";
import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { importItemFromGltf } from "@/commands/item";

export function ProcessingStep() {
  const [state, setState] = useAtom(importWizardStateAtom);
  const [progress, setProgress] = useState(0);
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current || !state.filePath || !state.modelId) return;
    startedRef.current = true;

    async function runImport() {
      setState((prev) => ({ ...prev, isProcessing: true, error: null }));
      setProgress(10);

      try {
        if (state.importType === "item") {
          setProgress(30);
          const result = await importItemFromGltf(state.modelId, state.filePath!, state.scaleFactor);
          setProgress(90);

          setState((prev) => ({
            ...prev,
            isProcessing: false,
            result: {
              lgo_file: result.lgo_file,
              texture_files: result.texture_files,
              import_dir: result.import_dir,
            },
            step: "result",
          }));
        } else {
          // Character import
          setProgress(20);
          const modelIdInt = parseInt(state.modelId);
          const response = await invoke<string>("import_character_from_gltf", {
            modelId: modelIdInt,
            filePath: state.filePath,
          });
          setProgress(90);

          setState((prev) => ({
            ...prev,
            isProcessing: false,
            result: {
              lgo_file: response,
              texture_files: [],
              import_dir: "",
            },
            step: "result",
          }));
        }
        setProgress(100);
      } catch (err) {
        setState((prev) => ({
          ...prev,
          isProcessing: false,
          error: String(err),
        }));
      }
    }

    runImport();

    // No cleanup — import has side effects (creates files) and should
    // always apply its result. The startedRef guard prevents double-runs.
  }, []);

  if (state.error) {
    return (
      <div className="space-y-4">
        <div className="p-4 rounded bg-red-950/30 text-red-400 text-sm">
          <p className="font-medium">Import failed</p>
          <p className="mt-1 text-xs break-all">{state.error}</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            startedRef.current = false;
            setState((prev) => ({ ...prev, error: null }));
          }}
        >
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center py-8 gap-4">
      <Loader2 className="h-10 w-10 animate-spin text-muted-foreground" />
      <p className="text-sm text-muted-foreground">
        Importing {state.importType}...
      </p>
      <Progress value={progress} className="w-full max-w-xs" />
      <p className="text-xs text-muted-foreground">
        Converting textures, generating bounding spheres, writing files...
      </p>
    </div>
  );
}
