use std::{
    ffi::c_void,
    fs::File,
    io::BufWriter,
    path::{Path, PathBuf},
    vec,
};

use crate::{
    animation::character::{LwBoneFile, LW_INVALID_INDEX, LW_MAX_NAME},
    character::{helper::BoundingSphereInfo, mesh::CharacterInfoMeshHeader, texture},
    d3d::{D3DBlend, D3DCmpFunc, D3DFormat, D3DPool, D3DRenderStateType},
    math::{self, LwMatrix44, LwSphere, LwVector3},
};
use ::gltf::{
    buffer, image,
    json::{self, scene::UnitQuaternion, Index, Node, Scene},
    Document,
};
use base64::{prelude::BASE64_STANDARD, Engine};
use binrw::{binrw, BinRead, BinWrite, Error, NullString};
use cgmath::{Matrix4, SquareMatrix, Vector3};
use gltf::json as gltf;
use gltf::Texture;
use serde::{Deserialize, Serialize};
use serde_json::{json, value::RawValue};

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

pub const LW_RENDERCTRL_VS_FIXEDFUNCTION: u32 = 1;
pub const LW_RENDERCTRL_VS_VERTEXBLEND: u32 = 2;
pub const LW_RENDERCTRL_VS_VERTEXBLEND_DX9: u32 = 3;
pub const LW_RENDERCTRL_VS_USER: u32 = 0x100;
pub const LW_RENDERCTRL_VS_INVALID: u32 = 0xffffffff;

#[repr(u32)]
#[derive(Debug, Default, Copy, Clone)]
#[binrw]
#[br(repr = u32)]
#[bw(repr = u32)]
pub enum GeomObjType {
    #[default]
    Generic = 0,

    BB = 1,
    BB2 = 2,
}

#[derive(Debug, Default, Copy, Clone)]
#[binrw]
pub struct RenderStateValue {
    pub state: u32,
    pub value: u32,
}

/// Matches lwRenderStateSetTemplate in the client source.
/// SET_SIZE and SEQUENCE_SIZE are compile-time constants in C++ (not stored in the binary).
#[derive(Debug, Clone)]
#[binrw]
pub struct RenderStateSetTemplate<const SET_SIZE: usize, const SEQ_SIZE: usize> {
    pub rsv_seq: [[RenderStateValue; SEQ_SIZE]; SET_SIZE],
}

impl<const SET_SIZE: usize, const SEQ_SIZE: usize> RenderStateSetTemplate<SET_SIZE, SEQ_SIZE> {
    pub fn new() -> Self {
        let rsv_seq = [[RenderStateValue::default(); SEQ_SIZE]; SET_SIZE];
        Self { rsv_seq }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
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
    pub ctrl_id: u32,

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
    pub decl_id: u32,

    // vertex shader ID. TODO: understand how this is used in the rendering process. FILE: lwPrimitive.cpp, FN: ExtractGeomObjInfo
    pub vs_id: u32,

    // does not seem to be used for anything, it is set to INVALID_INDEX. FILE: lwlTypes.h, FN: lwRenderCtrlCreateInfo_Construct
    pub ps_id: u32,
}

#[derive(Serialize, Deserialize, Clone)]
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
    pub _state_seq: [u8; 8],
}

#[binrw]
pub struct CharGeoModelInfoHeader {
    pub id: u32,
    pub parent_id: u32,
    pub _type: u32,
    pub mat_local: LwMatrix44,
    pub rcci: RenderCtrlCreateInfo,
    pub state_ctrl: StateCtrl,

    // total memory size occupied by the material textures (mtl_sql) associated with the object
    // a material is a set of properties that determine how an object is rendered
    // it can include things like color, texture, transparency, shininess etc.
    // the material textures are the textures that are used to define these properties
    // eg. a texture for the color, a texture for the normal map, a texture for the specular map etc.
    // the material textures are stored in a separate file and are loaded into memory when the object is loaded
    // FILE: lwExpObj.cpp, struct: LwGeomObjInfo
    pub mtl_size: u32,

    // total memory of the geometric mesh data associated with the object
    // it would include things like vertex data (positions, normals, uvs), index data (how the vertices are connected to form triangles), bone weights etc.
    // calculation done by a->Mesh_size = lwMeshInfo_GetDataSize(&a->mesh) - FILE: lwExpObj.cpp, FN: lwMeshInfo_GetDataSize
    // FILE: lwExpObj.cpp, struct: LwGeomObjInfo
    pub mesh_size: u32,

