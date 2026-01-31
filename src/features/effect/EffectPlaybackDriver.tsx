import {
  effectDataAtom,
  effectPlaybackAtom,
  selectedFrameIndexAtom,
  selectedSubEffectIndexAtom,
} from "@/store/effect";
import { useFrame } from "@react-three/fiber";
import { useAtom } from "jotai";
import { useMemo } from "react";

const DEFAULT_FRAME_DURATION = 1 / 30;

export default function EffectPlaybackDriver() {
  const [effectData] = useAtom(effectDataAtom);
  const [playback, setPlayback] = useAtom(effectPlaybackAtom);
  const [selectedSubEffectIndex] = useAtom(selectedSubEffectIndexAtom);
  const [, setSelectedFrame] = useAtom(selectedFrameIndexAtom);

  const { frameDurations, totalDuration } = useMemo(() => {
    if (!effectData || selectedSubEffectIndex === null) {
      return { frameDurations: [], totalDuration: 0 };
    }

    const subEffect = effectData.subEffects[selectedSubEffectIndex];
    if (!subEffect) {
      return { frameDurations: [], totalDuration: 0 };
    }

    const durations = subEffect.frameTimes.length
      ? subEffect.frameTimes.map((time) => Math.max(time, DEFAULT_FRAME_DURATION))
      : Array.from({ length: subEffect.frameCount }, () => DEFAULT_FRAME_DURATION);

    const total = durations.reduce((sum, value) => sum + value, 0);
    return { frameDurations: durations, totalDuration: total };
  }, [effectData, selectedSubEffectIndex]);

  useFrame((_state, delta) => {
    if (!playback.isPlaying || frameDurations.length === 0 || totalDuration === 0) {
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

    let accumulator = 0;
    let frameIndex = frameDurations.length - 1;
    for (let i = 0; i < frameDurations.length; i += 1) {
      accumulator += frameDurations[i];
      if (nextTime <= accumulator) {
        frameIndex = i;
        break;
      }
    }

    setSelectedFrame(frameIndex);
    setPlayback((prev) => ({
      ...prev,
      currentTime: nextTime,
      isPlaying: prev.isPlaying && (prev.isLooping || nextTime < totalDuration),
    }));
  });

  return null;
}
