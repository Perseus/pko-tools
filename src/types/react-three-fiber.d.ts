import * as React from "react";

declare module "@react-three/fiber" {
  export const Canvas: React.FC<any>;
  export const useFrame: (callback: (state: any, delta: number) => void) => void;
  export type ThreeElements = Record<string, any>;
}

declare module "@react-three/drei" {
  export const OrbitControls: React.FC<any>;
}
