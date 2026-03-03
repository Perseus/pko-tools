/**
 * Adapter: converts Rust ParFile (from load_par_file) → frontend ParticleController.
 *
 * The Rust ParFile has camelCase field names that differ slightly from the
 * frontend ParticleSystem interface. This adapter maps between the two.
 */
import type { ParticleController, ParticleSystem } from "@/types/particle";
import type { Vec4 } from "@/types/effect";
import type { StripEffectData } from "@/store/strip";

/** Shape of a single particle system as returned by the Rust ParFile serialization. */
interface RustParSystem {
  type: number;
  name: string;
  particleCount: number;
  textureName: string;
  modelName: string;
  range: [number, number, number];
  frameCount: number;
  frameSizes: number[];
  frameAngles: [number, number, number][];
  frameColors: [number, number, number, number][];
  billboard: boolean;
  srcBlend: number;
  destBlend: number;
  minFilter: number;
  magFilter: number;
  life: number;
  velocity: number;
  direction: [number, number, number];
  acceleration: [number, number, number];
  step: number;
  // v4+ renamed fields
  modelRangeFlag: boolean;
  modelRangeName: string;
  // v5+
  offset: [number, number, number];
  // v6+
  delayTime: number;
  playTime: number;
  // v9+
  usePath: boolean;
  path?: {
    velocity: number;
    points: [number, number, number][];
    directions: [number, number, number][];
    distances: number[];
  } | null;
  // v10+
  shade: boolean;
  // v11+
  hitEffect: string;
  // v12+
  pointRanges: [number, number, number][];
  // v13+
  randomMode: number;
  // v14+
  modelDir: boolean;
  // v15+
  mediaY: boolean;
}

/** Shape of a strip as returned by Rust ParFile serialization. */
interface RustParStrip {
  maxLen: number;
  dummy: [number, number];
  color: [number, number, number, number];
  life: number;
  step: number;
  textureName: string;
  srcBlend: number;
  destBlend: number;
}

/** Shape of a character model emitter from Rust ParFile. */
interface RustParChaModel {
  id: number;
  velocity: number;
  playType: number;
  curPose: number;
  srcBlend: number;
  destBlend: number;
  color: [number, number, number, number];
}

/** Shape of the full ParFile as returned by load_par_file Tauri command. */
export interface RustParFile {
  version: number;
  name: string;
  length: number;
  systems: RustParSystem[];
  strips: RustParStrip[];
  models: RustParChaModel[];
}

/** Convert a Rust ParSystem → frontend ParticleSystem. */
function adaptSystem(sys: RustParSystem): ParticleSystem {
  return {
    type: sys.type,
    name: sys.name,
    particleCount: sys.particleCount,
    textureName: sys.textureName,
    modelName: sys.modelName,
    range: sys.range,
    frameCount: sys.frameCount,
    frameSizes: sys.frameSizes,
    frameAngles: sys.frameAngles,
    frameColors: sys.frameColors,
    billboard: sys.billboard,
    srcBlend: sys.srcBlend,
    destBlend: sys.destBlend,
    minFilter: sys.minFilter,
    magFilter: sys.magFilter,
    life: sys.life,
    velocity: sys.velocity,
    direction: sys.direction,
    acceleration: sys.acceleration,
    step: sys.step,
    // Renamed fields: Rust uses modelRangeFlag/modelRangeName, TS uses modelRange/virtualModel
    modelRange: sys.modelRangeFlag,
    virtualModel: sys.modelRangeName,
    offset: sys.offset,
    delayTime: sys.delayTime,
    playTime: sys.playTime,
    usePath: sys.usePath,
    shade: sys.shade,
    hitEffect: sys.hitEffect,
    // Renamed: Rust pointRanges → TS pointRange
    pointRange: sys.pointRanges,
    // Renamed: Rust randomMode → TS random
    random: sys.randomMode,
    modelDir: sys.modelDir,
    mediaY: sys.mediaY,
  };
}

/** Convert a Rust ParFile → frontend ParticleController. */
export function adaptParFile(parFile: RustParFile): ParticleController {
  return {
    name: parFile.name,
    systems: parFile.systems.map(adaptSystem),
    length: parFile.length,
  };
}

/** Convert Rust ParStrip[] → frontend StripEffectData[]. */
export function adaptStrips(strips: RustParStrip[]): StripEffectData[] {
  return strips.map((strip) => ({
    maxLen: strip.maxLen,
    dummy: strip.dummy,
    color: strip.color as Vec4,
    life: strip.life,
    step: strip.step,
    texName: strip.textureName,
    srcBlend: strip.srcBlend,
    destBlend: strip.destBlend,
  }));
}

/** Extract the .par filename from an .eff filename.
 *  "01000005(0).eff" → "01000005.par"
 *  "fire_01.eff" → "fire_01.par"
 */
export function deriveParName(effName: string): string {
  // Strip .eff extension
  let base = effName.replace(/\.eff$/i, "");
  // Strip parenthetical suffix (e.g., "(0)", "(1)")
  base = base.replace(/\(\d+\)$/, "");
  return `${base}.par`;
}
