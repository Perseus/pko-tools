import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { createProject } from "@/commands/project";
import { useToast } from "@/hooks/use-toast";
import { useNavigate } from "react-router";

export default function ProjectCreator() {
  const [projectName, setProjectName] = useState("");
  const [clientFolder, setClientFolder] = useState("");
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const { toast } = useToast();
  const navigate = useNavigate();

  async function openClientFolderPicker() {
    const folder = await open({
      multiple: false,
      directory: true,
    });

    if (folder) {
      setClientFolder(folder);
    }
  }

  async function triggerCreateProject() {
    const projectId = await createProject(projectName, clientFolder);
    if (projectId) {
      setClientFolder("");
      setProjectName("");

      setIsCreatingProject(false);
      toast({
        title: "Project created",
        description: "The project has been created successfully",
        variant: "default",
      });
      navigate("/");
    }
  }

  return (
    <Dialog defaultOpen={true} modal={true}>
      <DialogContent
        onFocusOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Create a project</DialogTitle>
          <DialogDescription>
            Projects are workspaces that are scoped to a specific game client.{" "}
            <br />
            <br />
            Pick a name and the client folder for the project
          </DialogDescription>
        </DialogHeader>

        <div className="grid w-full max-w-sm items-center gap-1.5">
          <div>
            <Label htmlFor="project-name">Project name</Label>
            <Input
              type="text"
              id="project-name"
              placeholder="eg. PKO 1.2"
              required
              onChange={(e) => setProjectName(e.target.value)}
            />
          </div>

          <div className="mt-3">
            <Input
              type="text"
              className="mb-2"
              disabled
              value={clientFolder}
              placeholder="eg. C:/GameClient"
            />
            <Button
              onClick={openClientFolderPicker}
              type="button"
              variant="secondary"
            >
              Pick a client folder
            </Button>
          </div>

          <div className="mt-3">
            <Button
              onClick={triggerCreateProject}
              type="button"
              variant="default"
              disabled={isCreatingProject}
            >
              {isCreatingProject ? (
                <>Creating project...</>
              ) : (
                <>Create project</>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
