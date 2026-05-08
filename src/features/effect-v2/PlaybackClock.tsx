import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useAtom } from "jotai";
import { effectV2PlaybackAtom } from "@/store/effect-v2";
import { effectV2RuntimeClock, syncEffectV2RuntimeClock } from "./TimeContext";

const UI_TIME_SYNC_INTERVAL = 0.1;

/**
 * Runs inside the Canvas. Advances the shared playback time each frame
 * when playing. Supports fixed framerate stepping via playback.fps.
 */
export function PlaybackClock() {
  const [playback, setPlayback] = useAtom(effectV2PlaybackAtom);
  const accumulator = useRef(0);
  const uiAccumulator = useRef(0);
  const lastPublishedTime = useRef(playback.time);

  if (!playback.playing && effectV2RuntimeClock.time !== playback.time) {
    syncEffectV2RuntimeClock(playback.time);
    accumulator.current = 0;
    uiAccumulator.current = 0;
    lastPublishedTime.current = playback.time;
  } else if (
    playback.playing
    && Math.abs(playback.time - lastPublishedTime.current) > 0.000001
  ) {
    syncEffectV2RuntimeClock(playback.time);
    accumulator.current = 0;
    uiAccumulator.current = 0;
    lastPublishedTime.current = playback.time;
  }

  useFrame((_, delta) => {
    if (!playback.playing) return;

    if (playback.fps <= 0) {
      // Uncapped — advance by real delta
      effectV2RuntimeClock.time += delta;
    } else {
      // Fixed framerate stepping
      const frameTime = 1 / playback.fps;
      accumulator.current += delta;

      if (accumulator.current >= frameTime) {
        const steps = Math.floor(accumulator.current / frameTime);
        accumulator.current -= steps * frameTime;
        effectV2RuntimeClock.time += steps * frameTime;
      }
    }

    uiAccumulator.current += delta;
    if (uiAccumulator.current >= UI_TIME_SYNC_INTERVAL) {
      uiAccumulator.current = 0;
      const time = effectV2RuntimeClock.time;
      lastPublishedTime.current = time;
      setPlayback((prev) => prev.time === time ? prev : { ...prev, time });
    }
  });

  return null;
}
