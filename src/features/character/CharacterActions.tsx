import { Button } from "@/components/ui/button";
import { selectedCharacterAtom } from "@/store/character";
import { useAtomValue } from "jotai";

export default function CharacterActions() {
  const selectedCharacter = useAtomValue(selectedCharacterAtom);

  return <div className="flex mt-4">
    {selectedCharacter && (
      <div>
        <div className="text-sm mb-4">
          Selected character: <strong> {selectedCharacter.name} </strong>
        </div>
        <Button variant="default">
          Export to glTF
        </Button>
      </div>
    )}
  </div>;
}
