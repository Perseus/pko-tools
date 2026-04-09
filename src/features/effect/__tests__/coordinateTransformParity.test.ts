/**
 * Parity test: verify that our Three.js effect transform chain produces
 * the same vertex positions as the D3D game client.
 *
 * Reference data from game client debug dump of jjry03.eff:
 * - Sub 7: Rect, no rotaLoop, angle=[-PI/2, 0, 0], size=[0.5, 1.0, 3.2], pos=[0, 0, 0]
 * - D3D matSub (row-major): transforms vertex (x,y,z) → (0.5x, 3.2z, -y)
 *
 * The item viewer has a parent group with rotation=[-PI/2, 0, 0] and
 * a dummy matrix (identity rotation + small translation).
 * We need to find the correct inner transform so the final vertex
 * positions match D3D's output in the viewer's world space.
 */
import { describe, it, expect } from "vitest";
import * as THREE from "three";

// ── D3D reference data from jjry03_debug.txt ──

// Sub 7: Rect, no rotaLoop
// CurPos:   [0, 0, 0]
// CurAngle: [-PI/2, 0, 0]
// CurSize:  [0.5, 1.0, 3.2]
// D3D matSub (row-major):
//   [ 0.5000   0.0000   0.0000   0.0000]
//   [ 0.0000   0.0000  -1.0000   0.0000]
//   [ 0.0000   3.2000   0.0000   0.0000]
//   [ 0.0000   0.0000   0.0000   1.0000]

// Sub 0: RectPlane, with rotaLoop (at t=0, rotaLoop angle=0)
// CurPos:   [0, 1.4, 0]
// CurAngle: [PI/2, 0, 0]
// CurSize:  [0.4, 0.4, 1.0]
// D3D matSub without rotaLoop at t=0 would be Scale * Rx(PI/2):
//   [0.4, 0, 0, 0]
//   [0, 0, 0.4, 0]
//   [0, -1, 0, 0]
//   [0, 1.4, 0, 1]

// Rect geometry (C++ CreateRect): XZ plane, Z range [0,1]
const RECT_VERTS = [
  new THREE.Vector3(-0.5, 0, 0),
  new THREE.Vector3(-0.5, 0, 1),
  new THREE.Vector3(0.5, 0, 1),
  new THREE.Vector3(0.5, 0, 0),
];

// RectPlane geometry (C++ CreatePlaneRect): XY plane, centered
const RECTPLANE_VERTS = [
  new THREE.Vector3(-0.5, -0.5, 0),
  new THREE.Vector3(-0.5, 0.5, 0),
  new THREE.Vector3(0.5, 0.5, 0),
  new THREE.Vector3(0.5, -0.5, 0),
];

/**
 * Compute D3D vertex positions using the row-major matSub.
 * D3D: v' = v * M (row vector × row-major matrix)
 */
function d3dTransformVerts(verts: THREE.Vector3[], matRowMajor: number[][]): THREE.Vector3[] {
  return verts.map(v => {
    const x = v.x * matRowMajor[0][0] + v.y * matRowMajor[1][0] + v.z * matRowMajor[2][0] + matRowMajor[3][0];
    const y = v.x * matRowMajor[0][1] + v.y * matRowMajor[1][1] + v.z * matRowMajor[2][1] + matRowMajor[3][1];
    const z = v.x * matRowMajor[0][2] + v.y * matRowMajor[1][2] + v.z * matRowMajor[2][2] + matRowMajor[3][2];
    return new THREE.Vector3(x, y, z);
  });
}

/**
 * Compute Three.js vertex positions the same way applySubEffectFrame does:
 * mesh.position, mesh.scale, mesh.rotation (Euler "YXZ"), then parent transforms.
 */
