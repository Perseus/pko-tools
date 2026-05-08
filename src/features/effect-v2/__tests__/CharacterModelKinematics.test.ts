import { describe, expect, it } from "vitest";
import {
  computeCharacterModelClipTime,
  isCharacterModelPlaying,
} from "../renderers/characterModelKinematics";
import type { ParChaModel } from "@/types/effect-v2";
import type { CharacterAction } from "@/types/character";

function model(overrides: Partial<ParChaModel> = {}): ParChaModel {
  return {
    id: 52,
    velocity: 1,
    playType: 2,
    curPose: 7,
    srcBlend: 5,
    destBlend: 2,
    color: [1, 1, 1, 1],
    ...overrides,
  };
}

const action: CharacterAction = {
  action_id: 7,
  name: "cast",
  start_frame: 30,
  end_frame: 60,
  key_frames: [],
  weapon_mode: null,
};

describe("character model particle kinematics", () => {
  it("maps the current pose to its CharacterAction frame range", () => {
    expect(computeCharacterModelClipTime(model(), action, 0, 30)).toBeCloseTo(1);
  });

  it("loops PLAY_LOOP poses within the C++ inclusive frame span", () => {
    expect(computeCharacterModelClipTime(model({ velocity: 1, playType: 2 }), action, 2, 30)).toBeCloseTo(59 / 30);
  });

  it("clamps PLAY_ONCE poses at the action end frame", () => {
    expect(computeCharacterModelClipTime(model({ velocity: 1, playType: 1 }), action, 2, 30)).toBeCloseTo(2);
  });

  it("holds PLAY_FRAME and PLAY_PAUSE at the pose start frame", () => {
    expect(computeCharacterModelClipTime(model({ playType: 3 }), action, 4, 30)).toBeCloseTo(1);
    expect(computeCharacterModelClipTime(model({ playType: 6 }), action, 4, 30)).toBeCloseTo(1);
  });

  it("stops PLAY_ONCE models when the C++ end keyframe would clear playing state", () => {
    expect(isCharacterModelPlaying(model({ playType: 1 }), action, 0.5, 30)).toBe(true);
    expect(isCharacterModelPlaying(model({ playType: 1 }), action, 1, 30)).toBe(false);
  });

  it("keeps PLAY_LOOP and frame-held models alive", () => {
    expect(isCharacterModelPlaying(model({ playType: 2 }), action, 20, 30)).toBe(true);
    expect(isCharacterModelPlaying(model({ playType: 3 }), action, 20, 30)).toBe(true);
    expect(isCharacterModelPlaying(model({ playType: 6 }), action, 20, 30)).toBe(true);
  });
});