    // total memory of helper data like dummy_seq, box_seq, mesh_seq, bbox_seq, bsphere_seq
    // struct of helper data can be found in lwExpObj.h, struct: lwHelperInfo
    pub helper_size: u32,

    // total memory of animation data (bones, keyframes, matrices etc.)
    pub anim_size: u32,
}

// the LGO model structure
// FILE: lwExpObj.cpp, FN: lwGeomObjInfo::Load
#[binrw]
pub struct CharacterGeometricModel {
    pub version: u32,
    pub header: CharGeoModelInfoHeader,

    #[br(if(version == EXP_OBJ_VERSION_0_0_0_0))]
    #[bw(if(*version == EXP_OBJ_VERSION_0_0_0_0))]
    pub old_version: u32,

    #[br(if(header.mesh_size > 0))]
    pub material_num: u32,

    #[br(if(header.mtl_size > 0))]
    #[br(count = material_num, args{
        inner: (version, material_num,)
    })]
    pub material_seq: Option<Vec<CharMaterialTextureInfo>>,

    #[br(if(header.mesh_size > 0))]
    #[br(args(version,))]
    pub mesh_info: Option<CharacterMeshInfo>,

    #[br(if(header.helper_size > 0))]
    pub helper_data: Option<HelperData>,
}

impl CharacterGeometricModel {
    pub fn get_gltf_mesh_primitive(
        &self,
        project_dir: &Path,
        fields_to_aggregate: &mut GLTFFieldsToAggregate,
        y_up: bool,
    ) -> anyhow::Result<gltf::mesh::Primitive> {
        let mesh_info = self.mesh_info.as_ref().unwrap();
        let primitive = mesh_info.get_gltf_primitive(
            project_dir,
            fields_to_aggregate,
            &self.material_seq,
            y_up,
        );

        Ok(primitive)
    }

    /// Get glTF helper nodes (dummy points, bounding spheres, etc.)
    /// The mesh_index parameter associates these helpers with a specific mesh for round-trip support
    pub fn get_gltf_helper_nodes_for_mesh(&self, mesh_index: usize, y_up: bool) -> Vec<gltf::Node> {
        if self.helper_data.is_none() {
            return vec![];
        }

        let helper_data = self.helper_data.as_ref().unwrap();
        let mut nodes = vec![];

        // Dummy points (attachment points for effects, items, etc.)
        for dummy in helper_data.dummy_seq.iter() {
            let mat = if y_up {
                math::z_up_to_y_up_mat4(dummy.mat.to_slice())
            } else {
                dummy.mat.to_slice()
            };
            let mat_local = if y_up {
                math::z_up_to_y_up_mat4(dummy.mat_local.to_slice())
            } else {
                dummy.mat_local.to_slice()
            };
            let mat_local_json = serde_json::to_string(&mat_local).unwrap_or_default();
            let node = gltf::Node {
                camera: None,
                children: None,
                extensions: None,
                matrix: Some(mat),
                mesh: None,
                name: Some(format!("Dummy{}", dummy.id)),
                rotation: None,
                scale: None,
                skin: None,
                translation: None,
                weights: None,
                extras: Some(
                    RawValue::from_string(format!(
                        r#"{{"type":"dummy","id":{},"parent_type":{},"parent_id":{},"mesh_index":{},"mat_local":{}}}"#,
                        dummy.id, dummy.parent_type, dummy.parent_id, mesh_index, mat_local_json
                    ))
                    .unwrap(),
                ),
            };
            nodes.push(node);
        }

        // Bounding spheres
        for bsphere in helper_data.bsphere_seq.iter() {
            let mat = if y_up {
                math::z_up_to_y_up_mat4(bsphere.mat.to_slice())
            } else {
                bsphere.mat.to_slice()
            };
            let center = [
                bsphere.sphere.c.0.x,
                bsphere.sphere.c.0.y,
                bsphere.sphere.c.0.z,
            ];
            let center = if y_up {
                math::z_up_to_y_up_vec3(center)
            } else {
                center
            };
            let node = gltf::Node{
                camera: None,
                children: None,
                extensions: None,
                matrix: Some(mat),
                mesh: None,
                name: Some(format!("BoundingSphere{}", bsphere.id)),
                rotation: None,
                scale: None,
                skin: None,
                translation: None,
                weights: None,
                extras: Some(
                    RawValue::from_string(
                        format!(
                            r#"{{"radius":{},"center":[{},{},{}],"type":"bounding_sphere","id":{},"mesh_index":{}}}"#,
                            bsphere.sphere.r,
                            center[0],
                            center[1],
                            center[2],
                            bsphere.id,
                            mesh_index
                        )
                    ).unwrap()
                ),
            };

            nodes.push(node);
        }

        nodes
    }

