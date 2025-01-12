import {
  currentActionProgressAtom,
  currentActionStatusAtom,
  currentAnimationActionAtom,
  selectedAnimationAtom,
} from "@/store/animation";
import { useAtomValue } from "jotai";
import { Progress } from "@/components/ui/progress";

export default function AnimationStatusBar() {
  const selectedAnimation = useAtomValue(selectedAnimationAtom);
  const animationActionStatus = useAtomValue(currentActionStatusAtom);
  const animationActionProgress = useAtomValue(currentActionProgressAtom);

  const currentAction = useAtomValue(currentAnimationActionAtom);

  return (
    <>
      <div className="grid grid-cols-3 gap-1">
        {selectedAnimation && (
          <div> Selected animation: {selectedAnimation} </div>
        )}
        {currentAction === "load-animation" && (
          <div className="flex flex-col">
            {animationActionProgress < 100 && (
              <span className="text-xs">{animationActionStatus}</span>
            )}
            <Progress
              value={animationActionProgress}
              className="h-4"
            ></Progress>
          </div>
        )}
      </div>
    </>
  );
}
