import { recordFrame, type PerfSurface } from "@/features/perf/metrics";
import { useFrame } from "@react-three/fiber";

export function PerfFrameProbe({ surface }: { surface: PerfSurface }) {
  useFrame((_state, delta) => {
    recordFrame(surface, delta * 1000);
  });

  return null;
}
