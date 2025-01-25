use std::collections::{BTreeMap, HashMap};

use crate::d3d::{D3DPrimitiveType, D3DVertexElement9};
use ::gltf::{
    buffer, json::{
        accessor::{ComponentType, GenericComponentType},  image::MimeType, material::{EmissiveFactor, PbrBaseColorFactor, PbrMetallicRoughness, StrengthFactor}, texture, validation::{Checked, USize64, Validate}, Accessor, Index, Material
    }, material::AlphaMode, texture::MagFilter, Semantic
};
use base64::{prelude::BASE64_STANDARD, Engine};
use binrw::{binrw, BinRead, BinWrite};
use gltf::json as gltf;

use super::{
    math::{LwVector2, LwVector3},
    model::{ EXP_OBJ_VERSION, EXP_OBJ_VERSION_0_0_0_0, EXP_OBJ_VERSION_1_0_0_3,
        EXP_OBJ_VERSION_1_0_0_4, LW_MAX_TEXTURESTAGE_NUM,
    },
    texture::{CharMaterialTextureInfo, MaterialTextureInfoTransparencyType, RenderStateAtom, TextureInfo}, GLTFFieldsToAggregate,
};

pub const LW_MESH_RS_NUM: usize = 8;

pub const D3DFVF_RESERVED0: u32 = 0x001;
pub const D3DFVF_POSITION_MASK: u32 = 0x00E;
pub const D3DFVF_XYZ: u32 = 0x002;
pub const D3DFVF_XYZRHW: u32 = 0x004;
pub const D3DFVF_XYZB1: u32 = 0x006;
pub const D3DFVF_XYZB2: u32 = 0x008;
pub const D3DFVF_XYZB3: u32 = 0x00a;
pub const D3DFVF_XYZB4: u32 = 0x00c;
pub const D3DFVF_XYZB5: u32 = 0x00e;

pub const D3DFVF_NORMAL: u32 = 0x010;
pub const D3DFVF_PSIZE: u32 = 0x020;
pub const D3DFVF_DIFFUSE: u32 = 0x040;
pub const D3DFVF_SPECULAR: u32 = 0x080;

pub const D3DFVF_TEXCOUNT_MASK: u32 = 0xf00;
pub const D3DFVF_TEXCOUNT_SHIFT: u32 = 8;
pub const D3DFVF_TEX0: u32 = 0x000;
pub const D3DFVF_TEX1: u32 = 0x100;
pub const D3DFVF_TEX2: u32 = 0x200;
pub const D3DFVF_TEX3: u32 = 0x300;
pub const D3DFVF_TEX4: u32 = 0x400;
pub const D3DFVF_TEX5: u32 = 0x500;
pub const D3DFVF_TEX6: u32 = 0x600;
pub const D3DFVF_TEX7: u32 = 0x700;
pub const D3DFVF_TEX8: u32 = 0x800;

pub const D3DFVF_LASTBETA_UBYTE4: u32 = 0x1000;

pub const D3DFVF_RESERVED2: u32 = 0xE000;

#[derive(Debug, Clone, Default)]
#[binrw]
pub struct CharacterMeshBlendInfo {
    pub indexd: u32,
    pub weight: [f32; 4],
}

#[derive(Debug, Clone)]
#[binrw]
pub struct CharacterMeshSubsetInfo {
    pub primitive_num: u32,
    pub start_index: u32,
    pub vertex_num: u32,
    pub min_index: u32,
}

#[derive(Debug, Clone, Default)]
#[binrw]
pub struct CharacterInfoMeshHeader {
    // the type of vertex data available (positions, normals, texture coordinates etc.)
    // looks like its stored as kind of a bitmask
    // so that you can AND it with the flags to check if a certain type of data is available
    // GLTF: `extras`
    pub fvf: u32,

    // the type of primitive that the mesh is made up of
    // GLTF: `mode`
    pub pt_type: D3DPrimitiveType,

    // number of vertices in the mesh
    // GLTF: handled when populating POSITION
    pub vertex_num: u32,

    // number of indices defining the mesh topology
    // GLTF: handled when populating indices
    pub index_num: u32,
    pub subset_num: u32,
    pub bone_index_num: u32,
    pub bone_infl_factor: u32,
    pub vertex_element_num: u32,

    // not sure what its used for yet
    // GLTF: extras
    pub rs_set: [RenderStateAtom; LW_MESH_RS_NUM],
}

#[derive(Debug, Clone)]
pub struct CharacterMeshInfo {
    pub header: CharacterInfoMeshHeader,

