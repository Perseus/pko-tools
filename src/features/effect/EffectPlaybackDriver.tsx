import {
  effectDataAtom,
  effectPlaybackAtom,
} from "@/store/effect";
import { useFrame } from "@react-three/fiber";
import { useAtom } from "jotai";
import { useMemo } from "react";

const DEFAULT_FRAME_DURATION = 1 / 30;

export default function EffectPlaybackDriver() {
  const [effectData] = useAtom(effectDataAtom);
  const [playback, setPlayback] = useAtom(effectPlaybackAtom);

  // Compute total duration as the MAX across all sub-effects (PKO plays them all simultaneously)
  const totalDuration = useMemo(() => {
    if (!effectData || effectData.subEffects.length === 0) {
      return 0;
    }

    let maxDuration = 0;
    for (const subEffect of effectData.subEffects) {
      const durations = subEffect.frameTimes.length
        ? subEffect.frameTimes.map((time) => Math.max(time, DEFAULT_FRAME_DURATION))
        : Array.from({ length: subEffect.frameCount }, () => DEFAULT_FRAME_DURATION);
      const subTotal = durations.reduce((sum, value) => sum + value, 0);
      if (subTotal > maxDuration) {
        maxDuration = subTotal;
      }
    }

    return maxDuration;
  }, [effectData]);

  useFrame((_state, delta) => {
    if (!playback.isPlaying || totalDuration === 0) {
      return;
    }

    const scaledDelta = delta * playback.speed;
    let nextTime = playback.currentTime + scaledDelta;

    if (nextTime >= totalDuration) {
      if (playback.isLooping) {
        nextTime = nextTime % totalDuration;
      } else {
        nextTime = totalDuration;
      }
    }

    setPlayback((prev) => ({
      ...prev,
      currentTime: nextTime,
      isPlaying: prev.isPlaying && (prev.isLooping || nextTime < totalDuration),
    }));
  });

  return null;
}
