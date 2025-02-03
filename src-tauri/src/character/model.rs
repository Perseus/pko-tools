use std::{ffi::c_void, fs::File, io::BufWriter, path::PathBuf, vec};

use crate::{
    animation::character::{LwBoneFile, LW_INVALID_INDEX, LW_MAX_NAME},
    d3d::{D3DBlend, D3DCmpFunc, D3DFormat, D3DPool, D3DRenderStateType}, math::LwMatrix44,
};
use ::gltf::{
    buffer, image,
    json::{self, scene::UnitQuaternion, Index, Node, Scene},
    Document,
};
use base64::{prelude::BASE64_STANDARD, Engine};
use binrw::{binrw, BinRead, BinWrite, Error, NullString};
use gltf::json as gltf;
use gltf::Texture;

use super::{
    helper::HelperData, mesh::CharacterMeshInfo, texture::CharMaterialTextureInfo,
    GLTFFieldsToAggregate,
};

pub const EXP_OBJ_VERSION_0_0_0_0: u32 = 0x00000000;
pub const EXP_OBJ_VERSION_1_0_0_0: u32 = 0x00001000;
pub const EXP_OBJ_VERSION_1_0_0_1: u32 = 0x00001001;
pub const EXP_OBJ_VERSION_1_0_0_2: u32 = 0x00001002;
pub const EXP_OBJ_VERSION_1_0_0_3: u32 = 0x00001003;
pub const EXP_OBJ_VERSION_1_0_0_4: u32 = 0x00001004;
pub const EXP_OBJ_VERSION_1_0_0_5: u32 = 0x00001005;
pub const EXP_OBJ_VERSION: u32 = EXP_OBJ_VERSION_1_0_0_5;

pub const MTLTEX_VERSION0000: u32 = 0x00000000;
pub const MTLTEX_VERSION0001: u32 = 0x00000001;
pub const MTLTEX_VERSION0002: u32 = 0x00000002;
pub const MTLTEX_VERSION: u32 = MTLTEX_VERSION0002;

pub const MESH_VERSION0000: u32 = 0x00000000;
pub const MESH_VERSION0001: u32 = 0x00000001;
pub const MESH_VERSION: u32 = MESH_VERSION0001;

pub const LW_MAX_TEXTURESTAGE_NUM: u32 = 4;
pub const LW_MTL_RS_NUM: u32 = 8;

pub const D3DRS_ALPHAFUNC: u32 = D3DRenderStateType::AlphaFunc as u32;
pub const D3DRS_ALPHAREF: u32 = D3DRenderStateType::AlphaRef as u32;

#[derive(Debug, Default, Copy, Clone)]
#[binrw]
pub struct RenderStateValue {
    pub state: u32,
    pub value: u32,
}

#[derive(Debug, Clone)]
#[binrw]
pub struct RenderStateSetTemplate<const SET_SIZE: usize, const SEQ_SIZE: usize> {
    pub seq_size: u32,
    pub set_size: u32,

    pub rsv_seq: [[RenderStateValue; SEQ_SIZE]; SET_SIZE],
}

impl<const SET_SIZE: usize, const SEQ_SIZE: usize> RenderStateSetTemplate<SET_SIZE, SEQ_SIZE> {
    pub fn new() -> Self {
        let rsv_seq = [[RenderStateValue::default(); SEQ_SIZE]; SET_SIZE];
        Self {
            rsv_seq,
            seq_size: SEQ_SIZE as u32,
            set_size: SET_SIZE as u32,
        }
    }
}

#[binrw]
pub struct RenderCtrlCreateInfo {
    // this determines the type of rendering pipeline or vertex shader behaviour that the object will use
    // FILE: lwPrimitive.cpp, FN: ExtractGeomObjInfo
    // VALUES FILE: lwlTypes.h, lwRenderCtrlVSTypeEnum
    // valid values:
    // RENDERCTRL_VS_FIXEDFUNCTION = 1
    // RENDERCTRL_VS_VERTEXBLEND = 2
    // RENDERCTRL_VS_VERTEXBLEND_DX9 = 3
    // RENDERCTRL_VS_USER = 0x100 (from 256 - 512)
    // RENDERCTRL_VS_INVALID = 0xffffffff
    ctrl_id: u32,

