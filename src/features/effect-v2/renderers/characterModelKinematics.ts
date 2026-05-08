import type { CharacterAction } from "@/types/character";
import type { ParChaModel } from "@/types/effect-v2";

const PLAY_ONCE = 1;
const PLAY_LOOP = 2;
const PLAY_FRAME = 3;
const PLAY_PAUSE = 6;

export function computeCharacterModelClipTime(
  model: ParChaModel,
  action: CharacterAction | null | undefined,
  elapsedSeconds: number,
  fps = 30,
): number {
  if (!action || fps <= 0) return 0;

  const start = action.start_frame;
  const end = Math.max(action.end_frame, start);
  const span = end - start;
  let poseFrame = elapsedSeconds * fps * model.velocity;

  if (model.playType === PLAY_ONCE) {
    poseFrame = Math.min(Math.max(poseFrame, 0), span);
  } else if (model.playType === PLAY_LOOP) {
    poseFrame = span > 0 ? positiveModulo(poseFrame, span + 1) : 0;
  } else if (model.playType === PLAY_FRAME || model.playType === PLAY_PAUSE) {
    poseFrame = 0;
  }

  return (start + poseFrame) / fps;
}

export function findCharacterModelAction(
  actions: CharacterAction[],
  model: ParChaModel,
): CharacterAction | null {
  return actions.find((action) => action.action_id === model.curPose) ?? null;
}

export function isCharacterModelPlaying(
  model: ParChaModel,
  action: CharacterAction | null | undefined,
  elapsedSeconds: number,
  fps = 30,
): boolean {
  if (!action) return false;
  if (model.playType !== PLAY_ONCE) return true;
  if (fps <= 0 || model.velocity <= 0) return true;

  const span = Math.max(action.end_frame - action.start_frame, 0);
  return elapsedSeconds * fps * model.velocity < span;
}

function positiveModulo(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}
