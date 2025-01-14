import { currentProjectAtom } from "@/store/project";
import { useAtom, useAtomValue } from "jotai";
import { useVirtualizer, Virtualizer } from "@tanstack/react-virtual";
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
import { Character } from "@/types/character";
import { getCharacterList } from "@/commands/character";
import { selectedCharacterAtom } from "@/store/character";
import { Input } from "@/components/ui/input";
import { Label } from "@radix-ui/react-dropdown-menu";

export default function AnimationNavigator() {
  const [characters, setCharacters] = useState<Character[]>([]);
  const [filteredCharacters, setFilteredCharacters]  = useState<Character[]>([]);
  const [query, setQuery] = useState("");

  const currentProject = useAtomValue(currentProjectAtom);
  const [, setSelectedCharacter] = useAtom(selectedCharacterAtom);
  const [, setCurrentAnimationAction] = useAtom(currentAnimationActionAtom);
  const [, setCurrentActionProgress] = useAtom(currentActionProgressAtom);
  const [, setCurrentActionStatus] = useAtom(currentActionStatusAtom);

  useEffect(() => {
    async function fetchAnimationFiles() {
      if (currentProject) {
        const characters = await getCharacterList(currentProject?.id);
        setCharacters(characters);
      }
    }

    fetchAnimationFiles();
  }, [currentProject]);

  useEffect(() => {
    setFilteredCharacters(
      characters.filter((character) =>
        character.name.toLowerCase().includes(query.toLowerCase())
      )
    );
  }, [query, characters]);



  const parentRef = React.useRef(null);
  let rowVirtualizer: Virtualizer<Element, Element> = useVirtualizer({
    count: filteredCharacters.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 40,
  });

  async function selectCharacter(character: Character) {
    if (!character) {
      return;
    }

    console.log("Selected character: ", character);

    setSelectedCharacter(character);
    setCurrentAnimationAction("load-animation");
    const onEvent = new Channel<[string, number]>();
    onEvent.onmessage = (message: [string, number]) => {
      const [status, progress] = message;

      setCurrentActionStatus(status);
      setCurrentActionProgress(progress);
    };
    // await invoke("load_animation", {
    //   location: `${currentProject?.projectDirectory}/animation/${characterId}`,
    //   onEvent,
    // });
  }

  return (
    <>
      <SidebarHeader>
        <SidebarContent>
          <span className="text-md font-semibold">Characters</span>
          <Label className="text-xs"> Search </Label>  
          <Input id="search" value={query} onChange={(e) => setQuery(e.target.value)} />
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
                  selectCharacter(characters[virtualRow.index])
                }
              >
                {filteredCharacters[virtualRow.index].id}: {filteredCharacters[virtualRow.index].name}
              </Button>
            </div>
          ))}
        </div>
      </ScrollAreaVirtualizable>
    </>
  );
}
