import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import CharacterActions from "@/features/character/CharacterActions";
import CharacterWorkbench from "@/features/character/CharacterWorkbench";
import { currentProjectAtom } from "@/store/project";
import { useAtomValue } from "jotai";
import { AlertCircle } from "lucide-react";

export default function CharacterPage() {
  const currentProject = useAtomValue(currentProjectAtom);
  if (!currentProject) {
    return (
      <div className="flex justify-center items-center h-full w-full">
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
    <main className="h-full w-full">
        <CharacterWorkbench/>
    </main>
  );
}
