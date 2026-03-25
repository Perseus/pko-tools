use cgmath::{Matrix, Matrix4};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExportProfile {
    /// Spec-compliant RH Y-up. Correct in any glTF viewer.
    StandardGltf,
    /// Pre-inverted X for glTFast. Clean Unity import with positive X.
    UnityGltfast,
}

pub struct CoordTransform {
    profile: ExportProfile,
}

impl CoordTransform {
    pub fn new(profile: ExportProfile) -> Self {
        Self { profile }
    }

    pub fn profile(&self) -> ExportProfile {
        self.profile
    }

    /// Remap position/translation: PKO Z-up LH -> Y-up
    pub fn position(&self, v: [f32; 3]) -> [f32; 3] {
        let [x, y, z] = v;
        match self.profile {
            ExportProfile::StandardGltf => [x, z, -y],
            ExportProfile::UnityGltfast => [-x, z, y],
        }
    }

    /// Remap normal/tangent (same swizzle as position)
    pub fn normal(&self, v: [f32; 3]) -> [f32; 3] {
        self.position(v)
    }

    /// Remap quaternion rotation
    pub fn quaternion(&self, q: [f32; 4]) -> [f32; 4] {
        let [x, y, z, w] = q;
        match self.profile {
            ExportProfile::StandardGltf => [x, z, -y, w],
            ExportProfile::UnityGltfast => [-x, z, y, w],
        }
    }

    /// Remap scale vector (axis swap, no sign flip)
    pub fn scale(&self, v: [f32; 3]) -> [f32; 3] {
        let [x, y, z] = v;
        [x, z, y]
    }

    /// Remap euler angles (rotation amounts around axes)
    pub fn euler_angles(&self, angles: [f32; 3]) -> [f32; 3] {
        let [ax, ay, az] = angles;
        match self.profile {
            ExportProfile::StandardGltf => [ax, az, -ay],
            ExportProfile::UnityGltfast => [-ax, az, ay],
        }
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
        // cgmath::Matrix4::new() is column-major
        let b = match self.profile {
            ExportProfile::StandardGltf => Matrix4::new(
                // Maps (x,y,z) -> (x, z, -y)
                1.0,  0.0, 0.0, 0.0,
                0.0,  0.0, -1.0, 0.0,
                0.0,  1.0, 0.0, 0.0,
                0.0,  0.0, 0.0, 1.0,
            ),
            ExportProfile::UnityGltfast => Matrix4::new(
                // Maps (x,y,z) -> (-x, z, y)
                -1.0, 0.0, 0.0, 0.0,
                0.0,  0.0, 1.0, 0.0,
                0.0,  1.0, 0.0, 0.0,
                0.0,  0.0, 0.0, 1.0,
            ),
        };
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

    /// Reverse triangle winding: CW (D3D) -> CCW (glTF)
    /// Swaps indices 1 and 2 in each triangle.
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
        let ct = CoordTransform::new(ExportProfile::StandardGltf);
        assert_arr3_eq(ct.position([1.0, 2.0, 3.0]), [1.0, 3.0, -2.0]);
    }

    #[test]
    fn unity_position_swizzle() {
        let ct = CoordTransform::new(ExportProfile::UnityGltfast);
        assert_arr3_eq(ct.position([1.0, 2.0, 3.0]), [-1.0, 3.0, 2.0]);
    }

    #[test]
    fn unity_round_trip_with_gltfast() {
        // Apply Unity profile then simulate glTFast X negation
        let ct = CoordTransform::new(ExportProfile::UnityGltfast);
        let input = [100.0, 200.0, 50.0];
        let after_profile = ct.position(input);
        assert_arr3_eq(after_profile, [-100.0, 50.0, 200.0]);
        // glTFast negates X
        let final_result = [-after_profile[0], after_profile[1], after_profile[2]];
        assert_arr3_eq(final_result, [100.0, 50.0, 200.0]);
    }

    #[test]
    fn normal_matches_position() {
        let standard = CoordTransform::new(ExportProfile::StandardGltf);
        let unity = CoordTransform::new(ExportProfile::UnityGltfast);
        let v = [0.5, -0.3, 0.8];
        assert_arr3_eq(standard.normal(v), standard.position(v));
        assert_arr3_eq(unity.normal(v), unity.position(v));
    }

    #[test]
    fn standard_quaternion_swizzle() {
        let ct = CoordTransform::new(ExportProfile::StandardGltf);
        assert_arr4_eq(
            ct.quaternion([0.1, 0.2, 0.3, 0.9]),
            [0.1, 0.3, -0.2, 0.9],
        );
    }

    #[test]
    fn unity_quaternion_swizzle() {
        let ct = CoordTransform::new(ExportProfile::UnityGltfast);
        assert_arr4_eq(
            ct.quaternion([0.1, 0.2, 0.3, 0.9]),
            [-0.1, 0.3, 0.2, 0.9],
        );
    }

