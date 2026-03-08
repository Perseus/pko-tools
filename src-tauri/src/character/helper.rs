use binrw::{binwrite, BinWrite};
use serde::Serialize;

use crate::math::{LwBox, LwMatrix44, LwPlane, LwSphere, LwVector3};

fn serialize_fixed_cstr<const N: usize, S: serde::Serializer>(
    buf: &[u8; N],
    ser: S,
) -> Result<S::Ok, S::Error> {
    let end = buf.iter().position(|&b| b == 0).unwrap_or(N);
    let s = String::from_utf8_lossy(&buf[..end]);
    ser.serialize_str(&s)
}

pub const HELPER_TYPE_DUMMY: u32 = 0x0001;
pub const HELPER_TYPE_BOX: u32 = 0x0002;
pub const HELPER_TYPE_MESH: u32 = 0x0004;
pub const HELPER_TYPE_BBOX: u32 = 0x0010;
pub const HELPER_TYPE_BSPHERE: u32 = 0x0020;

#[derive(Debug, Serialize, BinWrite)]
pub struct HelperDummyInfo {
    pub id: u32,
    pub mat: LwMatrix44,
    pub mat_local: LwMatrix44,
    // 0: default, 1: bone parent, 2: bone dummy parent
    pub parent_type: u32,
    pub parent_id: u32,
}

#[derive(Debug, Serialize, BinWrite)]
pub struct HelperBoxInfo {
    pub id: u32,
    pub _type: u32,
    pub state: u32,
    pub _box: LwBox,
    pub mat: LwMatrix44,
    #[serde(serialize_with = "serialize_fixed_cstr::<32, _>")]
    pub name: [u8; 32],
}

#[derive(Debug, Serialize, BinWrite)]
pub struct HelperMeshFaceInfo {
    pub vertex: [u32; 3],
    pub adj_face: [u32; 3],

    pub plane: LwPlane,
    pub center: LwVector3,
}

#[derive(Debug, Serialize, BinWrite)]
pub struct HelperMeshInfo {
    pub id: u32,
    pub _type: u32,
    pub sub_type: u32,

    #[serde(serialize_with = "serialize_fixed_cstr::<32, _>")]
    pub name: [u8; 32],
    pub state: u32,
    pub mat: LwMatrix44,
    pub _box: LwBox,

    pub vertex_num: u32,
    pub face_num: u32,

    pub vertex_seq: Vec<LwVector3>,

    pub face_seq: Vec<HelperMeshFaceInfo>,
}

#[derive(Debug, Serialize, BinWrite)]
pub struct BoundingBoxInfo {
    pub id: u32,
    pub _box: LwBox,
    pub mat: LwMatrix44,
}

#[derive(Debug, Serialize, BinWrite)]
pub struct BoundingSphereInfo {
    pub id: u32,
    pub sphere: LwSphere,
    pub mat: LwMatrix44,
}

#[binwrite]
#[derive(Debug, Serialize)]
pub struct HelperData {
    pub _type: u32,

    #[bw(if(_type & HELPER_TYPE_DUMMY > 0))]
    pub dummy_num: u32,

    #[bw(if(*dummy_num > 0))]
    pub dummy_seq: Vec<HelperDummyInfo>,

    #[bw(if(_type &  HELPER_TYPE_BOX > 0))]
    pub box_num: u32,

    #[bw(if(*box_num > 0))]
    pub box_seq: Vec<HelperBoxInfo>,

    #[bw(if(_type & HELPER_TYPE_MESH > 0))]
    pub mesh_num: u32,

    #[bw(if(*mesh_num > 0))]
    pub mesh_seq: Vec<HelperMeshInfo>,

    #[bw(if(_type & HELPER_TYPE_BBOX > 0))]
    pub bbox_num: u32,

    #[bw(if(*bbox_num > 0))]
    pub bbox_seq: Vec<BoundingBoxInfo>,

    #[bw(if(_type & HELPER_TYPE_BSPHERE > 0))]
    pub bsphere_num: u32,

    #[bw(if(*bsphere_num > 0))]
    pub bsphere_seq: Vec<BoundingSphereInfo>,
}
