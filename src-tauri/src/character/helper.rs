use binrw::{binrw, BinRead};

use super::math::{LwBox, LwMatrix44, LwPlane, LwSphere, LwVector3};

pub const HELPER_TYPE_DUMMY: u32 = 0x0001;
pub const HELPER_TYPE_BOX: u32 = 0x0002;
pub const HELPER_TYPE_MESH: u32 = 0x0004;
pub const HELPER_TYPE_BBOX: u32 = 0x0010;
pub const HELPER_TYPE_BSPHERE: u32 = 0x0020;

#[derive(Debug)]
#[binrw]
pub struct HelperDummyInfo {
    pub id: u32,
    pub mat: LwMatrix44,
    pub mat_local: LwMatrix44,
    // 0: default, 1: bone parent, 2: bone dummy parent
    pub parent_type: u32,
    pub parent_id: u32,
}

#[derive(Debug)]
#[binrw]
pub struct HelperBoxInfo {
    pub id: u32,
    pub _type: u32,
    pub state: u32,
    pub _box: LwBox,
    pub mat: LwMatrix44,
    pub name: [u8; 32],
}

#[derive(Debug)]
#[binrw]
pub struct HelperMeshFaceInfo {
    pub vertex: [u32; 3],
    pub adj_face: [u32; 3],

    pub plane: LwPlane,
    pub center: LwVector3,
}

#[derive(Debug)]
#[binrw]
pub struct HelperMeshInfo {
    pub id: u32,
    pub _type: u32,
    pub sub_type: u32,

    pub name: [u8; 32],
    pub state: u32,
    pub mat: LwMatrix44,
    pub _box: LwBox,

    pub vertex_num: u32,
    pub face_num: u32,

    #[br(count = vertex_num)]
    pub vertex_seq: Vec<LwVector3>,

    #[br(count = face_num)]
    pub face_seq: Vec<HelperMeshFaceInfo>,
}

#[derive(Debug)]
#[binrw]
pub struct BoundingBoxInfo {
    pub id: u32,
    pub _box: LwBox,
    pub mat: LwMatrix44,
}

#[derive(Debug)]
#[binrw]
pub struct BoundingSphereInfo {
    pub id: u32,
    pub sphere: LwSphere,
    pub mat: LwMatrix44,
}

#[binrw]
#[derive(Debug)]
pub struct HelperData {
    #[br(dbg)]
    pub _type: u32,

    #[br(if(_type & HELPER_TYPE_DUMMY > 0))]
    #[br(dbg)]
    pub dummy_num: u32,

    #[br(if(dummy_num > 0))]
    #[br(count = dummy_num)]
    #[br(dbg)]
    pub dummy_seq: Vec<HelperDummyInfo>,

    #[br(if(_type &  HELPER_TYPE_BOX > 0))]
    #[br(dbg)]
    pub box_num: u32,

    #[br(if(box_num > 0))]
    #[br(count = box_num)]
    #[br(dbg)]
    pub box_seq: Vec<HelperBoxInfo>,

    #[br(dbg)]
    #[br(if(_type & HELPER_TYPE_MESH > 0))]
    pub mesh_num: u32,

    #[br(if(mesh_num > 0))]
    #[br(count = mesh_num)]
    #[br(dbg)]
    pub mesh_seq: Vec<HelperMeshInfo>,

    #[br(if(_type & HELPER_TYPE_BBOX > 0))]
    #[br(dbg)]
    pub bbox_num: u32,

    #[br(if(bbox_num > 0))]
    #[br(dbg)]
    #[br(count = bbox_num)]
    pub bbox_seq: Vec<BoundingBoxInfo>,

    #[br(if(_type & HELPER_TYPE_BSPHERE > 0))]
    #[br(dbg)]
    pub bsphere_num: u32,

    #[br(if(bsphere_num > 0))]
    #[br(dbg)]
    #[br(count = bsphere_num)]
    pub bsphere_seq: Vec<BoundingSphereInfo>,
}