    // 3d positions of the vertices
    // GLTF: attributes.POSITION
    pub vertex_seq: Vec<LwVector3>,

    // normals of the vertices
    // GLTF: attributes.NORMAL
    pub normal_seq: Vec<LwVector3>,

    // texture coordinates of the vertices
    // GLTF: attributes.TEXCOORD_0, attributes.TEXCOORD_1, attributes.TEXCOORD_2, attributes.TEXCOORD_3
    pub texcoord_seq: [Vec<LwVector2>; LW_MAX_TEXTURESTAGE_NUM as usize],

    // vertex colors
    // GLTF: attributes.COLOR_0
    pub vercol_seq: Vec<u32>,

    // indices defining the mesh topology
    // GLTF: indices
    pub index_seq: Vec<u32>,

    // mapping of bone indices to joints
    // GLTF: skins, reference in mesh node
    pub bone_index_seq: Vec<u32>,

    // blend weights and indices for skinning
    // GLTF: attributes.WEIGHTS_0, attributes.JOINTS_0
    pub blend_seq: Vec<CharacterMeshBlendInfo>,

    // subsets define groups of primitives with specific materials
    // each subset corresponds to a glTF primitive
    // GLTF: primitives
    // map start_index and primtiive_num to define the range of indices for each subset
    pub subset_seq: Vec<CharacterMeshSubsetInfo>,

    // not sure what its used for yet
    // GLTF: extras
    pub vertex_element_seq: Vec<D3DVertexElement9>,
}

impl BinRead for CharacterMeshInfo {
    type Args<'a> = (u32,);

    fn read_options<R: std::io::Read + std::io::Seek>(
        reader: &mut R,
        endian: binrw::Endian,
        args: Self::Args<'_>,
    ) -> binrw::BinResult<Self> {
        let mut version = args.0;
        if version == EXP_OBJ_VERSION_0_0_0_0 {
            let old_version = u32::read_options(reader, endian, ())?;
            version = old_version;
        }

        let mut header;
        let mut vertex_element_seq: Vec<D3DVertexElement9> = vec![];
        let mut vertex_seq: Vec<LwVector3> = vec![];
        let mut normal_seq: Vec<LwVector3> = vec![];
        let mut texcoord_seq: [Vec<LwVector2>; LW_MAX_TEXTURESTAGE_NUM as usize] =
            Default::default();
        let mut vercol_seq: Vec<u32> = vec![];
        let mut blend_seq: Vec<CharacterMeshBlendInfo> = vec![];
        let mut bone_index_seq: Vec<u32> = vec![];
        let mut index_seq: Vec<u32> = vec![];
        let mut subset_seq: Vec<CharacterMeshSubsetInfo> = vec![];

        if version > EXP_OBJ_VERSION_1_0_0_4 {
            header = CharacterInfoMeshHeader::read_options(reader, endian, ())?;
            if header.vertex_element_num > 0 {
                for _ in 0..header.vertex_element_num {
                    vertex_element_seq.push(D3DVertexElement9::read_options(reader, endian, ())?);
                }
            }

            if header.vertex_num > 0 {
                for _ in 0..header.vertex_num {
                    vertex_seq.push(LwVector3::read_options(reader, endian, ())?);
                }
            }

            if (header.fvf & D3DFVF_NORMAL) > 0 {
                for _ in 0..header.vertex_num {
                    normal_seq.push(LwVector3::read_options(reader, endian, ())?);
                }
            }

            if (header.fvf & D3DFVF_TEX1) > 0 {
                texcoord_seq[0] = vec![];

                for _ in 0..header.vertex_num {
                    texcoord_seq[0].push(LwVector2::read_options(reader, endian, ())?);
                }
            } else if (header.fvf & D3DFVF_TEX2) > 0 {
                texcoord_seq[0] = vec![];
                texcoord_seq[1] = vec![];

                for _ in 0..header.vertex_num {
                    texcoord_seq[0].push(LwVector2::read_options(reader, endian, ())?);
                }

                for _ in 0..header.vertex_num {
                    texcoord_seq[1].push(LwVector2::read_options(reader, endian, ())?);
                }
            } else if (header.fvf & D3DFVF_TEX3) > 0 {
                texcoord_seq[0] = vec![];
                texcoord_seq[1] = vec![];
                texcoord_seq[2] = vec![];

                for _ in 0..header.vertex_num {
                    texcoord_seq[0].push(LwVector2::read_options(reader, endian, ())?);
                }

                for _ in 0..header.vertex_num {
                    texcoord_seq[1].push(LwVector2::read_options(reader, endian, ())?);
                }

                for _ in 0..header.vertex_num {
                    texcoord_seq[2].push(LwVector2::read_options(reader, endian, ())?);
                }
            } else if (header.fvf & D3DFVF_TEX4) > 0 {
                texcoord_seq[0] = vec![];
                texcoord_seq[1] = vec![];
                texcoord_seq[2] = vec![];
                texcoord_seq[3] = vec![];

                for _ in 0..header.vertex_num {
                    texcoord_seq[0].push(LwVector2::read_options(reader, endian, ())?);
                }

                for _ in 0..header.vertex_num {
                    texcoord_seq[1].push(LwVector2::read_options(reader, endian, ())?);
                }

                for _ in 0..header.vertex_num {
                    texcoord_seq[2].push(LwVector2::read_options(reader, endian, ())?);
                }

                for _ in 0..header.vertex_num {
                    texcoord_seq[3].push(LwVector2::read_options(reader, endian, ())?);
                }
            }

            if (header.fvf & D3DFVF_DIFFUSE) > 0 {
                for _ in 0..header.vertex_num {
                    vercol_seq.push(u32::read_options(reader, endian, ())?);
                }
            }

            if header.bone_index_num > 0 {
                for _ in 0..header.vertex_num {
                    blend_seq.push(CharacterMeshBlendInfo::read_options(reader, endian, ())?);
                }

                for _ in 0..header.bone_index_num {
                    bone_index_seq.push(u32::read_options(reader, endian, ())?);
                }
            }

            if header.index_num > 0 {
                for _ in 0..header.index_num {
                    index_seq.push(u32::read_options(reader, endian, ())?);
                }
            }

            if header.subset_num > 0 {
                for _ in 0..header.subset_num {
                    subset_seq.push(CharacterMeshSubsetInfo::read_options(reader, endian, ())?);
                }
            }

            Ok(CharacterMeshInfo {
                header,
                vertex_seq,
                normal_seq,
                texcoord_seq,
                vercol_seq,
                index_seq,
                bone_index_seq,
                blend_seq,
                subset_seq,
                vertex_element_seq,
            })
        } else {
            Err(binrw::Error::AssertFail {
                pos: 0,
                message: format!("Mesh decoding not implemented for version {}", version),
            })
        }
    }
}

