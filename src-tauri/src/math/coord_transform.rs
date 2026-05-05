use cgmath::{Matrix, Matrix4};

pub struct CoordTransform;

impl CoordTransform {
    pub fn new() -> Self {
        Self
    }

    /// Remap position/translation: PKO LH Z-up -> glTF RH Y-up
    /// (x, z, y) — det=-1, Y↔Z swap (LH→RH handedness change)
    pub fn position(&self, v: [f32; 3]) -> [f32; 3] {
        let [x, y, z] = v;
        [x, z, y]
    }

    /// Remap normal/tangent (same swizzle as position)
    pub fn normal(&self, v: [f32; 3]) -> [f32; 3] {
        self.position(v)
    }

    /// Remap quaternion rotation
    /// Conjugation through B_std=(x,z,y), det=-1.
    ///   [-x, -z, -y, w] — negate all imaginary + Y↔Z swap.
    pub fn quaternion(&self, q: [f32; 4]) -> [f32; 4] {
        let [x, y, z, w] = q;
        [-x, -z, -y, w]
    }

    /// Remap position for glTF extras/JSON data.
    ///
    /// Extras are raw JSON that viewers read natively — same as position().
    pub fn extras_position(&self, v: [f32; 3]) -> [f32; 3] {
        let [x, y, z] = v;
        [x, z, y]
    }

    /// Remap quaternion for glTF extras/JSON data.
    /// Same rationale as extras_position.
    pub fn extras_quaternion(&self, q: [f32; 4]) -> [f32; 4] {
        let [x, y, z, w] = q;
        [-x, -z, -y, w]
    }

    /// Remap euler angles for extras/JSON data.
    /// Same rationale as extras_position.
    pub fn extras_euler_angles(&self, angles: [f32; 3]) -> [f32; 3] {
        let [ax, ay, az] = angles;
        [-ax, -az, -ay]
    }

    /// Remap scale vector (axis swap, no sign flip)
    pub fn scale(&self, v: [f32; 3]) -> [f32; 3] {
        let [x, y, z] = v;
        [x, z, y]
    }

    /// Remap euler angles (rotation amounts around axes)
    /// Y↔Z swap + negate all (handedness flip reverses rotations)
    pub fn euler_angles(&self, angles: [f32; 3]) -> [f32; 3] {
        let [ax, ay, az] = angles;
        [-ax, -az, -ay]
    }

    /// Remap 4x4 transform matrix.
    /// Input: row-major D3D (translation in row 3: _41,_42,_43).
    /// Output: column-major glTF (transposed + basis-changed).
    pub fn matrix4(&self, m: [[f32; 4]; 4]) -> [[f32; 4]; 4] {
        // Input is row-major D3D. cgmath::Matrix4::new() takes column-major args.
        // Transpose on input to get correct cgmath representation.
        // Row-major m[row][col] transposed into cgmath column-major:
        // cgmath col j = input row j
        let d3d = Matrix4::new(
            m[0][0], m[0][1], m[0][2], m[0][3],
            m[1][0], m[1][1], m[1][2], m[1][3],
            m[2][0], m[2][1], m[2][2], m[2][3],
            m[3][0], m[3][1], m[3][2], m[3][3],
        );

        // Basis change matrix B (and B^-1 = B^T for orthogonal B)
        // Maps (x,y,z) -> (x, z, y) — Y↔Z swap, det=-1 (LH→RH)
        // cgmath::Matrix4::new() is column-major
        let b = Matrix4::new(
            1.0,  0.0, 0.0, 0.0,
            0.0,  0.0, 1.0, 0.0,
            0.0,  1.0, 0.0, 0.0,
            0.0,  0.0, 0.0, 1.0,
        );
        let b_inv = b.transpose(); // B is orthogonal, so B^-1 = B^T

        let result = b * d3d * b_inv;

        // Output as column-major 4x4 array (glTF convention)
        // result[col][row] in cgmath
        let mut out = [[0.0f32; 4]; 4];
        for col in 0..4 {
            for row in 0..4 {
                out[col][row] = result[col][row];
            }
        }
        out
    }