    #[test]
    fn quaternion_position_consistency() {
        // Rotate a position by a quaternion in source space then convert,
        // vs convert both then rotate. Results must match within 1e-5.
        let ct = CoordTransform::new(ExportProfile::StandardGltf);

        // Source quaternion: ~45 deg around Z. glTF order [x,y,z,w].
        let src_q = [0.0, 0.0, 0.383, 0.924];
        let src_p = [1.0, 0.0, 0.0];

        // Rotate in source space: q * p * q_conjugate
        // cgmath Quaternion::new(w, x, y, z)
        let q = Quaternion::new(src_q[3], src_q[0], src_q[1], src_q[2]);
        let p = Vector3::new(src_p[0], src_p[1], src_p[2]);

        // Manual quaternion rotation: q * p * q_conjugate
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
    fn matrix4_identity_stays_identity() {
        let identity = [
            [1.0, 0.0, 0.0, 0.0],
            [0.0, 1.0, 0.0, 0.0],
            [0.0, 0.0, 1.0, 0.0],
            [0.0, 0.0, 0.0, 1.0],
        ];

        let standard = CoordTransform::new(ExportProfile::StandardGltf);
        let unity = CoordTransform::new(ExportProfile::UnityGltfast);

        let result_s = standard.matrix4(identity);
        let result_u = unity.matrix4(identity);

        for col in 0..4 {
            for row in 0..4 {
                let expected = if col == row { 1.0 } else { 0.0 };
                assert!(
                    approx_eq(result_s[col][row], expected),
                    "Standard identity[{}][{}]: expected {}, got {}",
                    col,
                    row,
                    expected,
                    result_s[col][row]
                );
                assert!(
                    approx_eq(result_u[col][row], expected),
                    "Unity identity[{}][{}]: expected {}, got {}",
                    col,
                    row,
                    expected,
                    result_u[col][row]
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

        let ct = CoordTransform::new(ExportProfile::StandardGltf);
        let result = ct.matrix4(m);

        // Column-major output: translation is in column 3 (result[3])
        // Standard profile: (x,y,z) -> (x, z, -y) so (10, 20, 30) -> (10, 30, -20)
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
            approx_eq(result[3][2], -20.0),
            "tz: expected -20, got {}",
            result[3][2]
        );
    }

    #[test]
    fn matrix4_rotation_around_z_becomes_rotation_around_y() {
        // 90 deg around Z in row-major D3D:
        // cos90=0, sin90=1
        // [ cos  sin  0  0]   [ 0  1  0  0]
        // [-sin  cos  0  0] = [-1  0  0  0]
        // [  0    0   1  0]   [ 0  0  1  0]
        // [  0    0   0  1]   [ 0  0  0  1]
        let m = [
            [0.0, 1.0, 0.0, 0.0],
            [-1.0, 0.0, 0.0, 0.0],
            [0.0, 0.0, 1.0, 0.0],
            [0.0, 0.0, 0.0, 1.0],
        ];

        let ct = CoordTransform::new(ExportProfile::StandardGltf);
        let result = ct.matrix4(m);

        // 90 deg around Y in column-major glTF:
        // [ cos  0  sin  0]   [ 0  0  1  0]
        // [  0   1   0   0] = [ 0  1  0  0]
        // [-sin  0  cos  0]   [-1  0  0  0]
        // [  0   0   0   1]   [ 0  0  0  1]
        // Column-major: col0=[0,0,-1,0], col1=[0,1,0,0], col2=[1,0,0,0], col3=[0,0,0,1]
        let expected = [
            [0.0, 0.0, -1.0, 0.0],
            [0.0, 1.0, 0.0, 0.0],
            [1.0, 0.0, 0.0, 0.0],
            [0.0, 0.0, 0.0, 1.0],
        ];

        for col in 0..4 {
            for row in 0..4 {
                assert!(
                    approx_eq(result[col][row], expected[col][row]),
                    "rot_z_to_y[{}][{}]: expected {}, got {}",
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
        let ct = CoordTransform::new(ExportProfile::StandardGltf);
        assert_arr3_eq(ct.scale([1.0, 2.0, 3.0]), [1.0, 3.0, 2.0]);

        let ct2 = CoordTransform::new(ExportProfile::UnityGltfast);
        assert_arr3_eq(ct2.scale([1.0, 2.0, 3.0]), [1.0, 3.0, 2.0]);
    }

    #[test]
    fn standard_euler_angles() {
        let ct = CoordTransform::new(ExportProfile::StandardGltf);
        assert_arr3_eq(ct.euler_angles([0.1, 0.2, 0.3]), [0.1, 0.3, -0.2]);
    }

    #[test]
    fn unity_euler_angles() {
        let ct = CoordTransform::new(ExportProfile::UnityGltfast);
        assert_arr3_eq(ct.euler_angles([0.1, 0.2, 0.3]), [-0.1, 0.3, 0.2]);
    }

    #[test]
    fn reverse_indices_swaps_winding() {
        let ct = CoordTransform::new(ExportProfile::StandardGltf);
        let mut indices = vec![0, 1, 2, 3, 4, 5];
        ct.reverse_indices(&mut indices);
        assert_eq!(indices, vec![0, 2, 1, 3, 5, 4]);
    }
}