function threeJsTransformVerts(
  verts: THREE.Vector3[],
  position: [number, number, number],
  angle: [number, number, number],
  size: [number, number, number],
  parentMatrix?: THREE.Matrix4,
): THREE.Vector3[] {
  // Build the mesh's local matrix: T * R * S
  const euler = new THREE.Euler(angle[0], angle[1], angle[2], "YXZ");
  const quat = new THREE.Quaternion().setFromEuler(euler);
  const scale = new THREE.Vector3(size[0], size[1], size[2]);
  const pos = new THREE.Vector3(position[0], position[1], position[2]);

  const localMatrix = new THREE.Matrix4().compose(pos, quat, scale);

  // If parent matrix provided, compose: parent * local
  const worldMatrix = parentMatrix
    ? new THREE.Matrix4().multiplyMatrices(parentMatrix, localMatrix)
    : localMatrix;

  return verts.map(v => v.clone().applyMatrix4(worldMatrix));
}

function vecClose(a: THREE.Vector3, b: THREE.Vector3, eps = 0.01): boolean {
  return Math.abs(a.x - b.x) < eps && Math.abs(a.y - b.y) < eps && Math.abs(a.z - b.z) < eps;
}

function formatVec(v: THREE.Vector3): string {
  return `(${v.x.toFixed(4)}, ${v.y.toFixed(4)}, ${v.z.toFixed(4)})`;
}