impl BinWrite for CharacterMeshInfo {
    type Args<'a> = (u32,);

    fn write_options<W: std::io::Write>(
        &self,
        writer: &mut W,
        endian: binrw::Endian,
        args: Self::Args<'_>,
    ) -> binrw::BinResult<()> {
        return Ok(());
    }
}

impl CharacterMeshInfo {
    fn get_vertex_position_accessor(
        &self,
        fields_to_aggregate: &mut GLTFFieldsToAggregate,
    ) -> usize {
        let mut vertex_position_buffer_data = vec![];

        let buffer_index = fields_to_aggregate.buffer.len();
        let buffer_view_index = fields_to_aggregate.buffer_view.len();
        let accessor_index = fields_to_aggregate.accessor.len();

        for vertex in &self.vertex_seq {
            vertex_position_buffer_data.extend_from_slice(&vertex.0.x.to_le_bytes());
            vertex_position_buffer_data.extend_from_slice(&vertex.0.y.to_le_bytes());
            vertex_position_buffer_data.extend_from_slice(&vertex.0.z.to_le_bytes());
        }

        let vertex_position_buffer = gltf::Buffer {
            byte_length: USize64(vertex_position_buffer_data.len() as u64),
            extensions: None,
            extras: None,
            name: Some("vertex_position_buffer".to_string()),
            uri: Some(format!(
                "data:application/octet-stream;base64,{}",
                BASE64_STANDARD.encode(&vertex_position_buffer_data)
            )),
        };

        fields_to_aggregate.buffer.push(vertex_position_buffer);

        let vertex_position_buffer_view = gltf::buffer::View {
            buffer: Index::new(buffer_index as u32),
            byte_length: USize64(vertex_position_buffer_data.len() as u64),
            byte_offset: Some(USize64(0)),
            target: Some(gltf::validation::Checked::Valid(
                gltf::buffer::Target::ArrayBuffer,
            )),
            byte_stride: None,
            extensions: None,
            extras: None,
            name: Some("vertex_position_buffer".to_string()),
        };

        fields_to_aggregate
            .buffer_view
            .push(vertex_position_buffer_view);

        let accessor = Accessor {
            buffer_view: Some(Index::new(buffer_view_index as u32)),
            byte_offset: Some(USize64(0)),
            component_type: gltf::validation::Checked::Valid(GenericComponentType(
                ComponentType::F32,
            )),
            count: USize64(self.vertex_seq.len() as u64),
            extensions: None,
            extras: None,
            max: None,
            min: None,
            name: Some("vertex_position_accessor".to_string()),
            type_: gltf::validation::Checked::Valid(gltf::accessor::Type::Vec3),
            normalized: false,
            sparse: None,
        };

        fields_to_aggregate.accessor.push(accessor);
        accessor_index
    }

