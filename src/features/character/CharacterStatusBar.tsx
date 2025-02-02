import { useAtomValue } from "jotai";
import { Progress } from "@/components/ui/progress";
import { characterLoadingStatusAtom } from "@/store/character";
import { useEffect, useState } from "react";

export default function CharacterStatusBar() {
  const characterLoadingStatus = useAtomValue(characterLoadingStatusAtom);
  const [loadingProgress, setLoadingProgress] = useState(0);


  useEffect(() => {
    if (characterLoadingStatus) {
      setLoadingProgress((characterLoadingStatus.subActionCurrentStep / characterLoadingStatus.subActionTotalSteps) * 100);
    }
  }, [characterLoadingStatus]);

  return (
    <>
      <div className="grid grid-cols-3 gap-1">
        <div></div>
        {characterLoadingStatus && (
          <div className="flex flex-col justify-center items-center gap-1">
            { characterLoadingStatus.action }
            {characterLoadingStatus.subActionCurrentStep < characterLoadingStatus.subActionTotalSteps && (
              <span className="text-xs">{characterLoadingStatus.action } - {characterLoadingStatus.subAction}</span>
            )}
            <Progress
              value={loadingProgress}
              className="h-4"
            ></Progress>
          </div>
        )}
      </div>
    </>
  );
}
