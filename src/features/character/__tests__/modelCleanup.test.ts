import { describe, expect, it } from "vitest";
import * as THREE from "three";

describe("CharacterModel cleanup", () => {
  /**
   * Simulates what happens during model switch cleanup:
   * SkeletonDebugHelpers adds child meshes (isHelper=true) to bones.
   * The cleanup must strip these before calling mixer.uncacheRoot.
   */

  function buildSceneWithHelpers() {
    const scene = new THREE.Group();
    scene.name = "root";

    const bone = new THREE.Bone();
    bone.name = "Bone_Hip";
    scene.add(bone);

    // SkeletonDebugHelpers adds helper meshes as children of bones
    const helper = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial(),
    );
    helper.userData.isHelper = true;
    helper.userData.helperType = "bone";
    bone.add(helper);

    const childBone = new THREE.Bone();
    childBone.name = "Bone_Spine";
    bone.add(childBone);

    const dummyHelper = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial(),
    );
    dummyHelper.userData.isHelper = true;
    dummyHelper.userData.helperType = "dummy";
    childBone.add(dummyHelper);

    return { scene, bone, childBone, helper, dummyHelper };
  }

  function stripHelpers(scene: THREE.Group) {
    scene.traverse((obj: THREE.Object3D) => {
      const helpers = obj.children.filter(c => c.userData?.isHelper);
      helpers.forEach(h => obj.remove(h));
    });
  }

  it("removes all isHelper children from the scene tree", () => {
    const { scene, bone, childBone } = buildSceneWithHelpers();

    // Before cleanup: helpers are present
    expect(bone.children.some(c => c.userData.isHelper)).toBe(true);
    expect(childBone.children.some(c => c.userData.isHelper)).toBe(true);

    stripHelpers(scene);

    // After cleanup: no helpers remain
    expect(bone.children.some(c => c.userData?.isHelper)).toBe(false);
    expect(childBone.children.some(c => c.userData?.isHelper)).toBe(false);
  });

  it("preserves non-helper children", () => {
    const { scene, bone, childBone } = buildSceneWithHelpers();

    stripHelpers(scene);

    // Bone_Spine (non-helper child of Bone_Hip) should still be there
    expect(bone.children).toContain(childBone);
  });

  it("handles scene with no helpers without error", () => {
    const scene = new THREE.Group();
    const bone = new THREE.Bone();
    scene.add(bone);

    expect(() => stripHelpers(scene)).not.toThrow();
    expect(bone.parent).toBe(scene);
  });

  it("allows mixer.uncacheRoot after helper removal", () => {
    const { scene } = buildSceneWithHelpers();
    const mixer = new THREE.AnimationMixer(scene);

    // Create a trivial animation to populate bindings
    const track = new THREE.NumberKeyframeTrack(".opacity", [0, 1], [1, 0]);
    const clip = new THREE.AnimationClip("idle", 1, [track]);
    const action = mixer.clipAction(clip);
    action.play();
    mixer.update(0);

    stripHelpers(scene);

    // This should not throw after helpers are removed
    expect(() => {
      mixer.stopAllAction();
      mixer.uncacheClip(clip);
      mixer.uncacheRoot(scene);
    }).not.toThrow();
  });
});