    fn get_vertex_normal_accessor(&self, fields_to_aggregate: &mut GLTFFieldsToAggregate) -> usize {
        let mut vertex_normal_buffer_data = vec![];

        let buffer_index = fields_to_aggregate.buffer.len();
        let buffer_view_index = fields_to_aggregate.buffer_view.len();
        let accessor_index = fields_to_aggregate.accessor.len();

        for normal in &self.normal_seq {
            vertex_normal_buffer_data.extend_from_slice(&normal.0.x.to_le_bytes());
            vertex_normal_buffer_data.extend_from_slice(&normal.0.y.to_le_bytes());
            vertex_normal_buffer_data.extend_from_slice(&normal.0.z.to_le_bytes());
        }

        let vertex_normal_buffer = gltf::Buffer {
            byte_length: USize64(vertex_normal_buffer_data.len() as u64),
            extensions: None,
            extras: None,
            name: Some("vertex_normal_buffer".to_string()),
            uri: Some(format!(
                "data:application/octet-stream;base64,{}",
                BASE64_STANDARD.encode(&vertex_normal_buffer_data)
            )),
        };

        fields_to_aggregate.buffer.push(vertex_normal_buffer);

        let vertex_normal_buffer_view = gltf::buffer::View {
            buffer: Index::new(buffer_index as u32),
            byte_length: USize64(vertex_normal_buffer_data.len() as u64),
            byte_offset: Some(USize64(0)),
            target: Some(gltf::validation::Checked::Valid(
                gltf::buffer::Target::ArrayBuffer,
            )),
            byte_stride: None,
            extensions: None,
            extras: None,
            name: Some("vertex_normal_buffer".to_string()),
        };

        fields_to_aggregate
            .buffer_view
            .push(vertex_normal_buffer_view);

        let vertex_normal_accessor = Accessor {
            buffer_view: Some(Index::new(buffer_view_index as u32)),
            byte_offset: Some(USize64(0)),
            component_type: gltf::validation::Checked::Valid(GenericComponentType(
                ComponentType::F32,
            )),
            count: USize64(self.normal_seq.len() as u64),
            extensions: None,
            extras: None,
            max: None,
            min: None,
            name: Some("vertex_normal_accessor".to_string()),
            type_: gltf::validation::Checked::Valid(gltf::accessor::Type::Vec3),
            normalized: false,
            sparse: None,
        };

        fields_to_aggregate.accessor.push(vertex_normal_accessor);

        accessor_index
    }

    fn get_vertex_texcoord_accessor(
        &self,
        fields_to_aggregate: &mut GLTFFieldsToAggregate,
        texcoord_index: usize,
    ) -> usize {
        let mut texcoord_buffer_data = vec![];

        for texcoord in &self.texcoord_seq[texcoord_index] {
            texcoord_buffer_data.extend_from_slice(&texcoord.0.x.to_le_bytes());
            texcoord_buffer_data.extend_from_slice(&texcoord.0.y.to_le_bytes());
        }

        let buffer_index = fields_to_aggregate.buffer.len();
        let buffer_view_index = fields_to_aggregate.buffer_view.len();
        let accessor_index = fields_to_aggregate.accessor.len();

        let texcoord_buffer = gltf::Buffer {
            byte_length: USize64(texcoord_buffer_data.len() as u64),
            extensions: None,
            extras: None,
            name: Some("texcoord_buffer".to_string()),
            uri: Some(format!(
                "data:application/octet-stream;base64,{}",
                BASE64_STANDARD.encode(&texcoord_buffer_data)
            )),
        };

        fields_to_aggregate.buffer.push(texcoord_buffer);

        let texcoord_buffer_view = gltf::buffer::View {
            buffer: Index::new(buffer_index as u32),
            byte_length: USize64(texcoord_buffer_data.len() as u64),
            byte_offset: Some(USize64(0)),
            target: Some(gltf::validation::Checked::Valid(
                gltf::buffer::Target::ArrayBuffer,
            )),
            byte_stride: None,
            extensions: None,
            extras: None,
            name: Some("texcoord_buffer".to_string()),
        };

        fields_to_aggregate.buffer_view.push(texcoord_buffer_view);

        let texcoord_accessor = Accessor {
            buffer_view: Some(Index::new(buffer_view_index as u32)),
            byte_offset: Some(USize64(0)),
            component_type: gltf::validation::Checked::Valid(GenericComponentType(
                ComponentType::F32,
            )),
            count: USize64(self.texcoord_seq[texcoord_index].len() as u64),
            extensions: None,
            extras: None,
            max: None,
            min: None,
            name: Some("texcoord_accessor".to_string()),
            type_: gltf::validation::Checked::Valid(gltf::accessor::Type::Vec2),
            normalized: false,
            sparse: None,
        };

        fields_to_aggregate.accessor.push(texcoord_accessor);

        accessor_index
    }

