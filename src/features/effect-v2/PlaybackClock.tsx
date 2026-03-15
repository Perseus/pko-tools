import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useAtom } from "jotai";
import { effectV2PlaybackAtom } from "@/store/effect-v2";

/**
 * Runs inside the Canvas. Advances the shared playback time each frame
 * when playing. Supports fixed framerate stepping via playback.fps.
 */
export function PlaybackClock() {
  const [playback, setPlayback] = useAtom(effectV2PlaybackAtom);
  const accumulator = useRef(0);

  useFrame((_, delta) => {
    if (!playback.playing) return;

    if (playback.fps <= 0) {
      // Uncapped — advance by real delta
      setPlayback((prev) => ({ ...prev, time: prev.time + delta }));
    } else {
      // Fixed framerate stepping
      const frameTime = 1 / playback.fps;
      accumulator.current += delta;

      if (accumulator.current >= frameTime) {
        const steps = Math.floor(accumulator.current / frameTime);
        accumulator.current -= steps * frameTime;
        setPlayback((prev) => ({ ...prev, time: prev.time + steps * frameTime }));
      }
    }
  });

  return null;
}