    /// Remap 4x4 transform matrix (column-major variant).
    /// Input/output: column-major [f32; 16] as used by cgmath and glTF node matrices.
    /// Same basis change as `matrix4()` but avoids row-major ↔ column-major reshaping.
    pub fn matrix4_col_major(&self, m: [f32; 16]) -> [f32; 16] {
        // Feed directly into cgmath (already column-major)
        let mat = Matrix4::new(
            m[0], m[1], m[2], m[3],
            m[4], m[5], m[6], m[7],
            m[8], m[9], m[10], m[11],
            m[12], m[13], m[14], m[15],
        );

        let b = Matrix4::new(
            // Maps (x,y,z) -> (x, z, y) — Y↔Z swap, det=-1 (LH→RH)
            1.0,  0.0, 0.0, 0.0,
            0.0,  0.0, 1.0, 0.0,
            0.0,  1.0, 0.0, 0.0,
            0.0,  0.0, 0.0, 1.0,
        );
        let b_inv = b.transpose();

        let result = b * mat * b_inv;

        // Output column-major [f32; 16]
        [
            result[0][0], result[0][1], result[0][2], result[0][3],
            result[1][0], result[1][1], result[1][2], result[1][3],
            result[2][0], result[2][1], result[2][2], result[2][3],
            result[3][0], result[3][1], result[3][2], result[3][3],
        ]
    }