    fn get_vertex_index_accessor(&self, fields_to_aggregate: &mut GLTFFieldsToAggregate) -> usize {
        let mut indices_buffer_data = vec![];
        let buffer_index = fields_to_aggregate.buffer.len();
        let buffer_view_index = fields_to_aggregate.buffer_view.len();
        let accessor_index = fields_to_aggregate.accessor.len();

        for index in &self.index_seq {
            indices_buffer_data.extend_from_slice(&index.to_le_bytes());
        }

        let indices_buffer = gltf::Buffer {
            byte_length: USize64(indices_buffer_data.len() as u64),
            extensions: None,
            extras: None,
            name: Some("indices_buffer".to_string()),
            uri: Some(format!(
                "data:application/octet-stream;base64,{}",
                BASE64_STANDARD.encode(&indices_buffer_data)
            )),
        };

        fields_to_aggregate.buffer.push(indices_buffer);

        let indices_buffer_view = gltf::buffer::View {
            buffer: Index::new(buffer_index as u32),
            byte_length: USize64(indices_buffer_data.len() as u64),
            byte_offset: Some(USize64(0)),
            target: Some(gltf::validation::Checked::Valid(
                gltf::buffer::Target::ElementArrayBuffer,
            )),
            byte_stride: None,
            extensions: None,
            extras: None,
            name: Some("indices_buffer".to_string()),
        };

        fields_to_aggregate.buffer_view.push(indices_buffer_view);

        let indices_accessor = Accessor {
            buffer_view: Some(Index::new(buffer_view_index as u32)),
            byte_offset: Some(USize64(0)),
            component_type: gltf::validation::Checked::Valid(GenericComponentType(
                ComponentType::U32,
            )),
            count: USize64(self.index_seq.len() as u64),
            extensions: None,
            extras: None,
            max: None,
            min: None,
            name: Some("indices_accessor".to_string()),
            normalized: false,
            sparse: None,
            type_: gltf::validation::Checked::Valid(gltf::accessor::Type::Scalar),
        };

        fields_to_aggregate.accessor.push(indices_accessor);

        accessor_index
    }

    fn get_vertex_color_accessor(&self, fields_to_aggregate: &mut GLTFFieldsToAggregate) -> usize {
        let mut vertex_color_buffer_data = vec![];
        let buffer_index = fields_to_aggregate.buffer.len();
        let buffer_view_index = fields_to_aggregate.buffer_view.len();
        let accessor_index = fields_to_aggregate.accessor.len();

        for color in &self.vercol_seq {
            let r = (color & 0xFF) as f32 / 255.0;
            let g = ((color >> 8) & 0xFF) as f32 / 255.0;
            let b = ((color >> 16) & 0xFF) as f32 / 255.0;
            let a = ((color >> 24) & 0xFF) as f32 / 255.0;

            vertex_color_buffer_data.extend_from_slice(&r.to_le_bytes());
            vertex_color_buffer_data.extend_from_slice(&g.to_le_bytes());
            vertex_color_buffer_data.extend_from_slice(&b.to_le_bytes());
            vertex_color_buffer_data.extend_from_slice(&a.to_le_bytes());
        }

        let vertex_color_buffer = gltf::Buffer {
            byte_length: USize64(vertex_color_buffer_data.len() as u64),
            extensions: None,
            extras: None,
            name: Some("vertex_color_buffer".to_string()),
            uri: Some(format!(
                "data:application/octet-stream;base64,{}",
                BASE64_STANDARD.encode(&vertex_color_buffer_data)
            )),
        };

        fields_to_aggregate.buffer.push(vertex_color_buffer);

        let vertex_color_buffer_view = gltf::buffer::View {
            buffer: Index::new(buffer_index as u32),
            byte_length: USize64(vertex_color_buffer_data.len() as u64),
            byte_offset: Some(USize64(0)),
            target: Some(gltf::validation::Checked::Valid(
                gltf::buffer::Target::ArrayBuffer,
            )),
            byte_stride: None,
            extensions: None,
            extras: None,
            name: Some("vertex_color_buffer".to_string()),
        };

        fields_to_aggregate
            .buffer_view
            .push(vertex_color_buffer_view);

        let vertex_color_accessor = Accessor {
            buffer_view: Some(Index::new(buffer_view_index as u32)),
            byte_offset: Some(USize64(0)),
            component_type: gltf::validation::Checked::Valid(GenericComponentType(
                ComponentType::F32,
            )),
            count: USize64(self.vercol_seq.len() as u64),
            extensions: None,
            extras: None,
            max: None,
            min: None,
            name: Some("vertex_color_accessor".to_string()),
            type_: gltf::validation::Checked::Valid(gltf::accessor::Type::Vec4),
            normalized: false,
            sparse: None,
        };

        fields_to_aggregate.accessor.push(vertex_color_accessor);

        accessor_index
    }

