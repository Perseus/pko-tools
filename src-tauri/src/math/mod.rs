use binrw::binrw;
use cgmath::{InnerSpace, Matrix3, Matrix4, Quaternion, Vector2, Vector3};

#[binrw]
#[derive(Debug, Clone)]
#[br(little)]
pub struct LwVector3(
    #[br(map = |raw: [f32; 3]| Vector3::new(raw[0], raw[1], raw[2]))]
    #[bw(map = |v: &Vector3<f32>| [v.x, v.y, v.z])]
    pub Vector3<f32>,
);

impl LwVector3 {
    pub fn to_slice(&self) -> [f32; 3] {
        let v = &self.0;
        [v.x, v.y, v.z]
    }

    /// Linear interpolation between two vectors
    pub fn lerp(&self, other: &LwVector3, t: f32) -> LwVector3 {
        LwVector3(Vector3::new(
            self.0.x + (other.0.x - self.0.x) * t,
            self.0.y + (other.0.y - self.0.y) * t,
            self.0.z + (other.0.z - self.0.z) * t,
        ))
    }

    /// Hermite spline interpolation for CUBICSPLINE mode
    /// p0: start value, m0: start out-tangent, p1: end value, m1: end in-tangent
    /// t: interpolation factor [0, 1], delta_time: time between keyframes
    pub fn cubic_spline(
        p0: &LwVector3,
        m0: &LwVector3,
        p1: &LwVector3,
        m1: &LwVector3,
        t: f32,
        delta_time: f32,
    ) -> LwVector3 {
        let t2 = t * t;
        let t3 = t2 * t;

        // Hermite basis functions
        let h00 = 2.0 * t3 - 3.0 * t2 + 1.0;
        let h10 = t3 - 2.0 * t2 + t;
        let h01 = -2.0 * t3 + 3.0 * t2;
        let h11 = t3 - t2;

        // Scale tangents by delta_time per glTF spec
        LwVector3(Vector3::new(
            h00 * p0.0.x + h10 * delta_time * m0.0.x + h01 * p1.0.x + h11 * delta_time * m1.0.x,
            h00 * p0.0.y + h10 * delta_time * m0.0.y + h01 * p1.0.y + h11 * delta_time * m1.0.y,
            h00 * p0.0.z + h10 * delta_time * m0.0.z + h01 * p1.0.z + h11 * delta_time * m1.0.z,
        ))
    }
}

#[binrw]
#[derive(Debug, Clone, Copy)]
#[br(little)]
pub struct LwVector2(
    #[br(map = |raw: [f32; 2]| Vector2::new(raw[0], raw[1]))]
    #[bw(map = |v: &Vector2<f32>| [v.x, v.y])]
    pub Vector2<f32>,
);

impl Default for LwVector2 {
    fn default() -> Self {
        Self(Vector2::new(0.0, 0.0))
    }
}

#[binrw]
#[derive(Debug, Clone)]
#[br(little)]
pub struct LwQuaternion(
    #[br(map = |raw: [f32; 4]| Quaternion::new(raw[3], raw[0], raw[1], raw[2])) ]
    #[bw(map = |q: &Quaternion<f32>| [q.v.x, q.v.y, q.v.z, q.s])]
    pub Quaternion<f32>,
);

impl LwQuaternion {
    pub fn to_slice(&self) -> [f32; 4] {
        let q = &self.0;
        [q.v.x, q.v.y, q.v.z, q.s]
    }

    /// Spherical linear interpolation between two quaternions
    pub fn slerp(&self, other: &LwQuaternion, t: f32) -> LwQuaternion {
        // Ensure we take the shortest path by checking dot product
        // If dot < 0, negate one quaternion to take shorter arc
        let mut q1 = other.0;
        let dot = self.0.s * other.0.s + self.0.v.x * other.0.v.x + self.0.v.y * other.0.v.y + self.0.v.z * other.0.v.z;
        if dot < 0.0 {
            q1 = Quaternion::new(-q1.s, -q1.v.x, -q1.v.y, -q1.v.z);
        }
        
        let result = self.0.slerp(q1, t);
        LwQuaternion(result.normalize())
    }

