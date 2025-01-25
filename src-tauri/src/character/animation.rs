use binrw::{binrw, BinRead, BinWrite, VecArgs};
use gltf::json as gltf;

use crate::animation::character::{LwBoneBaseInfo, LwBoneDummyInfo, LwBoneInfoHeader};

use super::{
    math::{LwMatrix43, LwMatrix44, LwQuaternion, LwVector3},
    model::LW_MAX_TEXTURESTAGE_NUM,
    texture::TextureInfo,
};

pub const BONE_KEY_TYPE_MAT43: u32 = 1;
pub const BONE_KEY_TYPE_MAT44: u32 = 2;
pub const BONE_KEY_TYPE_QUAT: u32 = 3;

pub const LW_MAX_SUBSET_NUM: u32 = 16;

#[derive(Debug)]
pub struct LwBoneKeyInfo {
    pub mat43_seq: Option<Vec<LwMatrix43>>,
    pub mat44_seq: Option<Vec<LwMatrix44>>,
    pub pos_seq: Option<Vec<LwVector3>>,
    pub quat_seq: Option<Vec<LwQuaternion>>,
}

impl BinRead for LwBoneKeyInfo {
    type Args<'a> = (u32, u32, u32);

    fn read_options<R: std::io::Read + std::io::Seek>(
        reader: &mut R,
        endian: binrw::Endian,
        args: Self::Args<'_>,
    ) -> binrw::BinResult<Self> {
        let key_type = args.0;
        let frame_num = args.1;
        let parent_id = args.2;

        match key_type {
            BONE_KEY_TYPE_MAT43 => {
                let mat43_seq: Vec<LwMatrix43> = Vec::read_options(
                    reader,
                    endian,
                    binrw::VecArgs {
                        count: frame_num as usize,
                        inner: (),
                    },
                )?;

                Ok(Self {
                    mat43_seq: Some(mat43_seq),
                    mat44_seq: None,
                    pos_seq: None,
                    quat_seq: None,
                })
            }

            BONE_KEY_TYPE_MAT44 => {
                let mat44_seq: Vec<LwMatrix44> = Vec::read_options(
                    reader,
                    endian,
                    binrw::VecArgs {
                        count: frame_num as usize,
                        inner: (),
                    },
                )?;

                Ok(Self {
                    mat43_seq: None,
                    mat44_seq: Some(mat44_seq),
                    pos_seq: None,
                    quat_seq: None,
                })
            }

            BONE_KEY_TYPE_QUAT => {
                let pos_vec: Vec<LwVector3> = Vec::read_options(
                    reader,
                    endian,
                    binrw::VecArgs {
                        count: frame_num as usize,
                        inner: (),
                    },
                )?;

                let quat_vec: Vec<LwQuaternion> = Vec::read_options(
                    reader,
                    endian,
                    binrw::VecArgs {
                        count: frame_num as usize,
                        inner: (),
                    },
                )?;

                Ok(Self {
                    mat43_seq: None,
                    mat44_seq: None,
                    pos_seq: Some(pos_vec),
                    quat_seq: Some(quat_vec),
                })
            }

            _ => Err(binrw::Error::AssertFail {
                pos: 0,
                message: format!("Invalid key type: {}", key_type),
            }),
        }
    }
}

impl BinWrite for LwBoneKeyInfo {
    type Args<'a> = (u32, u32);

    fn write_options<W: std::io::Write>(
        &self,
        writer: &mut W,
        endian: binrw::Endian,
        args: Self::Args<'_>,
    ) -> binrw::BinResult<()> {
        Ok(())
    }
}

#[derive(Debug)]
pub struct AnimDataBone {
    header: LwBoneInfoHeader,
    base_seq: Vec<LwBoneBaseInfo>,
    invmat_seq: Vec<LwMatrix44>,
    dummy_seq: Vec<LwBoneDummyInfo>,
    key_seq: Vec<LwBoneKeyInfo>,
}

impl BinRead for AnimDataBone {
    type Args<'a> = ();

    fn read_options<R: std::io::Read + std::io::Seek>(
        reader: &mut R,
        endian: binrw::Endian,
        args: Self::Args<'_>,
    ) -> binrw::BinResult<Self> {
        let mut bone_data = AnimDataBone {
            header: LwBoneInfoHeader::read_options(reader, endian, ())?,
            base_seq: Vec::new(),
            invmat_seq: Vec::new(),
            dummy_seq: Vec::new(),
            key_seq: Vec::new(),
        };

        bone_data.base_seq = Vec::read_options(
            reader,
            endian,
            VecArgs {
                count: bone_data.header.bone_num as usize,
                inner: (),
            },
        )?;

        bone_data.invmat_seq = Vec::read_options(
            reader,
            endian,
            VecArgs {
                count: bone_data.header.bone_num as usize,
                inner: (),
            },
        )?;

        bone_data.dummy_seq = Vec::read_options(
            reader,
            endian,
            VecArgs {
                count: bone_data.header.dummy_num as usize,
                inner: (),
            },
        )?;

        for i in 0..bone_data.header.bone_num {
            let parent_id = bone_data.base_seq[i as usize].parent_id;
            let key_info = LwBoneKeyInfo::read_options(
                reader,
                endian,
                (
                    bone_data.header.key_type,
                    bone_data.header.frame_num,
                    parent_id,
                ),
            )?;

            bone_data.key_seq.push(key_info);
        }

        Ok(bone_data)
    }
}

#[derive(Debug)]
#[binrw]
pub struct AnimDataMatrix {
    frame_num: u32,

    #[br(count = frame_num)] // TODO: verify count
    mat_seq: Vec<LwMatrix43>,
}

#[derive(Debug)]
#[binrw]
pub struct AnimKeySetFloat {}

#[derive(Debug)]
#[binrw]
pub struct AnimDataMaterialOpacity {
    #[br(ignore)]
    aks_ctrl: Vec<AnimKeySetFloat>,
}

#[derive(Debug)]
#[binrw]
pub struct AnimDataTextureUV {
    frame_num: u32,

    #[br(count = frame_num)]
    mat_seq: Vec<LwMatrix44>,
}

#[derive(Debug)]
#[binrw]
pub struct AnimDataTextureImage {
    data_num: u32,

    #[br(count = data_num)]
    data_seq: Vec<TextureInfo>, // TODO: verify count

    tex_path: [u8; 260],
}

#[derive(Debug)]
pub struct AnimDataInfo {
    anim_bone: Vec<AnimDataBone>,

    anim_mat: Vec<AnimDataMatrix>,

    anim_mtlopac: Vec<[AnimDataMaterialOpacity; LW_MAX_SUBSET_NUM as usize]>,

    anim_tex:
        Vec<[[AnimDataTextureUV; LW_MAX_SUBSET_NUM as usize]; LW_MAX_TEXTURESTAGE_NUM as usize]>,

    anim_img:
        Vec<[[AnimDataTextureImage; LW_MAX_SUBSET_NUM as usize]; LW_MAX_TEXTURESTAGE_NUM as usize]>,
}