    fn get_joint_and_weight_accessors(
        &self,
        fields_to_aggregate: &mut GLTFFieldsToAggregate,
    ) -> (usize, usize) {
        fn decode_indexd(indexd: u32) -> [u8; 4] {
            [
                (indexd & 0xFF) as u8,
                ((indexd >> 8) & 0xFF) as u8,
                ((indexd >> 16) & 0xFF) as u8,
                ((indexd >> 24) & 0xFF) as u8,
            ]
        }

        let (joint_indices, weights): (Vec<[u16; 4]>, Vec<[f32; 4]>) = self
            .blend_seq
            .iter()
            .map(|blend| {
                let indices = decode_indexd(blend.indexd);
                let joint_indices =
                    indices.map(|idx| *self.bone_index_seq.get(idx as usize).unwrap_or(&0) as u16);
                let weights = blend.weight;

                (joint_indices, weights)
            })
            .unzip();

        let mut joint_indices_buffer_data = vec![];
        let mut weights_buffer_data = vec![];

        let mut vertex_num = 0;

        for indices in &joint_indices {
            vertex_num += 1;
            joint_indices_buffer_data.extend_from_slice(&indices[0].to_le_bytes());
            joint_indices_buffer_data.extend_from_slice(&indices[1].to_le_bytes());
            joint_indices_buffer_data.extend_from_slice(&indices[2].to_le_bytes());
            joint_indices_buffer_data.extend_from_slice(&indices[3].to_le_bytes());
        }

        vertex_num = 0;
        for weight in &weights {
            vertex_num += 1;
            weights_buffer_data.extend_from_slice(&weight[0].to_le_bytes());
            weights_buffer_data.extend_from_slice(&weight[1].to_le_bytes());
            weights_buffer_data.extend_from_slice(&weight[2].to_le_bytes());
            weights_buffer_data.extend_from_slice(&weight[3].to_le_bytes());
        }

        let joint_indices_buffer_index = fields_to_aggregate.buffer.len();
        let joint_indices_buffer_view_index = fields_to_aggregate.buffer_view.len();
        let joint_indices_accessor_index = fields_to_aggregate.accessor.len();

        let joint_indices_buffer = gltf::Buffer {
            byte_length: USize64(joint_indices_buffer_data.len() as u64),
            extensions: None,
            extras: None,
            name: Some("joint_indices_buffer".to_string()),
            uri: Some(format!(
                "data:application/octet-stream;base64,{}",
                BASE64_STANDARD.encode(&joint_indices_buffer_data)
            )),
        };

        fields_to_aggregate.buffer.push(joint_indices_buffer);

        let joint_indices_buffer_view = gltf::buffer::View {
            buffer: Index::new(joint_indices_buffer_index as u32),
            byte_length: USize64(joint_indices_buffer_data.len() as u64),
            byte_offset: Some(USize64(0)),
            target: Some(gltf::validation::Checked::Valid(
                gltf::buffer::Target::ArrayBuffer,
            )),
            byte_stride: None,
            extensions: None,
            extras: None,
            name: Some("joint_indices_buffer".to_string()),
        };

        fields_to_aggregate
            .buffer_view
            .push(joint_indices_buffer_view);

        let joint_indices_accessor = Accessor {
            buffer_view: Some(Index::new(joint_indices_buffer_view_index as u32)),
            byte_offset: Some(USize64(0)),
            component_type: gltf::validation::Checked::Valid(GenericComponentType(
                ComponentType::U16,
            )),
            count: USize64(joint_indices.len() as u64),
            extensions: None,
            extras: None,
            max: None,
            min: None,
            name: Some("joint_indices_accessor".to_string()),
            type_: gltf::validation::Checked::Valid(gltf::accessor::Type::Vec4),
            normalized: false,
            sparse: None,
        };

        fields_to_aggregate.accessor.push(joint_indices_accessor);

        let weights_buffer_index = fields_to_aggregate.buffer.len();
        let weights_buffer_view_index = fields_to_aggregate.buffer_view.len();
        let weights_accessor_index = fields_to_aggregate.accessor.len();

        let weights_buffer = gltf::Buffer {
            byte_length: USize64(weights_buffer_data.len() as u64),
            extensions: None,
            extras: None,
            name: Some("weights_buffer".to_string()),
            uri: Some(format!(
                "data:application/octet-stream;base64,{}",
                BASE64_STANDARD.encode(&weights_buffer_data)
            )),
        };

        fields_to_aggregate.buffer.push(weights_buffer);

        let weights_buffer_view = gltf::buffer::View {
            buffer: Index::new(weights_buffer_index as u32),
            byte_length: USize64(weights_buffer_data.len() as u64),
            byte_offset: Some(USize64(0)),
            target: Some(gltf::validation::Checked::Valid(
                gltf::buffer::Target::ArrayBuffer,
            )),
            byte_stride: None,
            extensions: None,
            extras: None,
            name: Some("weights_buffer".to_string()),
        };

        fields_to_aggregate.buffer_view.push(weights_buffer_view);

        let weights_accessor = Accessor {
            buffer_view: Some(Index::new(weights_buffer_view_index as u32)),
            byte_offset: Some(USize64(0)),
            component_type: gltf::validation::Checked::Valid(GenericComponentType(
                ComponentType::F32,
            )),
            count: USize64(weights.len() as u64),
            extensions: None,
            extras: None,
            max: None,
            min: None,
            name: Some("weights_accessor".to_string()),
            type_: gltf::validation::Checked::Valid(gltf::accessor::Type::Vec4),
            normalized: false,
            sparse: None,
        };

        fields_to_aggregate.accessor.push(weights_accessor);

        (joint_indices_accessor_index, weights_accessor_index)
    }

