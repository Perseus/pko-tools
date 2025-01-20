use binrw::{binrw, BinRead, BinWrite};

use crate::d3d::{D3DPrimitiveType, D3DVertexElement9};

use super::{
    math::{LwVector2, LwVector3},
    model::{
        EXP_OBJ_VERSION, EXP_OBJ_VERSION_0_0_0_0, EXP_OBJ_VERSION_1_0_0_3, EXP_OBJ_VERSION_1_0_0_4,
        LW_MAX_TEXTURESTAGE_NUM,
    },
    texture::RenderStateAtom,
};

pub const LW_MESH_RS_NUM: usize = 8;
/**
 * #define D3DFVF_RESERVED0        0x001
#define D3DFVF_POSITION_MASK    0x00E
#define D3DFVF_XYZ              0x002
#define D3DFVF_XYZRHW           0x004
#define D3DFVF_XYZB1            0x006
#define D3DFVF_XYZB2            0x008
#define D3DFVF_XYZB3            0x00a
#define D3DFVF_XYZB4            0x00c
#define D3DFVF_XYZB5            0x00e

#define D3DFVF_NORMAL           0x010
#define D3DFVF_PSIZE            0x020
#define D3DFVF_DIFFUSE          0x040
#define D3DFVF_SPECULAR         0x080

#define D3DFVF_TEXCOUNT_MASK    0xf00
#define D3DFVF_TEXCOUNT_SHIFT   8
#define D3DFVF_TEX0             0x000
#define D3DFVF_TEX1             0x100
#define D3DFVF_TEX2             0x200
#define D3DFVF_TEX3             0x300
#define D3DFVF_TEX4             0x400
#define D3DFVF_TEX5             0x500
#define D3DFVF_TEX6             0x600
#define D3DFVF_TEX7             0x700
#define D3DFVF_TEX8             0x800

#define D3DFVF_LASTBETA_UBYTE4  0x1000

#define D3DFVF_RESERVED2        0xE000
 */

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
    pub fvf: u32,
    pub pt_type: D3DPrimitiveType,

    pub vertex_num: u32,
    pub index_num: u32,
    pub subset_num: u32,
    pub bone_index_num: u32,
    pub bone_infl_factor: u32,
    pub vertex_element_num: u32,

    pub rs_set: [RenderStateAtom; LW_MESH_RS_NUM],
}

#[derive(Debug, Clone)]
pub struct CharacterMeshInfo {
    pub header: CharacterInfoMeshHeader,

    pub vertex_seq: Vec<LwVector3>,
    pub normal_seq: Vec<LwVector3>,

    pub texcoord_seq: [Vec<LwVector2>; LW_MAX_TEXTURESTAGE_NUM as usize],

    pub vercol_seq: Vec<u32>,
    pub index_seq: Vec<u32>,
    pub bone_index_seq: Vec<u32>,
    pub blend_seq: Vec<CharacterMeshBlendInfo>,
    pub subset_seq: Vec<CharacterMeshSubsetInfo>,

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