    /// Get glTF helper nodes without mesh association (legacy, uses mesh_index 0)
    pub fn get_gltf_helper_nodes(&self) -> Vec<gltf::Node> {
        self.get_gltf_helper_nodes_for_mesh(0, false)
    }

    pub fn from_file(file_path: PathBuf) -> anyhow::Result<Self> {
        use std::io::{Seek, SeekFrom};

        let file = File::open(&file_path).map_err(|e| {
            anyhow::anyhow!("Failed to open LGO file '{}': {}", file_path.display(), e)
        })?;

        let file_size = file.metadata().map(|m| m.len()).unwrap_or(0);

        let mut reader = std::io::BufReader::new(file);

        let geom: CharacterGeometricModel =
            BinRead::read_options(&mut reader, binrw::Endian::Little, ()).map_err(|e| {
                let bytes_read = reader.stream_position().unwrap_or(0);
                anyhow::anyhow!(
                    "Failed to parse LGO file '{}': {}\n\
                     File size: {} bytes, bytes read before error: {} bytes\n\
                     This may indicate a corrupted or truncated file.",
                    file_path.display(),
                    e,
                    file_size,
                    bytes_read
                )
            })?;

        Ok(geom)
    }

    pub fn from_gltf(
        gltf: &Document,
        buffers: &Vec<buffer::Data>,
        images: &Vec<image::Data>,
        model_id: u32,
        bone_file: &crate::animation::character::LwBoneFile,
    ) -> anyhow::Result<Self> {
        let material_seq =
            texture::CharMaterialTextureInfo::from_gltf(gltf, buffers, images, model_id)?;
        let mtl_size = {
            let mut size = 0;
            for material in material_seq.iter() {
                size += std::mem::size_of_val(&material.opacity);
                size += std::mem::size_of_val(&material.transp_type);
                size += std::mem::size_of_val(&material.material);
                size += std::mem::size_of_val(&material.rs_set);
                size += std::mem::size_of_val(&material.tex_seq);
            }

            if size > 0 {
                size += std::mem::size_of::<u32>();
            }
            size
        };
        let mesh = CharacterMeshInfo::from_gltf(gltf, buffers, images, bone_file)?;
        let mut helper_data = HelperData {
            _type: 32,
            bsphere_num: 0,
            bsphere_seq: vec![],
            dummy_num: 0,
            dummy_seq: vec![],
            box_num: 0,
            box_seq: vec![],
            mesh_num: 0,
            mesh_seq: vec![],
            bbox_num: 0,
            bbox_seq: vec![],
        };

        #[derive(Deserialize)]
        struct HelperDataExtras {
            radius: f32,
            id: u32,
            r#type: String,
            center: [f32; 3],
        }

        for node in gltf.nodes() {
            if node.extras().is_some() {
                let extras = node.extras().as_ref().unwrap();
                let extras_data = serde_json::from_str::<HelperDataExtras>(extras.get());
                if extras_data.is_ok() {
                    let extras_data = extras_data.unwrap();
                    match extras_data.r#type.as_str() {
                        "bounding_sphere" => {
                            // Get the full transformation matrix from the node
                            let mat_array: [[f32; 4]; 4] = node.transform().matrix();
                            let mat = LwMatrix44(Matrix4::new(
                                mat_array[0][0],
                                mat_array[0][1],
                                mat_array[0][2],
                                mat_array[0][3],
                                mat_array[1][0],
                                mat_array[1][1],
                                mat_array[1][2],
                                mat_array[1][3],
                                mat_array[2][0],
                                mat_array[2][1],
                                mat_array[2][2],
                                mat_array[2][3],
                                mat_array[3][0],
                                mat_array[3][1],
                                mat_array[3][2],
                                mat_array[3][3],
                            ));

                            helper_data.bsphere_num += 1;
                            helper_data.bsphere_seq.push(BoundingSphereInfo {
                                id: extras_data.id,
                                sphere: LwSphere {
                                    c: LwVector3(Vector3::new(
                                        extras_data.center[0],
                                        extras_data.center[1],
                                        extras_data.center[2],
                                    )),
                                    r: extras_data.radius,
                                },
                                mat,
                            });
                        }
                        "bounding_box" => {}
                        _ => {}
                    };
                }
            }
        }

