import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { ParSystem } from "@/types/effect-v2";
import { useTimeSource } from "../../TimeContext";
import {
  advanceEffPathRuntimeState,
  createEffPathRuntimeState,
} from "./rangeKinematics";

export function useParticleSystemPathOffset(system: ParSystem): (dt: number) => THREE.Vector3 | null {
  const timeSource = useTimeSource();
  const pathStateRef = useRef(createEffPathRuntimeState(system.path));
  const lastTimeRef = useRef(0);

  useEffect(() => {
    pathStateRef.current = createEffPathRuntimeState(system.path);
    lastTimeRef.current = timeSource.getTime();
  }, [system.path, system.usePath, timeSource]);

  return (dt: number) => {
    if (!system.usePath) return null;

    const currentTime = timeSource.getTime();
    if (currentTime < lastTimeRef.current) {
      pathStateRef.current = createEffPathRuntimeState(system.path);
    }
    lastTimeRef.current = currentTime;

    advanceEffPathRuntimeState(pathStateRef.current, system.path, dt);
    return pathStateRef.current.curPos;
  };
}
