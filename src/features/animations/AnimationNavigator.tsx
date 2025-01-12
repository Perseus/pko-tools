import { getAnimationFiles } from "@/commands/project";
import { currentProjectAtom } from "@/store/project";
import { useAtom, useAtomValue } from "jotai";
import { useVirtualizer } from "@tanstack/react-virtual";
import React, { useEffect, useState } from "react";
import { ScrollAreaVirtualizable } from "@/components/ui/scroll-area-virtualizable";
import { SidebarContent, SidebarHeader } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import {
  currentActionProgressAtom,
  currentActionStatusAtom,
  currentAnimationActionAtom,
  selectedAnimationAtom,
} from "@/store/animation";
import { Channel, invoke } from "@tauri-apps/api/core";

export default function AnimationNavigator() {
  const [animationFiles, setAnimationFiles] = useState<string[]>([]);
  const currentProject = useAtomValue(currentProjectAtom);
  const [, setSelectedAnimationFile] = useAtom(selectedAnimationAtom);
  const [, setCurrentAnimationAction] = useAtom(currentAnimationActionAtom);
  const [, setCurrentActionProgress] = useAtom(currentActionProgressAtom);
  const [, setCurrentActionStatus] = useAtom(currentActionStatusAtom);

  useEffect(() => {
    async function fetchAnimationFiles() {
      if (currentProject) {
        const files = await getAnimationFiles(currentProject?.id);
        setAnimationFiles(files);
      }
    }

    fetchAnimationFiles();
  }, [currentProject]);

  const parentRef = React.useRef(null);
  const rowVirtualizer = useVirtualizer({
    count: animationFiles.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 40,
  });

  async function selectAnimationFile(animationFile: string) {
    if (!selectAnimationFile) {
      return;
    }

    console.log("Selected animation file:", animationFile, currentProject);

    setSelectedAnimationFile(animationFile);
    setCurrentAnimationAction("load-animation");
    const onEvent = new Channel<[string, number]>();
    onEvent.onmessage = (message: [string, number]) => {
      const [status, progress] = message;

      setCurrentActionStatus(status);
      setCurrentActionProgress(progress);
    };
    await invoke("load_animation", {
      location: `${currentProject?.projectDirectory}/animation/${animationFile}`,
      onEvent,
    });
  }

  return (
    <>
      <SidebarHeader>
        <SidebarContent>
          <span className="text-md font-semibold">Animations</span>
        </SidebarContent>
      </SidebarHeader>
      <ScrollAreaVirtualizable
        className="h-96 w-full border overflow-auto"
        ref={parentRef}
      >
        <div
          style={{
            height: `${rowVirtualizer.getTotalSize()}px`,
            width: `100%`,
            position: "relative",
          }}
        >
          {rowVirtualizer.getVirtualItems().map((virtualRow) => (
            <div
              key={virtualRow.index}
              style={{
                position: "absolute",
                top: virtualRow.start,
                left: 0,
                width: "100%",
                height: virtualRow.size,
              }}
            >
              <Button
                className="text-sm"
                variant="link"
                onClick={() =>
                  selectAnimationFile(animationFiles[virtualRow.index])
                }
              >
                {animationFiles[virtualRow.index]}
              </Button>
            </div>
          ))}
        </div>
      </ScrollAreaVirtualizable>
    </>
  );
}