    /// Hermite spline interpolation for quaternions (CUBICSPLINE)
    /// p0: start value, m0: start out-tangent, p1: end value, m1: end in-tangent
    /// t: interpolation factor [0, 1], delta_time: time between keyframes
    /// Note: glTF spec says to normalize the result
    pub fn cubic_spline(
        p0: &LwQuaternion,
        m0: &LwQuaternion,
        p1: &LwQuaternion,
        m1: &LwQuaternion,
        t: f32,
        delta_time: f32,
    ) -> LwQuaternion {
        // Ensure we take the shortest path by checking dot product
        let mut p1_adj = p1.0;
        let mut m1_adj = m1.0;
        let dot = p0.0.s * p1.0.s + p0.0.v.x * p1.0.v.x + p0.0.v.y * p1.0.v.y + p0.0.v.z * p1.0.v.z;
        if dot < 0.0 {
            p1_adj = Quaternion::new(-p1.0.s, -p1.0.v.x, -p1.0.v.y, -p1.0.v.z);
            m1_adj = Quaternion::new(-m1.0.s, -m1.0.v.x, -m1.0.v.y, -m1.0.v.z);
        }
        
        let t2 = t * t;
        let t3 = t2 * t;

        // Hermite basis functions
        let h00 = 2.0 * t3 - 3.0 * t2 + 1.0;
        let h10 = t3 - 2.0 * t2 + t;
        let h01 = -2.0 * t3 + 3.0 * t2;
        let h11 = t3 - t2;

        // Apply to each component, scale tangents by delta_time per glTF spec
        let s = h00 * p0.0.s
            + h10 * delta_time * m0.0.s
            + h01 * p1_adj.s
            + h11 * delta_time * m1_adj.s;
        let vx = h00 * p0.0.v.x
            + h10 * delta_time * m0.0.v.x
            + h01 * p1_adj.v.x
            + h11 * delta_time * m1_adj.v.x;
        let vy = h00 * p0.0.v.y
            + h10 * delta_time * m0.0.v.y
            + h01 * p1_adj.v.y
            + h11 * delta_time * m1_adj.v.y;
        let vz = h00 * p0.0.v.z
            + h10 * delta_time * m0.0.v.z
            + h01 * p1_adj.v.z
            + h11 * delta_time * m1_adj.v.z;

        LwQuaternion(Quaternion::new(s, vx, vy, vz).normalize())
    }
}

pub fn matrix4_to_quaternion(mat: Matrix4<f32>) -> Quaternion<f32> {
    let m00 = mat.x.x;
    let m01 = mat.y.x;
    let m02 = mat.z.x;
    let m10 = mat.x.y;
    let m11 = mat.y.y;
    let m12 = mat.z.y;
    let m20 = mat.x.z;
    let m21 = mat.y.z;
    let m22 = mat.z.z;

    let trace = m00 + m11 + m22;
    if trace > 0.0 {
        let s = 0.5 / (trace + 1.0).sqrt();
        let w = 0.25 / s;
        let x = (m21 - m12) * s;
        let y = (m02 - m20) * s;
        let z = (m10 - m01) * s;
        Quaternion::new(w, x, y, z).normalize()
    } else if m00 > m11 && m00 > m22 {
        let s = 2.0 * (1.0 + m00 - m11 - m22).sqrt();
        let inv_s = 1.0 / s;
        let w = (m21 - m12) * inv_s;
        let x = 0.25 * s;
        let y = (m01 + m10) * inv_s;
        let z = (m02 + m20) * inv_s;
        Quaternion::new(w, x, y, z).normalize()
    } else if m11 > m22 {
        let s = 2.0 * (1.0 + m11 - m00 - m22).sqrt();
        let inv_s = 1.0 / s;
        let w = (m02 - m20) * inv_s;
        let x = (m01 + m10) * inv_s;
        let y = 0.25 * s;
        let z = (m12 + m21) * inv_s;
        Quaternion::new(w, x, y, z).normalize()
    } else {
        let s = 2.0 * (1.0 + m22 - m00 - m11).sqrt();
        let inv_s = 1.0 / s;
        let w = (m10 - m01) * inv_s;
        let x = (m02 + m20) * inv_s;
        let y = (m12 + m21) * inv_s;
        let z = 0.25 * s;
        Quaternion::new(w, x, y, z).normalize()
    }
}

