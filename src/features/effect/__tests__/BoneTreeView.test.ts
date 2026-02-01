import { describe, expect, it } from "vitest";
import { buildBoneTree } from "@/features/effect/BoneTreeView";

describe("buildBoneTree", () => {
  it("builds a tree from flat bone list", () => {
    const bones = [
      { name: "Root", id: 0, parentId: 0 },
      { name: "Spine", id: 1, parentId: 0 },
      { name: "Head", id: 2, parentId: 1 },
    ];
    const tree = buildBoneTree(bones, []);
    expect(tree).toHaveLength(1);
    expect(tree[0].name).toBe("Root");
    expect(tree[0].children).toHaveLength(1);
    expect(tree[0].children[0].name).toBe("Spine");
    expect(tree[0].children[0].children).toHaveLength(1);
    expect(tree[0].children[0].children[0].name).toBe("Head");
  });

  it("attaches dummies to parent bones", () => {
    const bones = [
      { name: "Root", id: 0, parentId: 0 },
      { name: "Hand", id: 1, parentId: 0 },
    ];
    const dummies = [
      { name: "dummy_0", id: 0, parentBoneId: 1 },
    ];
    const tree = buildBoneTree(bones, dummies);
    expect(tree).toHaveLength(1);
    const hand = tree[0].children[0];
    expect(hand.name).toBe("Hand");
    expect(hand.children).toHaveLength(1);
    expect(hand.children[0].name).toBe("dummy_0");
    expect(hand.children[0].isDummy).toBe(true);
  });

  it("returns empty array for no bones", () => {
    const tree = buildBoneTree([], []);
    expect(tree).toHaveLength(0);
  });

  it("handles multiple roots", () => {
    const bones = [
      { name: "A", id: 0, parentId: 0 },
      { name: "B", id: 1, parentId: 1 },
    ];
    const tree = buildBoneTree(bones, []);
    expect(tree).toHaveLength(2);
  });

  it("orphan dummies become roots", () => {
    const dummies = [
      { name: "dummy_0", id: 0, parentBoneId: 99 },
    ];
    const tree = buildBoneTree([], dummies);
    expect(tree).toHaveLength(1);
    expect(tree[0].isDummy).toBe(true);
  });

  it("marks bones and dummies correctly", () => {
    const bones = [{ name: "Root", id: 0, parentId: 0 }];
    const dummies = [{ name: "dummy_0", id: 0, parentBoneId: 0 }];
    const tree = buildBoneTree(bones, dummies);
    expect(tree[0].isDummy).toBe(false);
    expect(tree[0].children[0].isDummy).toBe(true);
  });
});