describe("Effect transform parity with D3D", () => {
  it("Sub 7 (Rect, no rotaLoop): Three.js local matches D3D matSub", () => {
    // D3D matSub for sub 7 (row-major)
    const d3dMatSub = [
      [0.5, 0, 0, 0],
      [0, 0, -1, 0],
      [0, 3.2, 0, 0],
      [0, 0, 0, 1],
    ];

    const d3dVerts = d3dTransformVerts(RECT_VERTS, d3dMatSub);
    const threeVerts = threeJsTransformVerts(
      RECT_VERTS,
      [0, 0, 0],           // position
      [-Math.PI / 2, 0, 0], // angle (pitch=-90°)
      [0.5, 1.0, 3.2],     // size
    );

    // Log for debugging
    console.log("Sub 7 — Rect, local space:");
    for (let i = 0; i < RECT_VERTS.length; i++) {
      const match = vecClose(d3dVerts[i], threeVerts[i]);
      console.log(`  v${i}: D3D=${formatVec(d3dVerts[i])}  Three=${formatVec(threeVerts[i])}  ${match ? "✓" : "✗ MISMATCH"}`);
    }

    for (let i = 0; i < RECT_VERTS.length; i++) {
      expect(vecClose(d3dVerts[i], threeVerts[i])).toBe(true);
    }
  });

  it("Sub 0 (RectPlane, no rotaLoop at t=0): Three.js local matches D3D matSub", () => {
    // D3D matSub for sub 0 at t=0 without rotaLoop:
    // Scale(0.4, 0.4, 1.0) * Rx_LH(PI/2)
    const d3dMatSub = [
      [0.4, 0, 0, 0],
      [0, 0, 0.4, 0],
      [0, -1, 0, 0],
      [0, 1.4, 0, 1],
    ];

    const d3dVerts = d3dTransformVerts(RECTPLANE_VERTS, d3dMatSub);
    const threeVerts = threeJsTransformVerts(
      RECTPLANE_VERTS,
      [0, 1.4, 0],
      [Math.PI / 2, 0, 0],
      [0.4, 0.4, 1.0],
    );

    console.log("Sub 0 — RectPlane, local space (no rotaLoop):");
    for (let i = 0; i < RECTPLANE_VERTS.length; i++) {
      const match = vecClose(d3dVerts[i], threeVerts[i]);
      console.log(`  v${i}: D3D=${formatVec(d3dVerts[i])}  Three=${formatVec(threeVerts[i])}  ${match ? "✓" : "✗ MISMATCH"}`);
    }

    for (let i = 0; i < RECTPLANE_VERTS.length; i++) {
      expect(vecClose(d3dVerts[i], threeVerts[i])).toBe(true);
    }
  });

  it("Sub 7 with item viewer parent chain: find correct inner transform", () => {
    // The item viewer has: parent Rx(-PI/2) → anchor(dummy) → scale(s,s,?) → sub-effect
    // We need vertex positions to match D3D in the final world space.
    //
    // In D3D game: finalMat = matSub * compound(0.7 scale) * boneMatrix
    // For standalone item viewer: no bone, compound = identity, parent = Rx(-PI/2)
    //
    // D3D compound matSub for sub 7:
    // Vertex (x,y,z) → (0.5x, 3.2z, -y) at position (0,0,0)
    //
    // After compound 0.7 scale: → (0.35x, 2.24z, -0.7y)
    //
    // In the game, these are in D3D world space (Y-up LH).
    // In the viewer, we need them in Three.js world space.
    // The weapon model is in glTF space (Y↔Z swapped from D3D, then Rx(-PI/2) applied).
    // Net effect on weapon vertices: D3D (x,y,z) → (x, y, -z).
    //
    // So for the effect to match the weapon, D3D local verts (x,y,z)
    // should end up at viewer world (x, y, -z).

    const d3dMatSub = [
      [0.5, 0, 0, 0],
      [0, 0, -1, 0],
      [0, 3.2, 0, 0],
      [0, 0, 0, 1],
    ];

    // D3D transforms vertex to effect-local space
    const d3dLocalVerts = d3dTransformVerts(RECT_VERTS, d3dMatSub);

    // Expected viewer world positions: D3D local (x,y,z) → (x, y, -z)
    // because the weapon model undergoes Y↔Z swap + Rx(-PI/2) = net Z negate
    const expectedViewerVerts = d3dLocalVerts.map(v => new THREE.Vector3(v.x, v.y, -v.z));

    // Now try different inner transforms to see which one produces the expected result.
    // The chain is: parentRx(-PI/2) * dummyMatrix(identity) * innerScale * subEffectLocal

    const parentRx = new THREE.Matrix4().makeRotationX(-Math.PI / 2);
    // Dummy is identity rotation (translation ignored for direction testing)

    // Option A: scale(s, s, -s) — negate Z
    const innerScaleA = new THREE.Matrix4().makeScale(1, 1, -1);
    const parentA = new THREE.Matrix4().multiplyMatrices(parentRx, innerScaleA);
    const vertsA = threeJsTransformVerts(RECT_VERTS, [0, 0, 0], [-Math.PI / 2, 0, 0], [0.5, 1, 3.2], parentA);

    // Option B: scale(s, -s, s) — negate Y
    const innerScaleB = new THREE.Matrix4().makeScale(1, -1, 1);
    const parentB = new THREE.Matrix4().multiplyMatrices(parentRx, innerScaleB);
    const vertsB = threeJsTransformVerts(RECT_VERTS, [0, 0, 0], [-Math.PI / 2, 0, 0], [0.5, 1, 3.2], parentB);

    // Option C: no inner scale (identity)
    const vertsC = threeJsTransformVerts(RECT_VERTS, [0, 0, 0], [-Math.PI / 2, 0, 0], [0.5, 1, 3.2], parentRx);

    // Option D: Y↔Z swap matrix
    const yzSwap = new THREE.Matrix4().set(1,0,0,0, 0,0,1,0, 0,1,0,0, 0,0,0,1);
    const parentD = new THREE.Matrix4().multiplyMatrices(parentRx, yzSwap);
    const vertsD = threeJsTransformVerts(RECT_VERTS, [0, 0, 0], [-Math.PI / 2, 0, 0], [0.5, 1, 3.2], parentD);

    console.log("\n=== Sub 7 Rect: finding correct inner transform ===");
    console.log("Expected (D3D local with Z negate):");
    expectedViewerVerts.forEach((v, i) => console.log(`  v${i}: ${formatVec(v)}`));

    const options = [
      { label: "A: scale(1,1,-1)", verts: vertsA },
      { label: "B: scale(1,-1,1)", verts: vertsB },
      { label: "C: identity (no inner)", verts: vertsC },
      { label: "D: Y↔Z swap", verts: vertsD },
    ];

    for (const opt of options) {
      const allMatch = opt.verts.every((v, i) => vecClose(v, expectedViewerVerts[i]));
      console.log(`\n${opt.label}: ${allMatch ? "✓ ALL MATCH" : "✗ mismatch"}`);
      opt.verts.forEach((v, i) => {
        const match = vecClose(v, expectedViewerVerts[i]);
        console.log(`  v${i}: ${formatVec(v)} ${match ? "✓" : "✗"}`);
      });
    }

    // Find the winning option
    const winner = options.find(opt => opt.verts.every((v, i) => vecClose(v, expectedViewerVerts[i])));
    console.log(`\nWinner: ${winner?.label ?? "NONE — need different approach"}`);

    // At minimum, assert that at least one option works
    expect(winner).toBeDefined();
  });

  it("Sub 0 positions: ring ordering should match D3D", () => {
    // In D3D: sub 0 (smallest ring, size=0.4) at Y=1.4, sub 4 (biggest, size=0.8) at Y=1.0
    // Hilt (sub 5/6) at Y=-0.5
    // In the game, biggest ring is closest to hilt.
    // Distance: |1.0 - (-0.5)| = 1.5 (biggest), |1.4 - (-0.5)| = 1.9 (smallest)
    // So biggest IS closer to hilt. ✓
    //
    // In the viewer, after the full transform chain, we need the same ordering:
    // biggest ring closest to hilt position in viewer world space.

    const parentRx = new THREE.Matrix4().makeRotationX(-Math.PI / 2);

    // Test each option's effect on sub-effect positions
    const subPositions = [
      { label: "sub0 (smallest, 0.4)", pos: [0, 1.4, 0] as [number, number, number] },
      { label: "sub4 (biggest, 0.8)", pos: [0, 1.0, 0] as [number, number, number] },
      { label: "hilt (sub5)", pos: [0, -0.5, 0] as [number, number, number] },
    ];

    const options = [
      { label: "A: scale(1,1,-1)", scale: new THREE.Matrix4().makeScale(1, 1, -1) },
      { label: "B: scale(1,-1,1)", scale: new THREE.Matrix4().makeScale(1, -1, 1) },
      { label: "C: identity", scale: new THREE.Matrix4().identity() },
      { label: "D: Y↔Z swap", scale: new THREE.Matrix4().set(1,0,0,0, 0,0,1,0, 0,1,0,0, 0,0,0,1) },
    ];

    console.log("\n=== Ring ordering test ===");
    for (const opt of options) {
      const parent = new THREE.Matrix4().multiplyMatrices(parentRx, opt.scale);
      console.log(`\n${opt.label}:`);
      const worldPositions: { label: string; worldPos: THREE.Vector3 }[] = [];
      for (const sub of subPositions) {
        const worldPos = new THREE.Vector3(...sub.pos).applyMatrix4(parent);
        worldPositions.push({ label: sub.label, worldPos });
        console.log(`  ${sub.label}: pos=${sub.pos} → world=${formatVec(worldPos)}`);
      }

      // Check: is biggest ring closer to hilt than smallest ring?
      const hilt = worldPositions[2].worldPos;
      const biggest = worldPositions[1].worldPos;
      const smallest = worldPositions[0].worldPos;
      const distBiggest = hilt.distanceTo(biggest);
      const distSmallest = hilt.distanceTo(smallest);
      const correctOrder = distBiggest < distSmallest;
      console.log(`  dist(biggest→hilt)=${distBiggest.toFixed(3)}, dist(smallest→hilt)=${distSmallest.toFixed(3)} → ${correctOrder ? "✓ correct order" : "✗ WRONG order"}`);
    }
  });
});