    // vertex declaration ID. FILE: lwPrimitive.cpp, FN: ExtractGeomObjInfo
    // vertex declarations are the format of a vertex in memory
    // vertexes are the points that make up a mesh
    // they can carry a lot more data apart from just the position like
    // normals, texture coordinates, color, bone weights etc.
    // the declaration defines the layout of this data
    // so that when that vertex is passed to a vertex shader
    // the shader knows how to interpret it
    // simple eg. if you have a vertex with position, normal and texture coordinates
    // the declaration would be something like "position, normal, texcoord"
    // and the shader would know that the first 12 bytes are the position
    // the next 12 bytes are the normal and the last 8 bytes are the texcoord
    decl_id: u32,

    // vertex shader ID. TODO: understand how this is used in the rendering process. FILE: lwPrimitive.cpp, FN: ExtractGeomObjInfo
    vs_id: u32,

    // does not seem to be used for anything, it is set to INVALID_INDEX. FILE: lwlTypes.h, FN: lwRenderCtrlCreateInfo_Construct
    ps_id: u32,
}

#[binrw]
pub struct StateCtrl {
    // 8 flags that determine the state of an object in the scene/game world
    // possible values -
    // FLAG           -          POSITION    -     VALUE   -     Use
    // STATE_VISIBLE           - 0           -     0/1     -     Used to determine if the object is visible or not
    // STATE_ENABLE            - 1           -     0/1     -     Used to determine if the object is enabled for updates and interactions
    // STATE_UPDATETRANSPSTATE - 3           -     0/1     -     Used to determine if the object's transparency state should be updated. Check _UpdateTransparentState in lwNodeObject.cpp
    // STATE_TRANSPARENT       - 4           -     0/1     -     Used to determine if the object is transparent or not
    // STATE_FRAMECULLING      - 5           -     0/1     -     Used to determine if an object should be culled (not rendered) if it is outside the player's camera view
    // STATE_INVALID           - 6           -     0/1     -     Invalid/uninitialized state
    _state_seq: [u8; 8],
}

#[binrw]
pub struct CharGeoModelInfoHeader {
    id: u32,
    parent_id: u32,
    _type: u32,
    mat_local: LwMatrix44,
    rcci: RenderCtrlCreateInfo,
    state_ctrl: StateCtrl,

    // total memory size occupied by the material textures (mtl_sql) associated with the object
    // a material is a set of properties that determine how an object is rendered
    // it can include things like color, texture, transparency, shininess etc.
    // the material textures are the textures that are used to define these properties
    // eg. a texture for the color, a texture for the normal map, a texture for the specular map etc.
    // the material textures are stored in a separate file and are loaded into memory when the object is loaded
    // FILE: lwExpObj.cpp, struct: LwGeomObjInfo
    mtl_size: u32,

    // total memory of the geometric mesh data associated with the object
    // it would include things like vertex data (positions, normals, uvs), index data (how the vertices are connected to form triangles), bone weights etc.
    // calculation done by a->Mesh_size = lwMeshInfo_GetDataSize(&a->mesh) - FILE: lwExpObj.cpp, FN: lwMeshInfo_GetDataSize
    // FILE: lwExpObj.cpp, struct: LwGeomObjInfo
    mesh_size: u32,

    // total memory of helper data like dummy_seq, box_seq, mesh_seq, bbox_seq, bsphere_seq
    // struct of helper data can be found in lwExpObj.h, struct: lwHelperInfo
    helper_size: u32,

    // total memory of animation data (bones, keyframes, matrices etc.)
    anim_size: u32,
}

// the LGO model structure
// FILE: lwExpObj.cpp, FN: lwGeomObjInfo::Load
#[binrw]
pub struct CharacterGeometricModel {
    version: u32,
    header: CharGeoModelInfoHeader,

    #[br(if(version == EXP_OBJ_VERSION_0_0_0_0))]
    old_version: u32,

    #[br(if(header.mesh_size > 0))]
    material_num: u32,

