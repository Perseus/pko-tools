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