    fn get_material_accessor(&self, fields_to_aggregate: &mut GLTFFieldsToAggregate, materials: &Option<Vec<CharMaterialTextureInfo>>) -> usize {
        let material_seq = &materials.as_ref().unwrap()[0];
        let texture_info = &material_seq.tex_seq[0];
        let mut file_name = String::new();
        for i in 0..texture_info.file_name.len() {
            if texture_info.file_name[i] == b'\0' || texture_info.file_name[i] == b'.' {
                break;
            }

            file_name += core::str::from_utf8(&[texture_info.file_name[i]]).unwrap();
        }

        file_name += ".png";
        let image_file = "../../../../../../mnt/d/EA 1.0.1/texture/character/".to_string() + &file_name;
        println!("texture_file: {}", image_file);
        let image_file_as_bytes = std::fs::read(image_file).unwrap();
        let image_as_data_uri = format!("data:image/png;base64,{}", BASE64_STANDARD.encode(&image_file_as_bytes));

        let image = gltf::Image{
            name: Some("image".to_string()),
            buffer_view: None,
            extensions: None,
            mime_type: Some(MimeType("image/png".to_string())),
            extras: None,
            uri: Some(image_as_data_uri),
        };

        let image_index = fields_to_aggregate.image.len();
        fields_to_aggregate.image.push(image);

        let sampler = gltf::texture::Sampler{
            mag_filter: Some(Checked::Valid(MagFilter::Linear)),
            min_filter: Some(Checked::Valid(texture::MinFilter::LinearMipmapLinear)),
            wrap_s: Checked::Valid(texture::WrappingMode::Repeat),
            wrap_t: Checked::Valid(texture::WrappingMode::Repeat),
            ..Default::default()
        };

        let sampler_index = fields_to_aggregate.sampler.len();
        fields_to_aggregate.sampler.push(sampler);

        let texture = gltf::Texture{
            name: Some("texture".to_string()),
            sampler: Some(Index::new(sampler_index as u32)),
            source: Index::new(image_index as u32),
            extensions: None,
            extras: None,
        };

        let texture_index = fields_to_aggregate.texture.len();
        fields_to_aggregate.texture.push(texture);

        let emi = material_seq.material.emi.as_ref().unwrap();

        let material = gltf::Material{
            alpha_mode: Checked::Valid(
                match material_seq.transp_type {
                    MaterialTextureInfoTransparencyType::Filter => AlphaMode::Opaque,
                    MaterialTextureInfoTransparencyType::Additive => AlphaMode::Blend,
                    MaterialTextureInfoTransparencyType::Additive1 => AlphaMode::Blend,
                    MaterialTextureInfoTransparencyType::Additive2 => AlphaMode::Blend,
                    MaterialTextureInfoTransparencyType::Additive3 => AlphaMode::Blend,
                    MaterialTextureInfoTransparencyType::Subtractive => AlphaMode::Blend,
                    MaterialTextureInfoTransparencyType::Subtractive1 => AlphaMode::Blend,
                    MaterialTextureInfoTransparencyType::Subtractive2 => AlphaMode::Blend,
                    MaterialTextureInfoTransparencyType::Subtractive3 => AlphaMode::Blend,
                },
            ),
            pbr_metallic_roughness: PbrMetallicRoughness{
                base_color_factor: PbrBaseColorFactor(material_seq.material.dif.to_slice()),
                base_color_texture: Some(texture::Info{
                    index: Index::new(texture_index as u32),
                    tex_coord: 0,
                    extensions: None,
                    extras: None,
                }),
                metallic_factor: StrengthFactor(0.0),
                roughness_factor: StrengthFactor(0.0),
                metallic_roughness_texture: None,
                extensions: None,
                extras: None,
            },
            emissive_factor: EmissiveFactor(
                [emi.r, emi.g, emi.b],
            ),
            ..Default::default()
        };

        let material_index = fields_to_aggregate.material.len();
        fields_to_aggregate.material.push(material);

        material_index
    }

