import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import {
  importWizardOpenAtom,
  importWizardStateAtom,
  resetImportWizardAtom,
  canGoNextAtom,
  canGoPrevAtom,
} from "@/store/import";
import { IMPORT_STEPS, type ImportWizardStep } from "@/types/import";
import { FileSelection } from "./steps/FileSelection";
import { PreviewStep } from "./steps/PreviewStep";
import { ConfigurationStep } from "./steps/ConfigurationStep";
import { ProcessingStep } from "./steps/ProcessingStep";
import { ResultStep } from "./steps/ResultStep";
import { ChevronLeft, ChevronRight } from "lucide-react";

const STEP_TITLES: Record<ImportWizardStep, string> = {
  "file-selection": "Select Model",
  preview: "Preview & Validate",
  configuration: "Configure",
  processing: "Importing",
  result: "Complete",
};

function StepContent({ step }: { step: ImportWizardStep }) {
  switch (step) {
    case "file-selection":
      return <FileSelection />;
    case "preview":
      return <PreviewStep />;
    case "configuration":
      return <ConfigurationStep />;
    case "processing":
      return <ProcessingStep />;
    case "result":
      return <ResultStep />;
  }
}

export function ImportWizard() {
  const [open, setOpen] = useAtom(importWizardOpenAtom);
  const [state, setState] = useAtom(importWizardStateAtom);
  const resetWizard = useSetAtom(resetImportWizardAtom);
  const canNext = useAtomValue(canGoNextAtom);
  const canPrev = useAtomValue(canGoPrevAtom);

  const currentIdx = IMPORT_STEPS.indexOf(state.step);
  const isLastConfigStep = state.step === "configuration";
  const showNav = state.step !== "processing" && state.step !== "result";

  function handleOpenChange(newOpen: boolean) {
    if (!newOpen) {
      resetWizard();
    } else {
      setOpen(true);
    }
  }

  function goNext() {
    if (!canNext) return;
    const nextIdx = currentIdx + 1;
    if (nextIdx < IMPORT_STEPS.length) {
      setState((prev) => ({ ...prev, step: IMPORT_STEPS[nextIdx] }));
    }
  }

  function goPrev() {
    if (!canPrev) return;
    const prevIdx = currentIdx - 1;
    if (prevIdx >= 0) {
      setState((prev) => ({ ...prev, step: IMPORT_STEPS[prevIdx] }));
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Import External Model
            <span className="text-xs font-normal text-muted-foreground">
              Step {currentIdx + 1} of {IMPORT_STEPS.length}
            </span>
          </DialogTitle>
          {/* Step indicator */}
          <div className="flex gap-1 mt-2">
            {IMPORT_STEPS.map((step, i) => (
              <div
                key={step}
                className={`h-1 flex-1 rounded-full ${
                  i <= currentIdx ? "bg-primary" : "bg-muted"
                }`}
              />
            ))}
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            {STEP_TITLES[state.step]}
          </p>
        </DialogHeader>

        <div className="min-h-[200px] py-2">
          <StepContent step={state.step} />
        </div>

        {showNav && (
          <div className="flex justify-between pt-2 border-t">
            <Button
              variant="ghost"
              size="sm"
              onClick={goPrev}
              disabled={!canPrev}
            >
              <ChevronLeft className="h-4 w-4 mr-1" />
              Back
            </Button>
            <Button
              size="sm"
              onClick={goNext}
              disabled={!canNext}
            >
              {isLastConfigStep ? "Import" : "Next"}
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