    #[br(if(header.mtl_size > 0))]
    #[br(count = material_num, args{
        inner: (version, material_num,)
    })]
    material_seq: Option<Vec<CharMaterialTextureInfo>>,

    #[br(if(header.mesh_size > 0))]
    #[br(args(version,))]
    mesh_info: Option<CharacterMeshInfo>,

    #[br(if(header.helper_size > 0))]
    helper_data: Option<HelperData>,
}

impl CharacterGeometricModel {
    pub fn get_gltf_mesh_primitive(
        &self,
        fields_to_aggregate: &mut GLTFFieldsToAggregate,
    ) -> gltf::mesh::Primitive {
        let mesh_info = self.mesh_info.as_ref().unwrap();
        mesh_info.get_gltf_primitive(fields_to_aggregate, &self.material_seq)
    }
    // pub fn to_gltf(&self, anim: LwBoneFile, fields_to_aggregate: &mut GLTFFieldsToAggregate) -> gltf::Root {
    //     let (skin, nodes) = anim.to_gltf_skin_and_nodes(fields_to_aggregate);
    //     anim.to_gltf_animations_and_sampler(fields_to_aggregate);

    //     let root = gltf::Root {
    //         nodes,
    //         skins: vec![skin],
    //         images: fields_to_aggregate.image,
    //         scene: Some(Index::new(0)),
    //         accessors: fields_to_aggregate.accessor,
    //         buffers: fields_to_aggregate.buffer,
    //         buffer_views: fields_to_aggregate.buffer_view,
    //         textures: fields_to_aggregate.texture,
    //         materials: fields_to_aggregate.material,
    //         samplers: fields_to_aggregate.sampler,
    //         animations: fields_to_aggregate.animation,
    //         ..Default::default()
    //     };

    //     let file = File::create("test.gltf").unwrap();
    //     let writer = BufWriter::new(file);
    //     json::serialize::to_writer_pretty(writer, &root).unwrap();

    //     root
    // }

    pub fn from_file(file_path: PathBuf) -> anyhow::Result<Self> {
        let file = File::open(file_path)?;
        let mut reader = std::io::BufReader::new(file);
        let geom: CharacterGeometricModel =
            BinRead::read_options(&mut reader, binrw::Endian::Little, ())?;
        Ok(geom)
    }

    pub fn from_gltf(
        gltf: &Document,
        buffers: &Vec<buffer::Data>,
        images: &Vec<image::Data>,
    ) -> anyhow::Result<Self> {
        unimplemented!()
    }
}

#[cfg(test)]
mod tests {

    use crate::animation::character::LwBoneFile;

    use super::*;

    // TODO: test old file versions

    #[test]
    fn it_parses_geom_file() {
        let data = include_bytes!("../../test_artifacts/0909000000.lgo");
        let mut reader = std::io::Cursor::new(data);

        let geom: CharacterGeometricModel =
            BinRead::read_options(&mut reader, binrw::Endian::Little, ()).unwrap();

        assert_eq!(geom.version, EXP_OBJ_VERSION_1_0_0_5);

        let mesh = geom.mesh_info.unwrap();
        assert_eq!(mesh.header.fvf, 4376);
        assert_eq!(mesh.header.vertex_num, 1323);
        assert_eq!(mesh.header.vertex_element_num, 6);

        let helper = geom.helper_data.unwrap();
        assert_eq!(helper._type, 32);
        assert_eq!(helper.bsphere_num, 7);
        assert_eq!(helper.bsphere_seq[0].sphere.r, 0.8649084)
    }

    // #[test]
    // fn it_writes_gltf_file() {
    //     let model_data = include_bytes!("../../test_artifacts/0730000000.lgo");
    //     let mut model_reader = std::io::Cursor::new(model_data);

    //     let geom: CharacterGeometricModel =
    //         BinRead::read_options(&mut model_reader, binrw::Endian::Little, ()).unwrap();

    //     let anim_data = include_bytes!("../../test_artifacts/0730.lab");
    //     let mut anim_reader = std::io::Cursor::new(anim_data);

    //     let (tx, rx) = tokio::sync::mpsc::channel::<(String, u8)>(100);

    //     let anim: LwBoneFile = BinRead::read_options(
    //         &mut anim_reader,
    //         binrw::Endian::Little,
    //         ()
    //     )
    //     .unwrap();

    //     geom.to_gltf(anim);
    // }
}
