import {
  effectDataAtom,
  effectPlaybackAtom,
} from "@/store/effect";
import { particleDataAtom } from "@/store/particle";
import { useFrame } from "@react-three/fiber";
import { useAtom } from "jotai";
import { useMemo } from "react";

const DEFAULT_FRAME_DURATION = 1 / 30;

export default function EffectPlaybackDriver() {
  const [effectData] = useAtom(effectDataAtom);
  const [playback, setPlayback] = useAtom(effectPlaybackAtom);
  const [particleData] = useAtom(particleDataAtom);

  // Compute total duration as the MAX across all sub-effects, particle systems, and .par length.
  // PKO plays sub-effects, particles, and strips simultaneously — the composite duration
  // is the longest of all sub-components.
  const totalDuration = useMemo(() => {
    let maxDuration = 0;

    // Sub-effect durations from .eff
    if (effectData && effectData.subEffects.length > 0) {
      for (const subEffect of effectData.subEffects) {
        const durations = subEffect.frameTimes.length
          ? subEffect.frameTimes.map((time) => Math.max(time, DEFAULT_FRAME_DURATION))
          : Array.from({ length: subEffect.frameCount }, () => DEFAULT_FRAME_DURATION);
        const subTotal = durations.reduce((sum, value) => sum + value, 0);
        if (subTotal > maxDuration) {
          maxDuration = subTotal;
        }
      }
    }

    // Particle controller total length from .par
    if (particleData && particleData.length > 0) {
      // The .par `length` field is the controller's declared duration.
      // Also consider individual system durations (delayTime + playTime).
      let parDuration = particleData.length;
      for (const sys of particleData.systems) {
        const sysDuration = sys.delayTime + (sys.playTime > 0 ? sys.playTime : sys.life * 3);
        if (sysDuration > parDuration) parDuration = sysDuration;
      }
      if (parDuration > maxDuration) maxDuration = parDuration;
    }

    return maxDuration;
  }, [effectData, particleData]);

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