#[binrw]
#[derive(Debug, Clone)]
#[br(little)]
pub struct LwMatrix44(
    #[br(map = |raw: [f32; 16]| Matrix4::new(
        raw[0], raw[1], raw[2], raw[3],
        raw[4], raw[5], raw[6], raw[7],
        raw[8], raw[9], raw[10], raw[11],
        raw[12], raw[13], raw[14], raw[15]
    ))]
    #[bw(map = |m: &Matrix4<f32>| [
        m.x.x, m.x.y, m.x.z, m.x.w,
        m.y.x, m.y.y, m.y.z, m.y.w,
        m.z.x, m.z.y, m.z.z, m.z.w,
        m.w.x, m.w.y, m.w.z, m.w.w
    ])]
    pub Matrix4<f32>,
);

impl LwMatrix44 {
    pub fn from_slice(s: &[f32; 16]) -> Self {
        LwMatrix44(Matrix4::new(
            s[0], s[1], s[2], s[3],
            s[4], s[5], s[6], s[7],
            s[8], s[9], s[10], s[11],
            s[12], s[13], s[14], s[15],
        ))
    }

    pub fn to_slice(&self) -> [f32; 16] {
        let m = &self.0;
        [
            m.x.x, m.x.y, m.x.z, m.x.w, m.y.x, m.y.y, m.y.z, m.y.w, m.z.x, m.z.y, m.z.z, m.z.w,
            m.w.x, m.w.y, m.w.z, m.w.w,
        ]
    }

    pub fn to_row_major_slice(&self) -> [f32; 16] {
        let m = &self.0;
        [
            m.x.x, m.y.x, m.z.x, m.w.x, m.x.y, m.y.y, m.z.y, m.w.y, m.x.z, m.y.z, m.z.z, m.w.z,
            m.x.w, m.y.w, m.z.w, m.w.w,
        ]
    }

    pub fn to_translation_rotation_scale(&self) -> (LwVector3, LwQuaternion, LwVector3) {
        let translation = Vector3::new(self.0.x.z, self.0.y.z, self.0.z.z);

        let mut col0 = Vector3::new(self.0.x.x, self.0.y.x, self.0.z.x);
        let mut col1 = Vector3::new(self.0.x.y, self.0.y.y, self.0.z.y);
        let mut col2 = Vector3::new(self.0.x.z, self.0.y.z, self.0.z.z);

        let scale_x = col0.magnitude();
        let scale_y = col1.magnitude();
        let scale_z = col2.magnitude();
        let scale = LwVector3(Vector3::new(scale_x, scale_y, scale_z));

        if scale_x != 0.0 {
            col0 /= scale_x;
        }
        if scale_y != 0.0 {
            col1 /= scale_y;
        }
        if scale_z != 0.0 {
            col2 /= scale_z;
        }

        let rot_mat = Matrix4::new(
            col0.x, col1.x, col2.x, 0.0, col0.y, col1.y, col2.y, 0.0, col0.z, col1.z, col2.z, 0.0,
            0.0, 0.0, 0.0, 1.0,
        );

        let rotation_quat = matrix4_to_quaternion(rot_mat);

        (LwVector3(translation), LwQuaternion(rotation_quat), scale)
    }

    /// Create a translation-only matrix.
    pub fn from_translation(translation: Vector3<f32>) -> Self {
        LwMatrix44(Matrix4::from_translation(translation))
    }

    /// Create a transformation matrix that first scales then translates.
    /// (Since a sphere is invariant under rotation, we ignore it.)
    pub fn from_translation_scale(translation: Vector3<f32>, scale: f32) -> Self {
        // Note: glTF expects column-major matrices.
        let trans = Matrix4::from_translation(translation);
        let scale = Matrix4::from_scale(scale);
        LwMatrix44(trans * scale)
    }

