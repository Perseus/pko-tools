import { useAtom } from "jotai";
import { importWizardStateAtom } from "@/store/import";
import { ValidationReportPanel } from "../ValidationReport";
import { MeshAnalysisPanel } from "../MeshAnalysis";
import { Loader2 } from "lucide-react";
import { useEffect } from "react";
import { analyzeMesh, validateModelForImport } from "@/commands/import";

export function PreviewStep() {
  const [state, setState] = useAtom(importWizardStateAtom);

  useEffect(() => {
    if (!state.filePath) return;

    let cancelled = false;

    async function loadAnalysis() {
      if (!state.filePath) return;

      setState((prev) => ({ ...prev, isProcessing: true, error: null }));

      try {
        const [meshReport, validationReport] = await Promise.all([
          analyzeMesh(state.filePath),
          validateModelForImport(state.filePath, state.importType),
        ]);

        if (!cancelled) {
          setState((prev) => ({
            ...prev,
            meshAnalysis: meshReport,
            validationReport: validationReport,
            isProcessing: false,
          }));
        }
      } catch (err) {
        if (!cancelled) {
          setState((prev) => ({
            ...prev,
            error: String(err),
            isProcessing: false,
          }));
        }
      }
    }

    loadAnalysis();

    return () => {
      cancelled = true;
    };
  }, [state.filePath, state.importType]);

  if (state.isProcessing) {
    return (
      <div className="flex flex-col items-center justify-center py-8 gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Analyzing model...</p>
      </div>
    );
  }

  if (state.error) {
    return (
      <div className="p-4 rounded bg-red-950/30 text-red-400 text-sm">
        <p className="font-medium">Analysis failed</p>
        <p className="mt-1 text-xs">{state.error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-medium mb-2">Mesh Statistics</h3>
        <MeshAnalysisPanel report={state.meshAnalysis} />
      </div>

      <div>
        <h3 className="text-sm font-medium mb-2">Validation</h3>
        <ValidationReportPanel report={state.validationReport} />
      </div>
    </div>
  );
}