    fn get_primitive(
        &self,
        fields_to_aggregate: &mut GLTFFieldsToAggregate,
        materials: &Option<Vec<CharMaterialTextureInfo>>,
    ) -> gltf::mesh::Primitive {
        let vertex_position_accessor_index = self.get_vertex_position_accessor(fields_to_aggregate);
        let vertex_normal_accessor_index = self.get_vertex_normal_accessor(fields_to_aggregate);
        let vertex_indices_accessor_index = self.get_vertex_index_accessor(fields_to_aggregate);

        let material_index = self.get_material_accessor(fields_to_aggregate, materials);
        let mode = match &self.header.pt_type {
            D3DPrimitiveType::TriangleList => gltf::mesh::Mode::Triangles,
            D3DPrimitiveType::TriangleStrip => gltf::mesh::Mode::TriangleStrip,
            D3DPrimitiveType::TriangleFan => gltf::mesh::Mode::TriangleFan,
            D3DPrimitiveType::LineList => gltf::mesh::Mode::Lines,
            D3DPrimitiveType::LineStrip => gltf::mesh::Mode::LineStrip,
            D3DPrimitiveType::PointList => gltf::mesh::Mode::Points,

            _ => gltf::mesh::Mode::Triangles,
        };

        let mut attributes = BTreeMap::from([
            (
                Checked::Valid(Semantic::Positions),
                Index::new(vertex_position_accessor_index as u32),
            ),
            (
                Checked::Valid(Semantic::Normals),
                Index::new(vertex_normal_accessor_index as u32),
            ),
        ]);

        if !self.vercol_seq.is_empty() {
            attributes.insert(
                Checked::Valid(Semantic::Colors(0)),
                Index::new(self.get_vertex_color_accessor(fields_to_aggregate) as u32),
            );
        }

        for i in 0..self.texcoord_seq.len() {
            if self.texcoord_seq[i].is_empty() {
                continue;
            }

            attributes.insert(
                Checked::Valid(Semantic::TexCoords(i as u32)),
                Index::new(self.get_vertex_texcoord_accessor(fields_to_aggregate, i) as u32),
            );
        }

        let (joint_indices_accessor_index, weights_accessor_index) =
            self.get_joint_and_weight_accessors(fields_to_aggregate);

        attributes.insert(
            Checked::Valid(Semantic::Joints(0)),
            Index::new(joint_indices_accessor_index as u32),
        );

        attributes.insert(
            Checked::Valid(Semantic::Weights(0)),
            Index::new(weights_accessor_index as u32),
        );

        gltf::mesh::Primitive {
            attributes,
            extensions: None,
            extras: None,
            indices: Some(Index::new(vertex_indices_accessor_index as u32)),
            material: Some(Index::new(material_index as u32)),
            mode: Checked::Valid(mode),
            targets: None,
        }
    }

    pub fn get_gltf_primitive(&self, fields_to_aggregate: &mut GLTFFieldsToAggregate, materials: &Option<Vec<CharMaterialTextureInfo>>) -> gltf::mesh::Primitive {
        self.get_primitive(fields_to_aggregate, materials)
    }

}