    pub fn normalize(&self) -> Self {
        let (t, r, s) = self.to_translation_rotation_scale();
        let norm_rot = r.0.normalize();
        let scale = Matrix4::from_nonuniform_scale(s.0.x, s.0.y, s.0.z);

        let new_mat = Matrix4::from_translation(t.0) * Matrix4::from(norm_rot) * scale;

        LwMatrix44(new_mat)
    }
}

#[binrw]
#[derive(Debug, Clone)]
#[br(little)]
pub struct LwMatrix43(
    #[br(map = |raw: [f32; 12]| Matrix4::new(
        raw[0], raw[1], raw[2], 0.0,
        raw[3], raw[4], raw[5], 0.0,
        raw[6], raw[7], raw[8], 0.0,
        raw[9], raw[10], raw[11], 1.0,
    ))]
    // we want to convert it back to row-major while writing to the file again
    #[bw(map = |m: &Matrix4<f32>| [
        m.x.x, m.x.y, m.x.z, m.x.w,
        m.y.x, m.y.y, m.y.z, m.y.w,
        m.z.x, m.z.y, m.z.z, m.z.w
    ])]
    pub Matrix4<f32>,
);

impl LwMatrix43 {
    pub fn to_translation_rotation_scale(&self) -> (LwVector3, LwQuaternion, LwVector3) {
        // For column-major 4x3 matrix, translation is in the 4th column (w component)
        let translation = LwVector3(Vector3::new(self.0.w.x, self.0.w.y, self.0.w.z));

        // In column-major, each column vector is already separated
        let mut col0 = Vector3::new(self.0.x.x, self.0.x.y, self.0.x.z);
        let mut col1 = Vector3::new(self.0.y.x, self.0.y.y, self.0.y.z);
        let mut col2 = Vector3::new(self.0.z.x, self.0.z.y, self.0.z.z);

        let scale_x = col0.magnitude();
        let scale_y = col1.magnitude();
        let scale_z = col2.magnitude();
        let scale = LwVector3(Vector3::new(scale_x, scale_y, scale_z));

        if scale_x != 0.0 {
            col0 /= scale_x;
        }
        if scale_y != 0.0 {
            col1 /= scale_y;
        }
        if scale_z != 0.0 {
            col2 /= scale_z;
        }

        let rotation_matrix = Matrix3::from_cols(col0, col1, col2);
        let rotation = Quaternion::from(rotation_matrix);

        (translation, LwQuaternion(rotation), scale)
    }
}

#[binrw]
#[derive(Debug, Clone)]
#[br(little)]
pub struct LwBox {
    c: LwVector3,
    r: LwVector3,
}

#[binrw]
#[derive(Debug, Clone)]
#[br(little)]
pub struct LwPlane {
    a: f32,
    b: f32,
    c: f32,
    d: f32,
}

#[binrw]
#[derive(Debug, Clone)]
#[br(little)]
pub struct LwSphere {
    pub c: LwVector3,
    pub r: f32,
}

/// Convert a position/direction vector from Z-up to Y-up coordinate system.
/// Z-up (x, y, z) → Y-up (x, z, -y)
pub fn z_up_to_y_up_vec3(v: [f32; 3]) -> [f32; 3] {
    [v[0], v[2], -v[1]]
}

/// Convert a quaternion from Z-up to Y-up coordinate system.
/// In (w,x,y,z) notation: (w, x, y, z) → (w, x, z, -y)
/// Input/output uses glTF [x, y, z, w] order.
pub fn z_up_to_y_up_quat(q: [f32; 4]) -> [f32; 4] {
    // q is [x, y, z, w] in glTF order
    // Swizzle the vector part: (x, y, z) → (x, z, -y)
    [q[0], q[2], -q[1], q[3]]
}

