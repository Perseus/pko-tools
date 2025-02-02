import { currentProjectAtom } from "@/store/project";
import { useAtom, useAtomValue } from "jotai";
import { useVirtualizer, Virtualizer } from "@tanstack/react-virtual";
import React, { useEffect, useState } from "react";
import { ScrollAreaVirtualizable } from "@/components/ui/scroll-area-virtualizable";
import { SidebarContent, SidebarHeader } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Channel, invoke } from "@tauri-apps/api/core";
import { Character } from "@/types/character";
import { getCharacterList } from "@/commands/character";
import { characterGltfJsonAtom, characterLoadingStatusAtom, selectedCharacterAtom } from "@/store/character";
import { Input } from "@/components/ui/input";
import { Label } from "@radix-ui/react-dropdown-menu";
import { listen } from '@tauri-apps/api/event';
import CharacterActions from "./CharacterActions";

export default function CharacterNavigator() {
  const [characters, setCharacters] = useState<Character[]>([]);
  const [filteredCharacters, setFilteredCharacters] = useState<Character[]>([]);
  const [, setCharacterGltfJson] = useAtom(characterGltfJsonAtom);
  const [query, setQuery] = useState("");

  const currentProject = useAtomValue(currentProjectAtom);
  const [, setSelectedCharacter] = useAtom(selectedCharacterAtom);
  const [, setCharacterLoadingStatus] = useAtom(characterLoadingStatusAtom);
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


    setSelectedCharacter(character);
    listen<{ ModelLoadingUpdate: (string | number)[] }>("load_character_update", (event) => {
      const modelLoadingUpdate = event.payload.ModelLoadingUpdate;
      setCharacterLoadingStatus({
        action: modelLoadingUpdate[0] as string,
        subAction: modelLoadingUpdate[1] as string,
        subActionCurrentStep: modelLoadingUpdate[2] as number,
        subActionTotalSteps: modelLoadingUpdate[3] as number,
      });
    });
    const character_gltf_json = await invoke<string>("load_character", {
      projectId: currentProject?.id,
      characterId: character.id,
    });

    setCharacterGltfJson(character_gltf_json);
  }

  return (
    <>
      <SidebarHeader>
        <SidebarContent>
          <span className="text-md font-semibold">Characters</span>
          <Label className="text-xs"> Search </Label>
          <Input id="search" value={query} onChange={(e) => setQuery(e.target.value)} />
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
                      selectCharacter(filteredCharacters[virtualRow.index])
                    }
                  >
                    {filteredCharacters[virtualRow.index].id}: {filteredCharacters[virtualRow.index].name}
                  </Button>
                </div>
              ))}
            </div>
          </ScrollAreaVirtualizable>

          <CharacterActions />
        </SidebarContent>
      </SidebarHeader>
    </>
  );
}