        let geom_header = CharGeoModelInfoHeader {
            id: 0,
            parent_id: LW_INVALID_INDEX,
            anim_size: 0, // TODO: check if there are any models with animations present, could not find any
            _type: GeomObjType::Generic as u32,
            mat_local: LwMatrix44(Matrix4::identity()),
            rcci: RenderCtrlCreateInfo {
                ctrl_id: LW_RENDERCTRL_VS_VERTEXBLEND,
                decl_id: 12,
                vs_id: 2,
                ps_id: LW_INVALID_INDEX,
            },
            helper_size: 50,
            mtl_size: mtl_size as u32,
            mesh_size: mesh.get_size(),
            state_ctrl: StateCtrl {
                // most default values seem to be "enabled" and "visible"
                // i found a few that were had "transparent" as true as well
                // but not sure how to decide that right now, so will figure that out later
                _state_seq: [1, 1, 0, 0, 0, 0, 0, 0],
            },
        };

        Ok(CharacterGeometricModel {
            version: EXP_OBJ_VERSION_1_0_0_4,
            header: geom_header,
            old_version: 0,
            material_num: 1, // TODO: hardcoding this as 1 for now, need to see how it works for all models
            material_seq: Some(material_seq),
            mesh_info: Some(mesh),
            helper_data: Some(helper_data),
        })
    }

    /// Import a specific primitive from a glTF document as a CharacterGeometricModel
    /// This is used for multi-part models where each primitive becomes a separate LGO file
    pub fn from_gltf_primitive(
        gltf: &Document,
        buffers: &Vec<buffer::Data>,
        images: &Vec<image::Data>,
        model_id: u32,
        bone_file: &crate::animation::character::LwBoneFile,
        primitive_index: usize,
    ) -> anyhow::Result<Self> {
        // For multi-part models, each part gets its own material
        // The material is determined by the primitive's material index
        let material_seq = texture::CharMaterialTextureInfo::from_gltf_primitive(
            gltf,
            buffers,
            images,
            model_id,
            primitive_index,
        )?;

        let mtl_size = {
            let mut size = 0;
            for material in material_seq.iter() {
                size += std::mem::size_of_val(&material.opacity);
                size += std::mem::size_of_val(&material.transp_type);
                size += std::mem::size_of_val(&material.material);
                size += std::mem::size_of_val(&material.rs_set);
                size += std::mem::size_of_val(&material.tex_seq);
            }
            if size > 0 {
                size += std::mem::size_of::<u32>();
            }
            size
        };

        let mesh = super::mesh::CharacterMeshInfo::from_gltf_primitive(
            gltf,
            buffers,
            images,
            bone_file,
            primitive_index,
        )?;

        // Extract helper data for this primitive index (treating primitive index as mesh index)
        let helper_data = Self::extract_helper_data_for_mesh(gltf, primitive_index);

        let geom_header = CharGeoModelInfoHeader {
            id: 0,
            parent_id: LW_INVALID_INDEX,
            anim_size: 0,
            _type: GeomObjType::Generic as u32,
            mat_local: LwMatrix44(Matrix4::identity()),
            rcci: RenderCtrlCreateInfo {
                ctrl_id: LW_RENDERCTRL_VS_VERTEXBLEND,
                decl_id: 12,
                vs_id: 2,
                ps_id: LW_INVALID_INDEX,
            },
            helper_size: 50,
            mtl_size: mtl_size as u32,
            mesh_size: mesh.get_size(),
            state_ctrl: StateCtrl {
                _state_seq: [1, 1, 0, 0, 0, 0, 0, 0],
            },
        };

        Ok(CharacterGeometricModel {
            version: EXP_OBJ_VERSION_1_0_0_4,
            header: geom_header,
            old_version: 0,
            material_num: 1,
            material_seq: Some(material_seq),
            mesh_info: Some(mesh),
            helper_data: Some(helper_data),
        })
    }

    /// Import a specific mesh from a glTF document as a CharacterGeometricModel
    /// This is the preferred method - each mesh becomes a separate LGO file
    /// Each mesh is expected to have exactly one primitive (idiomatic glTF structure)
    pub fn from_gltf_mesh(
        gltf: &Document,
        buffers: &Vec<buffer::Data>,
        images: &Vec<image::Data>,
        model_id: u32,
        bone_file: &crate::animation::character::LwBoneFile,
        mesh_index: usize,
    ) -> anyhow::Result<Self> {
        // Get material from the mesh's first primitive
        let material_seq = texture::CharMaterialTextureInfo::from_gltf_mesh(
            gltf, buffers, images, model_id, mesh_index,
        )?;

        let mtl_size = {
            let mut size = 0;
            for material in material_seq.iter() {
                size += std::mem::size_of_val(&material.opacity);
                size += std::mem::size_of_val(&material.transp_type);
                size += std::mem::size_of_val(&material.material);
                size += std::mem::size_of_val(&material.rs_set);
                size += std::mem::size_of_val(&material.tex_seq);
            }
            if size > 0 {
                size += std::mem::size_of::<u32>();
            }
            size
        };

        let mesh = super::mesh::CharacterMeshInfo::from_gltf_mesh(
            gltf, buffers, images, bone_file, mesh_index,
        )?;

        // Extract helper data (bounding spheres, etc.) for this specific mesh
        let helper_data = Self::extract_helper_data_for_mesh(gltf, mesh_index);

        let geom_header = CharGeoModelInfoHeader {
            id: 0,
            parent_id: LW_INVALID_INDEX,
            anim_size: 0,
            _type: GeomObjType::Generic as u32,
            mat_local: LwMatrix44(Matrix4::identity()),
            rcci: RenderCtrlCreateInfo {
                ctrl_id: LW_RENDERCTRL_VS_VERTEXBLEND,
                decl_id: 12,
                vs_id: 2,
                ps_id: LW_INVALID_INDEX,
            },
            helper_size: 50,
            mtl_size: mtl_size as u32,
            mesh_size: mesh.get_size(),
            state_ctrl: StateCtrl {
                _state_seq: [1, 1, 0, 0, 0, 0, 0, 0],
            },
        };

        Ok(CharacterGeometricModel {
            version: EXP_OBJ_VERSION_1_0_0_4,
            header: geom_header,
            old_version: 0,
            material_num: 1,
            material_seq: Some(material_seq),
            mesh_info: Some(mesh),
            helper_data: Some(helper_data),
        })
    }

    /// Extract helper data (bounding spheres, boxes, etc.) for a specific mesh index
    fn extract_helper_data_for_mesh(gltf: &Document, mesh_index: usize) -> HelperData {
        let mut helper_data = HelperData {
            _type: 32,
            bsphere_num: 0,
            bsphere_seq: vec![],
            dummy_num: 0,
            dummy_seq: vec![],
            box_num: 0,
            box_seq: vec![],
            mesh_num: 0,
            mesh_seq: vec![],
            bbox_num: 0,
            bbox_seq: vec![],
        };

        #[derive(Deserialize)]
        struct HelperDataExtras {
            radius: f32,
            id: u32,
            r#type: String,
            center: [f32; 3],
            #[serde(default)]
            mesh_index: Option<usize>,
        }

        for node in gltf.nodes() {
            if let Some(extras) = node.extras() {
                if let Ok(extras_data) = serde_json::from_str::<HelperDataExtras>(extras.get()) {
                    // Only include helpers that belong to this mesh (or have no mesh_index for backwards compatibility)
                    let belongs_to_mesh = extras_data
                        .mesh_index
                        .map(|idx| idx == mesh_index)
                        .unwrap_or(mesh_index == 0); // Default to mesh 0 for legacy files

                    if !belongs_to_mesh {
                        continue;
                    }

                    match extras_data.r#type.as_str() {
                        "bounding_sphere" => {
                            // Get the full transformation matrix from the node
                            let mat_array: [[f32; 4]; 4] = node.transform().matrix();
                            let mat = LwMatrix44(Matrix4::new(
                                mat_array[0][0],
                                mat_array[0][1],
                                mat_array[0][2],
                                mat_array[0][3],
                                mat_array[1][0],
                                mat_array[1][1],
                                mat_array[1][2],
                                mat_array[1][3],
                                mat_array[2][0],
                                mat_array[2][1],
                                mat_array[2][2],
                                mat_array[2][3],
                                mat_array[3][0],
                                mat_array[3][1],
                                mat_array[3][2],
                                mat_array[3][3],
                            ));

                            helper_data.bsphere_num += 1;
                            helper_data.bsphere_seq.push(BoundingSphereInfo {
                                id: extras_data.id,
                                sphere: LwSphere {
                                    c: LwVector3(Vector3::new(
                                        extras_data.center[0],
                                        extras_data.center[1],
                                        extras_data.center[2],
                                    )),
                                    r: extras_data.radius,
                                },
                                mat,
                            });
                        }
                        "bounding_box" => {
                            // TODO: Add bounding box support if needed
                        }
                        _ => {}
                    }
                }
            }
        }

        helper_data
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
