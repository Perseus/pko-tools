import { SubEffect, EffectFile } from "@/types/effect";
import { MagicSingleEntry } from "@/types/effect-v2";

export const baseSubEffect: SubEffect = {
  effectName: "TestEffect",
  effectType: 0,
  srcBlend: 5,
  destBlend: 2,
  length: 1,
  frameCount: 2,
  frameTimes: [0, 0.5],
  frameSizes: [
    [1, 1, 1],
    [2, 2, 2],
  ],
  frameAngles: [
    [0, 0, 0],
    [0, 0, 0],
  ],
  framePositions: [
    [0, 0, 0],
    [3, 0, 2],
  ],
  frameColors: [
    [1, 1, 1, 1],
    [1, 0, 0, 0.5],
  ],
  verCount: 4,
  coordCount: 0,
  coordFrameTime: 0,
  coordList: [],
  texCount: 1,
  texFrameTime: 0,
  texName: "spark.tga",
  texList: [
    [[0, 0], [1, 0], [1, 1], [0, 1]],
  ],
  modelName: "RectPlane",
  billboard: true,
  vsIndex: 0,
  segments: 0,
  height: 0,
  topRadius: 0,
  botRadius: 0,
  frameTexCount: 0,
  frameTexTime: 0,
  frameTexNames: [],
  frameTexTime2: 0,
  useParam: 0,
  perFrameCylinder: [],
  rotaLoop: false,
  rotaLoopVec: [0, 0, 0, 0],
  alpha: false,
  rotaBoard: false,
};

export const rotatingSubEffect: SubEffect = {
  ...baseSubEffect,
  rotaLoop: true,
  rotaLoopVec: [0, 1, 0, 2], // Y-axis, 2 rad/s
  billboard: false,
};

export const effectFixture: EffectFile = {
  version: 7,
  idxTech: 0,
  usePath: false,
  pathName: "",
  useSound: false,
  soundName: "",
  rotating: false,
  rotaVec: [0, 0, 0],
  rotaVel: 0,
  effNum: 1,
  subEffects: [baseSubEffect],
};

export const magicEntryFixture: MagicSingleEntry = {
  id: 10,
  data_name: "Test Effect",
  name: "Test Effect",
  models: ["test.eff"],
  velocity: 10,
  particles: [],
  dummies: [-1, -1, -1, -1, -1, -1, -1, -1],
  render_idx: 2, // trace
  lightId: 0,
  result_effect: "0",
};