    /// Reverse triangle winding to compensate for det=-1 reflection.
    ///
    /// The position transform flips apparent winding, so we must reverse
    /// indices to restore the correct CCW front faces.
    pub fn reverse_indices(&self, indices: &mut [u32]) {
        assert!(
            indices.len().is_multiple_of(3),
            "Index count must be divisible by 3"
        );
        for tri in indices.chunks_exact_mut(3) {
            tri.swap(1, 2);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use cgmath::{Quaternion, Vector3};

    fn approx_eq(a: f32, b: f32) -> bool {
        (a - b).abs() < 1e-5
    }

    fn assert_arr3_eq(a: [f32; 3], b: [f32; 3]) {
        assert!(
            approx_eq(a[0], b[0]) && approx_eq(a[1], b[1]) && approx_eq(a[2], b[2]),
            "expected {:?}, got {:?}",
            b,
            a
        );
    }

    fn assert_arr4_eq(a: [f32; 4], b: [f32; 4]) {
        assert!(
            approx_eq(a[0], b[0])
                && approx_eq(a[1], b[1])
                && approx_eq(a[2], b[2])
                && approx_eq(a[3], b[3]),
            "expected {:?}, got {:?}",
            b,
            a
        );
    }

    #[test]
    fn standard_position_swizzle() {
        let ct = CoordTransform::new();
        assert_arr3_eq(ct.position([1.0, 2.0, 3.0]), [1.0, 3.0, 2.0]);
    }

    #[test]
    fn normal_matches_position() {
        let ct = CoordTransform::new();
        let v = [0.5, -0.3, 0.8];
        assert_arr3_eq(ct.normal(v), ct.position(v));
    }

    #[test]
    fn standard_quaternion_swizzle() {
        let ct = CoordTransform::new();
        assert_arr4_eq(
            ct.quaternion([0.1, 0.2, 0.3, 0.9]),
            [-0.1, -0.3, -0.2, 0.9],
        );
    }

    /// Helper: verify quaternion-position consistency.
    /// Rotate in source space then convert == convert both then rotate.
    fn assert_quaternion_position_consistency(ct: &CoordTransform, src_q: [f32; 4], src_p: [f32; 3]) {
        let q = Quaternion::new(src_q[3], src_q[0], src_q[1], src_q[2]);
        let p = Vector3::new(src_p[0], src_p[1], src_p[2]);

        let p_quat = Quaternion::new(0.0, p.x, p.y, p.z);
        let q_conj = Quaternion::new(q.s, -q.v.x, -q.v.y, -q.v.z);
        let rotated_quat = q * p_quat * q_conj;
        let rotated_src = [rotated_quat.v.x, rotated_quat.v.y, rotated_quat.v.z];

        // Path A: rotate in source space, then convert
        let path_a = ct.position(rotated_src);

        // Path B: convert both, then rotate in target space
        let tgt_q_arr = ct.quaternion(src_q);
        let tgt_p_arr = ct.position(src_p);
        let tgt_q = Quaternion::new(tgt_q_arr[3], tgt_q_arr[0], tgt_q_arr[1], tgt_q_arr[2]);
        let tgt_p = Vector3::new(tgt_p_arr[0], tgt_p_arr[1], tgt_p_arr[2]);
        let tgt_p_quat = Quaternion::new(0.0, tgt_p.x, tgt_p.y, tgt_p.z);
        let tgt_q_conj = Quaternion::new(tgt_q.s, -tgt_q.v.x, -tgt_q.v.y, -tgt_q.v.z);
        let tgt_rotated = tgt_q * tgt_p_quat * tgt_q_conj;
        let path_b = [tgt_rotated.v.x, tgt_rotated.v.y, tgt_rotated.v.z];

        assert_arr3_eq(path_a, path_b);
    }

    #[test]
    fn quaternion_position_consistency() {
        let ct = CoordTransform::new();
        // ~45 deg around Z
        assert_quaternion_position_consistency(&ct, [0.0, 0.0, 0.383, 0.924], [1.0, 0.0, 0.0]);
    }

    #[test]
    fn matrix4_identity_stays_identity() {
        let identity = [
            [1.0, 0.0, 0.0, 0.0],
            [0.0, 1.0, 0.0, 0.0],
            [0.0, 0.0, 1.0, 0.0],
            [0.0, 0.0, 0.0, 1.0],
        ];

        let ct = CoordTransform::new();
        let result = ct.matrix4(identity);

        for col in 0..4 {
            for row in 0..4 {
                let expected = if col == row { 1.0 } else { 0.0 };
                assert!(
                    approx_eq(result[col][row], expected),
                    "identity[{}][{}]: expected {}, got {}",
                    col,
                    row,
                    expected,
                    result[col][row]
                );
            }
        }
    }

    #[test]
    fn matrix4_translation_remapped() {
        // Row-major D3D translation (10, 20, 30) in row 3
        let m = [
            [1.0, 0.0, 0.0, 0.0],
            [0.0, 1.0, 0.0, 0.0],
            [0.0, 0.0, 1.0, 0.0],
            [10.0, 20.0, 30.0, 1.0],
        ];

        let ct = CoordTransform::new();
        let result = ct.matrix4(m);

        // Column-major output: translation is in column 3 (result[3])
        // (x,y,z) -> (x, z, y) so (10, 20, 30) -> (10, 30, 20)
        assert!(
            approx_eq(result[3][0], 10.0),
            "tx: expected 10, got {}",
            result[3][0]
        );
        assert!(
            approx_eq(result[3][1], 30.0),
            "ty: expected 30, got {}",
            result[3][1]
        );
        assert!(
            approx_eq(result[3][2], 20.0),
            "tz: expected 20, got {}",
            result[3][2]
        );
    }

    #[test]
    fn matrix4_rotation_around_z_becomes_neg_rotation_around_y() {
        // 90 deg CW around Z in row-major D3D (LH):
        let m = [
            [0.0, 1.0, 0.0, 0.0],
            [-1.0, 0.0, 0.0, 0.0],
            [0.0, 0.0, 1.0, 0.0],
            [0.0, 0.0, 0.0, 1.0],
        ];

        let ct = CoordTransform::new();
        let result = ct.matrix4(m);

        // With det=-1 Y↔Z swap: PKO Z→glTF Y, so 90° CW around Z (LH)
        // becomes -90° around Y (RH). Maps (x,y,z) -> (-z, y, x).
        let expected = [
            [0.0, 0.0, 1.0, 0.0],
            [0.0, 1.0, 0.0, 0.0],
            [-1.0, 0.0, 0.0, 0.0],
            [0.0, 0.0, 0.0, 1.0],
        ];

        for col in 0..4 {
            for row in 0..4 {
                assert!(
                    approx_eq(result[col][row], expected[col][row]),
                    "rot_z_to_neg_y[{}][{}]: expected {}, got {}",
                    col,
                    row,
                    expected[col][row],
                    result[col][row]
                );
            }
        }
    }

    #[test]
    fn scale_swaps_yz_no_negation() {
        let ct = CoordTransform::new();
        assert_arr3_eq(ct.scale([1.0, 2.0, 3.0]), [1.0, 3.0, 2.0]);
    }

    #[test]
    fn standard_euler_angles() {
        let ct = CoordTransform::new();
        assert_arr3_eq(ct.euler_angles([0.1, 0.2, 0.3]), [-0.1, -0.3, -0.2]);
    }

    #[test]
    fn reverse_indices_swaps_winding() {
        let ct = CoordTransform::new();
        let mut indices = vec![0, 1, 2, 3, 4, 5];
        ct.reverse_indices(&mut indices);
        assert_eq!(indices, vec![0, 2, 1, 3, 5, 4]);
    }
}