/// Convert a column-major 4x4 matrix from Z-up to Y-up coordinate system.
/// M' = B * M * B^(-1) where B maps (x,y,z) → (x,z,-y).
pub fn z_up_to_y_up_mat4(m: [f32; 16]) -> [f32; 16] {
    let mat = Matrix4::new(
        m[0], m[1], m[2], m[3],
        m[4], m[5], m[6], m[7],
        m[8], m[9], m[10], m[11],
        m[12], m[13], m[14], m[15],
    );

    // B: maps (x,y,z) → (x,z,-y)
    let b = Matrix4::new(
        1.0, 0.0, 0.0, 0.0,
        0.0, 0.0, -1.0, 0.0,
        0.0, 1.0, 0.0, 0.0,
        0.0, 0.0, 0.0, 1.0,
    );

    // B^(-1): maps (x,y,z) → (x,-z,y) (orthogonal, so B^(-1) = B^T)
    let b_inv = Matrix4::new(
        1.0, 0.0, 0.0, 0.0,
        0.0, 0.0, 1.0, 0.0,
        0.0, -1.0, 0.0, 0.0,
        0.0, 0.0, 0.0, 1.0,
    );

    let result = b * mat * b_inv;

    LwMatrix44(result).to_slice()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_vec3_lerp_at_zero() {
        let a = LwVector3(Vector3::new(0.0, 0.0, 0.0));
        let b = LwVector3(Vector3::new(10.0, 20.0, 30.0));
        let result = a.lerp(&b, 0.0);
        assert!((result.0.x - 0.0).abs() < 0.001);
        assert!((result.0.y - 0.0).abs() < 0.001);
        assert!((result.0.z - 0.0).abs() < 0.001);
    }

    #[test]
    fn test_vec3_lerp_at_half() {
        let a = LwVector3(Vector3::new(0.0, 0.0, 0.0));
        let b = LwVector3(Vector3::new(10.0, 20.0, 30.0));
        let result = a.lerp(&b, 0.5);
        assert!((result.0.x - 5.0).abs() < 0.001);
        assert!((result.0.y - 10.0).abs() < 0.001);
        assert!((result.0.z - 15.0).abs() < 0.001);
    }

    #[test]
    fn test_vec3_lerp_at_one() {
        let a = LwVector3(Vector3::new(0.0, 0.0, 0.0));
        let b = LwVector3(Vector3::new(10.0, 20.0, 30.0));
        let result = a.lerp(&b, 1.0);
        assert!((result.0.x - 10.0).abs() < 0.001);
        assert!((result.0.y - 20.0).abs() < 0.001);
        assert!((result.0.z - 30.0).abs() < 0.001);
    }

    #[test]
    fn test_quat_slerp_at_zero() {
        let identity = LwQuaternion(Quaternion::new(1.0, 0.0, 0.0, 0.0));
        let rotated = LwQuaternion(Quaternion::new(0.707, 0.707, 0.0, 0.0).normalize());
        let result = identity.slerp(&rotated, 0.0);
        // Should be close to identity
        assert!((result.0.s - 1.0).abs() < 0.01);
    }

    #[test]
    fn test_quat_slerp_at_one() {
        let identity = LwQuaternion(Quaternion::new(1.0, 0.0, 0.0, 0.0));
        let rotated = LwQuaternion(Quaternion::new(0.707, 0.707, 0.0, 0.0).normalize());
        let result = identity.slerp(&rotated, 1.0);
        // Should be close to rotated
        assert!((result.0.s - rotated.0.s).abs() < 0.01);
        assert!((result.0.v.x - rotated.0.v.x).abs() < 0.01);
    }

    #[test]
    fn test_quat_slerp_at_half() {
        let identity = LwQuaternion(Quaternion::new(1.0, 0.0, 0.0, 0.0));
        // 90 degree rotation around X
        let rotated = LwQuaternion(Quaternion::new(0.707, 0.707, 0.0, 0.0).normalize());
        let result = identity.slerp(&rotated, 0.5);
        // Should be ~45 degrees (cos(22.5deg) ≈ 0.924 for w)
        assert!(result.0.s > 0.9);
        assert!(result.0.v.x > 0.3);
    }
}
