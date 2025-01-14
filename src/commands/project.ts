import { Project } from "@/types/project";
import { invoke } from "@tauri-apps/api/core";

export const getProjectList = async (): Promise<Project[]> => {
  return invoke("get_projects_list");
};

export const getCurrentProject = async (): Promise<Project> => {
  return invoke("get_current_project");
};



export const createProject = async (
  projectName: string,
  projectDirectory: string
): Promise<string> => {
  const projectId = (await invoke("create_project", {
    projectName,
    projectDirectory,
  })) as string;

  return projectId;
};
