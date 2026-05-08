import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import ForgeGlowWorkbench from "@/features/forge-glow/ForgeGlowWorkbench";
import { currentProjectAtom } from "@/store/project";
import { useAtomValue } from "jotai";
import { AlertCircle } from "lucide-react";

export default function ForgeGlowsPage() {
  const currentProject = useAtomValue(currentProjectAtom);
  if (!currentProject) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <Alert variant="destructive" className="max-w-96">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>
            No project selected. Please select a project from the sidebar.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <main className="h-full w-full min-w-0">
      <ForgeGlowWorkbench />
    </main>
  );
}
