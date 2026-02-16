use std::io::{Cursor, Seek};

use ::image::{ImageFormat, ImageReader};
use base64::{prelude::BASE64_STANDARD, Engine};
use binrw::{binrw, BinRead, BinWrite, Error};
use gltf::{buffer, Document, Texture};
use image::Rgb;

use serde::{Deserialize, Serialize};

use crate::texture_pipeline::converter::{self, TextureConvertOptions};

use crate::{
    animation::character::{LW_INVALID_INDEX, LW_MAX_NAME},
    d3d::{D3DBlend, D3DCmpFunc, D3DFormat, D3DPool, D3DRenderStateType},
};

use super::model::{
    RenderStateSetTemplate, D3DRS_ALPHAFUNC, D3DRS_ALPHAREF, EXP_OBJ_VERSION_1_0_0_0,
    LW_MAX_TEXTURESTAGE_NUM, LW_MTL_RS_NUM, MTLTEX_VERSION0000, MTLTEX_VERSION0001,
    MTLTEX_VERSION0002,
};

type RenderStateSetMaterial2 = RenderStateSetTemplate<2, 8>;
type TextureStageStateTexture2 = RenderStateSetTemplate<2, 8>;

#[derive(Debug, Copy, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(into = "u32", try_from = "u32")]
#[binrw]
#[br(repr = u32)]
#[bw(repr = u32)]
pub enum MaterialTextureInfoTransparencyType {
    #[default]
    Filter = 0,
    Additive = 1,
    Additive1 = 2,
    Additive2 = 3,
    Additive3 = 4,
    Subtractive = 5,
    Subtractive1 = 6,
    Subtractive2 = 7,
    Subtractive3 = 8,
}

impl From<MaterialTextureInfoTransparencyType> for u32 {
    fn from(v: MaterialTextureInfoTransparencyType) -> u32 {
        v as u32
    }
}

impl TryFrom<u32> for MaterialTextureInfoTransparencyType {
    type Error = String;
    fn try_from(v: u32) -> Result<Self, Self::Error> {
        match v {
            0 => Ok(Self::Filter),
            1 => Ok(Self::Additive),
            2 => Ok(Self::Additive1),
            3 => Ok(Self::Additive2),
            4 => Ok(Self::Additive3),
            5 => Ok(Self::Subtractive),
            6 => Ok(Self::Subtractive1),
            7 => Ok(Self::Subtractive2),
            8 => Ok(Self::Subtractive3),
            _ => Err(format!(
                "Invalid MaterialTextureInfoTransparencyType: {}",
                v
            )),
        }
    }
}

#[repr(u32)]
#[derive(Debug, Copy, Clone, PartialEq, Eq)]
#[binrw]
#[br(repr = u32)]
#[bw(repr = u32)]
pub enum ColorKeyType {
    None = 0,
    Color = 1,
    Pixel = 2,

    InvalidMax = 0xffffffff,
}

#[derive(Serialize, Deserialize, Clone, Copy)]
#[binrw]
pub struct ColorValue4F {
    pub r: f32,
    pub g: f32,
    pub b: f32,
    pub a: f32,
}

impl ColorValue4F {
    pub fn to_slice(&self) -> [f32; 4] {
        [self.r, self.g, self.b, self.a]
    }

    pub fn from_slice(s: &[f32; 4]) -> Self {
        Self {
            r: s[0],
            g: s[1],
            b: s[2],
            a: s[3],
        }
    }
}

#[repr(u32)]
#[derive(Debug, Copy, Clone, PartialEq, Eq)]
#[binrw]
#[br(repr = u32)]
#[bw(repr = u32)]
pub enum TextureType {
    File = 0,
    Size = 1,
    Data = 2,
    Invalid = 0x7FFFFFFF,

    InvalidMax = 0xffffffff,
}

#[derive(Clone)]
#[binrw]
pub struct CharMaterial {
    // diffuse
    // base color of the material when lit by diffuse (direct) light
    // diffuse light scatters evenly across the surface, giving the material its primary visible color
    pub dif: ColorValue4F,

    // ambient light
    // baseline level of brightness of the material when lit by ambient light
    pub amb: ColorValue4F,

    // specular
    // color of the highlights on the material when lit by specular (reflected) light
    pub spe: Option<ColorValue4F>,

    // emissive
    // color of the material when it is self-illuminated
    pub emi: Option<ColorValue4F>,

    // shininess
    // high values produce a small, concentrated highlight
    // low values produce a large, diffused highlight
    pub power: f32,
}

impl CharMaterial {
    pub fn new() -> Self {
        Self {
            dif: ColorValue4F {
                r: 1.0,
                g: 1.0,
                b: 1.0,
                a: 1.0,
            },
            amb: ColorValue4F {
                r: 1.0,
                g: 1.0,
                b: 1.0,
                a: 1.0,
            },
            spe: None,
            emi: None,
            power: 0.0,
        }
    }
}

// render states? dont know what this does yet
#[derive(Default, Copy, Clone, Debug, Serialize, Deserialize)]
#[binrw]
pub struct RenderStateAtom {
    pub state: u32,
    pub value0: u32,
    pub value1: u32,
}

impl RenderStateAtom {
    pub fn new() -> Self {
        Self {
            state: LW_INVALID_INDEX,
            value0: 0,
            value1: 0,
        }
    }
}

#[derive(Debug, Copy, Clone)]
#[binrw]
pub struct LwColorValue4b {
    pub b: u8,
    pub g: u8,
    pub r: u8,
    pub a: u8,
}

impl LwColorValue4b {
    pub fn from_color(color: u32) -> Self {
        Self {
            b: (color & 0xff) as u8,
            g: ((color >> 8) & 0xff) as u8,
            r: ((color >> 16) & 0xff) as u8,
            a: ((color >> 24) & 0xff) as u8,
        }
    }

    pub fn to_color(&self) -> u32 {
        (self.a as u32) << 24 | (self.r as u32) << 16 | (self.g as u32) << 8 | (self.b as u32)
    }
}

#[derive(Debug, Clone)]
#[binrw]
pub struct TextureInfo {
    // texture stage? there seem to be multiple stages in lwIUtil.cpp, FN: lwPrimitiveTexLitA
    // dont fully understand the concept yet
    pub stage: u32,

    // level of texture
    // used to reduce resource utilization by reducing the level of detail the "further" away the object is
    pub level: u32,

    // dont know what this does yet
    pub usage: u32,

    // pixel format for the texture buffers
    // eg. number of bits for each color channel, number of bits for alpha channel etc.
    pub d3d_format: D3DFormat,

    // pool type for the texture buffers
    // describes where data is stored in memory and how it is managed between the CPU and GPU
    pub d3d_pool: D3DPool,

    // whether the data should be "padded" to a certain byte alignment
    // to ensure efficient data access by the CPU/GPU
    // this is done to ensure that we minimize the number of operations being performed
    // when the CPU/GPU is reading/writing data
    pub byte_alignment_flag: u32,

    // source of texture data
    pub _type: TextureType,

    // width and height of the texture
    pub width: u32,
    pub height: u32,

    // color key type
    pub colorkey_type: ColorKeyType,
    pub colorkey: LwColorValue4b,

    pub file_name: [u8; 64],

    pub data: u32,

    pub tss_set: [RenderStateAtom; 8],
}

impl TextureInfo {
    pub fn new() -> Self {
        let tss_set = [RenderStateAtom::new(); 8];

        Self {
            stage: LW_INVALID_INDEX,
            level: 0,
            usage: 0,
            d3d_format: D3DFormat::Unknown,
            d3d_pool: D3DPool::ForceDword,
            byte_alignment_flag: 0,
            // Use InvalidMax (0xffffffff) to match original LGO file format
            // for unused/uninitialized texture slots
            _type: TextureType::InvalidMax,
            width: 0,
            height: 0,
            colorkey_type: ColorKeyType::None,
            colorkey: LwColorValue4b::from_color(0),
            file_name: [0; LW_MAX_NAME],
            tss_set,
            data: 0,
        }
    }
}

/// Matches lwTexInfo_0000 in the client source.
/// Used for MTLTEX_VERSION0000 files (version 0 item models).
#[derive(Debug, Clone)]
#[binrw]
pub struct TextureInfo0000 {
    pub stage: u32,
    pub colorkey_type: ColorKeyType,
    pub colorkey: LwColorValue4b,
    pub format: D3DFormat,
    pub file_name: [u8; 64],
    pub tss_set: TextureStageStateTexture2,
}

/// Matches lwTexInfo_0001 in the client source.
#[derive(Debug, Clone)]
#[binrw]
pub struct TextureInfo0001 {
    stage: u32,
    level: u32,
    usage: u32,
    format: D3DFormat,
    pool: D3DPool,
    byte_alignment_flag: u32,
    _type: TextureType,
    width: u32,
    height: u32,
    colorkey_type: ColorKeyType,
    colorkey: LwColorValue4b,
    file_name: [u8; 64],

    data: u32,

    tss_set: TextureStageStateTexture2,
}

#[derive(Clone)]
pub struct CharMaterialTextureInfo {
    pub opacity: f32,
    pub transp_type: MaterialTextureInfoTransparencyType,
    pub material: CharMaterial,
    pub rs_set: [RenderStateAtom; 8],
    pub tex_seq: [TextureInfo; 4],
}

impl CharMaterialTextureInfo {
    pub fn new() -> Self {
        let rs_set = [RenderStateAtom::new(); 8];
        let tex_seq = [
            TextureInfo::new(),
            TextureInfo::new(),
            TextureInfo::new(),
            TextureInfo::new(),
        ];
        Self {
            opacity: 1.0,
            transp_type: MaterialTextureInfoTransparencyType::Filter,
            material: CharMaterial::new(),
            rs_set,
            tex_seq,
        }
    }

    pub fn from_gltf(
        gltf: &Document,
        buffers: &Vec<buffer::Data>,
        images: &Vec<gltf::image::Data>,
        model_id: u32,
    ) -> anyhow::Result<Vec<Self>> {
        let mut material_seq: Vec<Self> = vec![];
        let mut material = Self::new();
        material.transp_type = MaterialTextureInfoTransparencyType::Filter;
        material.opacity = 1.0;

        let model_id = format!("{:0>10}", model_id * 1000000);

        for gltf_mat in gltf.materials() {
            let roughness = gltf_mat.pbr_metallic_roughness();
            let base_color_texture = roughness.base_color_texture().unwrap();
            let base_color_factor = roughness.base_color_factor();
            let emissive_factor = gltf_mat.emissive_factor();

            let texture = base_color_texture.texture();
            let image_data = images.get(texture.source().index()).unwrap();
            let output_path = std::path::PathBuf::from(format!(
                "./imports/character/texture/character/{}.bmp",
                model_id
            ));
            converter::convert_gltf_image_to_bmp(
                image_data,
                &output_path,
                &TextureConvertOptions::default(),
            )?;

            let mut file_name: [u8; 64] = [0; 64];
            for (i, char) in format!("{}.bmp", model_id).chars().enumerate() {
                file_name[i] = char as u8;
            }

            material.tex_seq[0] = TextureInfo {
                stage: 0,
                level: u32::MAX, // LW_INVALID_INDEX - same as when reading from LGO file
                usage: 0,
                d3d_format: D3DFormat::Unknown,
                d3d_pool: D3DPool::Managed, // Same as when reading from LGO file
                _type: TextureType::File,
                colorkey: LwColorValue4b::from_color(0),
                colorkey_type: ColorKeyType::None,
                data: 0,
                byte_alignment_flag: 0,
                file_name,
                width: 0,
                height: 0,
                tss_set: [RenderStateAtom::new(); 8],
            };
            material.material = CharMaterial {
                emi: Some(ColorValue4F {
                    r: emissive_factor[0],
                    g: emissive_factor[1],
                    b: emissive_factor[2],
                    a: 0.0,
                }),
                dif: ColorValue4F {
                    r: base_color_factor[0],
                    g: base_color_factor[1],
                    b: base_color_factor[2],
                    a: base_color_factor[3],
                },
                amb: ColorValue4F {
                    r: 1.0,
                    g: 1.0,
                    b: 1.0,
                    a: 1.0,
                },
                spe: Some(ColorValue4F {
                    r: 1.0,
                    g: 1.0,
                    b: 1.0,
                    a: 1.0,
                }),
                power: 0.0,
            };
        }

        material_seq.push(material);
        Ok(material_seq)
    }

    /// Import material for a specific primitive from a glTF document
    /// This is used for multi-part models where each primitive may have its own material
    pub fn from_gltf_primitive(
        gltf: &Document,
        _buffers: &Vec<buffer::Data>,
        images: &Vec<gltf::image::Data>,
        model_id: u32,
        primitive_index: usize,
    ) -> anyhow::Result<Vec<Self>> {
        let mut material_seq: Vec<Self> = vec![];
        let mut material = Self::new();
        material.transp_type = MaterialTextureInfoTransparencyType::Filter;
        material.opacity = 1.0;

        // Find the specific primitive and get its material
        let mut current_idx = 0;
        let mut found_material = None;

        for mesh in gltf.meshes() {
            for primitive in mesh.primitives() {
                if current_idx == primitive_index {
                    found_material = Some(primitive.material());
                    break;
                }
                current_idx += 1;
            }
            if found_material.is_some() {
                break;
            }
        }

        // Generate file name based on model_id and primitive_index
        // e.g., model 725, primitive 1 -> 0725000001.bmp
        let file_id = format!("{:0>10}", model_id * 1000000 + primitive_index as u32);

        if let Some(gltf_mat) = found_material {
            let roughness = gltf_mat.pbr_metallic_roughness();

            if let Some(base_color_texture) = roughness.base_color_texture() {
                let base_color_factor = roughness.base_color_factor();
                let emissive_factor = gltf_mat.emissive_factor();

                let texture = base_color_texture.texture();
                let image_data = images.get(texture.source().index()).unwrap();
                let output_path = std::path::PathBuf::from(format!(
                    "./imports/character/texture/character/{}.bmp",
                    file_id
                ));
                converter::convert_gltf_image_to_bmp(
                    image_data,
                    &output_path,
                    &TextureConvertOptions::default(),
                )?;

                let mut file_name: [u8; 64] = [0; 64];
                for (i, char) in format!("{}.bmp", file_id).chars().enumerate() {
                    file_name[i] = char as u8;
                }

                material.tex_seq[0] = TextureInfo {
                    stage: 0,
                    level: u32::MAX,
                    usage: 0,
                    d3d_format: D3DFormat::Unknown,
                    d3d_pool: D3DPool::Managed,
                    _type: TextureType::File,
                    colorkey: LwColorValue4b::from_color(0),
                    colorkey_type: ColorKeyType::None,
                    data: 0,
                    byte_alignment_flag: 0,
                    file_name,
                    width: 0,
                    height: 0,
                    tss_set: [RenderStateAtom::new(); 8],
                };
                material.material = CharMaterial {
                    emi: Some(ColorValue4F {
                        r: emissive_factor[0],
                        g: emissive_factor[1],
                        b: emissive_factor[2],
                        a: 0.0,
                    }),
                    dif: ColorValue4F {
                        r: base_color_factor[0],
                        g: base_color_factor[1],
                        b: base_color_factor[2],
                        a: base_color_factor[3],
                    },
                    amb: ColorValue4F {
                        r: 1.0,
                        g: 1.0,
                        b: 1.0,
                        a: 1.0,
                    },
                    spe: Some(ColorValue4F {
                        r: 1.0,
                        g: 1.0,
                        b: 1.0,
                        a: 1.0,
                    }),
                    power: 0.0,
                };
            } else {
                // No texture, use default material with file_id as texture name
                let mut file_name: [u8; 64] = [0; 64];
                for (i, char) in format!("{}.bmp", file_id).chars().enumerate() {
                    file_name[i] = char as u8;
                }
                material.tex_seq[0].file_name = file_name;
                material.tex_seq[0]._type = TextureType::File;
                material.tex_seq[0].stage = 0;
            }
        } else {
            // No material found, use default with file_id
            let mut file_name: [u8; 64] = [0; 64];
            for (i, char) in format!("{}.bmp", file_id).chars().enumerate() {
                file_name[i] = char as u8;
            }
            material.tex_seq[0].file_name = file_name;
            material.tex_seq[0]._type = TextureType::File;
            material.tex_seq[0].stage = 0;
        }

        material_seq.push(material);
        Ok(material_seq)
    }

    /// Import material for a specific mesh from a glTF document
    /// This is the preferred method - each mesh becomes a separate LGO file
    /// Each mesh is expected to have exactly one primitive (idiomatic glTF structure)
    pub fn from_gltf_mesh(
        gltf: &Document,
        _buffers: &Vec<buffer::Data>,
        images: &Vec<gltf::image::Data>,
        model_id: u32,
        mesh_index: usize,
    ) -> anyhow::Result<Vec<Self>> {
        let mut material_seq: Vec<Self> = vec![];
        let mut material = Self::new();
        material.transp_type = MaterialTextureInfoTransparencyType::Filter;
        material.opacity = 1.0;

        // Get the mesh and its first primitive's material
        let gltf_mesh = gltf.meshes().nth(mesh_index).ok_or_else(|| {
            anyhow::anyhow!("Mesh index {} not found in glTF document", mesh_index)
        })?;

        let found_material = gltf_mesh.primitives().next().map(|p| p.material());

        // Generate file name based on model_id and mesh_index
        // e.g., model 725, mesh 1 -> 0725000001.bmp
        let file_id = format!("{:0>10}", model_id * 1000000 + mesh_index as u32);

        if let Some(gltf_mat) = found_material {
            let roughness = gltf_mat.pbr_metallic_roughness();

            if let Some(base_color_texture) = roughness.base_color_texture() {
                let base_color_factor = roughness.base_color_factor();
                let emissive_factor = gltf_mat.emissive_factor();

                let texture = base_color_texture.texture();
                let image_data = images.get(texture.source().index()).unwrap();
                let output_path = std::path::PathBuf::from(format!(
                    "./imports/character/texture/character/{}.bmp",
                    file_id
                ));
                converter::convert_gltf_image_to_bmp(
                    image_data,
                    &output_path,
                    &TextureConvertOptions::default(),
                )?;

                let mut file_name: [u8; 64] = [0; 64];
                for (i, char) in format!("{}.bmp", file_id).chars().enumerate() {
                    file_name[i] = char as u8;
                }

                material.tex_seq[0] = TextureInfo {
                    stage: 0,
                    level: u32::MAX,
                    usage: 0,
                    d3d_format: D3DFormat::Unknown,
                    d3d_pool: D3DPool::Managed,
                    _type: TextureType::File,
                    colorkey: LwColorValue4b::from_color(0),
                    colorkey_type: ColorKeyType::None,
                    data: 0,
                    byte_alignment_flag: 0,
                    file_name,
                    width: 0,
                    height: 0,
                    tss_set: [RenderStateAtom::new(); 8],
                };
                material.material = CharMaterial {
                    emi: Some(ColorValue4F {
                        r: emissive_factor[0],
                        g: emissive_factor[1],
                        b: emissive_factor[2],
                        a: 0.0,
                    }),
                    dif: ColorValue4F {
                        r: base_color_factor[0],
                        g: base_color_factor[1],
                        b: base_color_factor[2],
                        a: base_color_factor[3],
                    },
                    amb: ColorValue4F {
                        r: 1.0,
                        g: 1.0,
                        b: 1.0,
                        a: 1.0,
                    },
                    spe: Some(ColorValue4F {
                        r: 1.0,
                        g: 1.0,
                        b: 1.0,
                        a: 1.0,
                    }),
                    power: 0.0,
                };
            } else {
                // No texture, use default material with file_id as texture name
                let mut file_name: [u8; 64] = [0; 64];
                for (i, char) in format!("{}.bmp", file_id).chars().enumerate() {
                    file_name[i] = char as u8;
                }
                material.tex_seq[0].file_name = file_name;
                material.tex_seq[0]._type = TextureType::File;
                material.tex_seq[0].stage = 0;
            }
        } else {
            // No material found, use default with file_id
            let mut file_name: [u8; 64] = [0; 64];
            for (i, char) in format!("{}.bmp", file_id).chars().enumerate() {
                file_name[i] = char as u8;
            }
            material.tex_seq[0].file_name = file_name;
            material.tex_seq[0]._type = TextureType::File;
            material.tex_seq[0].stage = 0;
        }

        material_seq.push(material);
        Ok(material_seq)
    }
}

impl BinRead for CharMaterialTextureInfo {
    type Args<'a> = (u32, u32);

    fn read_options<R: std::io::Read + std::io::Seek>(
        reader: &mut R,
        endian: binrw::Endian,
        args: Self::Args<'_>,
    ) -> binrw::BinResult<Self> {
        let version = args.0;

        let mut opacity: f32 = 0.0;
        let mut transp_type: MaterialTextureInfoTransparencyType =
            MaterialTextureInfoTransparencyType::default();
        let material: CharMaterial;
        let mut rs_set: [RenderStateAtom; 8] = [RenderStateAtom::new(); 8];
        let mut tex_seq: [TextureInfo; 4] = [
            TextureInfo::new(),
            TextureInfo::new(),
            TextureInfo::new(),
            TextureInfo::new(),
        ];

        if version > EXP_OBJ_VERSION_1_0_0_0 || version == MTLTEX_VERSION0002 {
            opacity = f32::read_options(reader, endian, ())?;
            transp_type = MaterialTextureInfoTransparencyType::read_options(reader, endian, ())?;
            material = CharMaterial::read_options(reader, endian, ())?;
            rs_set.iter_mut().for_each(|rs| {
                *rs = RenderStateAtom::read_options(reader, endian, ()).unwrap();
            });
            tex_seq.iter_mut().for_each(|ts| {
                *ts = TextureInfo::read_options(reader, endian, ()).unwrap();
            });
        } else if version == MTLTEX_VERSION0001 {
            opacity = f32::read_options(reader, endian, ())?;
            transp_type = MaterialTextureInfoTransparencyType::read_options(reader, endian, ())?;
            material = CharMaterial::read_options(reader, endian, ())?;

            let rsm = RenderStateSetMaterial2::read_options(reader, endian, ())?;
            // Read 4 TextureInfo0001 individually (vec![expr?; N] only evaluates once then clones)
            let tex_info_0001: [TextureInfo0001; LW_MAX_TEXTURESTAGE_NUM as usize] = [
                TextureInfo0001::read_options(reader, endian, ())?,
                TextureInfo0001::read_options(reader, endian, ())?,
                TextureInfo0001::read_options(reader, endian, ())?,
                TextureInfo0001::read_options(reader, endian, ())?,
            ];

            rs_set.iter_mut().enumerate().for_each(|(i, rs)| {
                let rsv = rsm.rsv_seq[0][i];
                if rsv.state == LW_INVALID_INDEX {
                    return;
                }

                let v: u32 = match rsv.state {
                    D3DRS_ALPHAFUNC => D3DCmpFunc::Greater as u32,
                    D3DRS_ALPHAREF => 129,
                    _ => rsv.value,
                };

                rs.state = rsv.state;
                rs.value0 = v;
                rs.value1 = v;
            });

            tex_seq.iter_mut().enumerate().for_each(|(i, ts)| {
                let p = &tex_info_0001[i];
                if p.stage == LW_INVALID_INDEX {
                    return;
                }

                ts.level = u32::MAX;
                ts.usage = 0;
                ts.d3d_pool = D3DPool::Default;
                ts._type = TextureType::File;

                ts.stage = p.stage;
                ts.d3d_format = p.format;
                ts.colorkey = p.colorkey;
                ts.colorkey_type = p.colorkey_type;
                ts.byte_alignment_flag = 0;
                ts.file_name = p.file_name;

                for j in 0..p.tss_set.rsv_seq[0].len() as u32 {
                    let rsv = p.tss_set.rsv_seq[0][j as usize];
                    if rsv.state == LW_INVALID_INDEX {
                        break;
                    }

                    ts.tss_set[j as usize].state = rsv.state;
                    ts.tss_set[j as usize].value0 = rsv.value;
                    ts.tss_set[j as usize].value1 = rsv.value;
                }
            });
        } else if version == MTLTEX_VERSION0000 {
            // Version 0 format: no opacity/transp_type fields,
            // uses lwTexInfo_0000 (smaller struct) instead of lwTexInfo_0001
            material = CharMaterial::read_options(reader, endian, ())?;

            let render_state_mtl_2 = RenderStateSetMaterial2::read_options(reader, endian, ())?;
            // Read 4 TextureInfo0000 individually
            let texture_info_0000: [TextureInfo0000; LW_MAX_TEXTURESTAGE_NUM as usize] = [
                TextureInfo0000::read_options(reader, endian, ())?,
                TextureInfo0000::read_options(reader, endian, ())?,
                TextureInfo0000::read_options(reader, endian, ())?,
                TextureInfo0000::read_options(reader, endian, ())?,
            ];

            for i in 0..render_state_mtl_2.rsv_seq[0].len() {
                let rsv = render_state_mtl_2.rsv_seq[0][i as usize];
                if rsv.state == LW_INVALID_INDEX {
                    break;
                }

                let v: u32 = match rsv.state {
                    D3DRS_ALPHAFUNC => D3DCmpFunc::Greater as u32,
                    D3DRS_ALPHAREF => 129,
                    _ => rsv.value,
                };

                let rs = RenderStateAtom {
                    state: rsv.state,
                    value0: v,
                    value1: v,
                };

                rs_set[i as usize] = rs;
            }

            tex_seq.iter_mut().enumerate().for_each(|(i, tex)| {
                let p = &texture_info_0000[i];
                if p.stage == LW_INVALID_INDEX {
                    return;
                }

                tex.level = u32::MAX;
                tex.usage = 0;
                tex.d3d_pool = D3DPool::Default;
                tex._type = TextureType::File;

                tex.stage = p.stage;
                tex.d3d_format = p.format;
                tex.colorkey = p.colorkey;
                tex.colorkey_type = p.colorkey_type;
                tex.byte_alignment_flag = 0;
                tex.file_name = p.file_name;

                for j in 0..p.tss_set.rsv_seq[0].len() as u32 {
                    let rsv = p.tss_set.rsv_seq[0][j as usize];
                    if rsv.state == LW_INVALID_INDEX {
                        break;
                    }

                    tex.tss_set[j as usize].state = rsv.state;
                    tex.tss_set[j as usize].value0 = rsv.value;
                    tex.tss_set[j as usize].value1 = rsv.value;
                }
            });

            if tex_seq[0].d3d_format == D3DFormat::A4R4G4B4 {
                tex_seq[0].d3d_format = D3DFormat::A1R5G5B5;
            }
        } else {
            return Err(Error::AssertFail {
                pos: 0,
                message: "Invalid file version".to_string(),
            });
        }

        tex_seq[0].d3d_pool = D3DPool::Managed;
        tex_seq[0].level = u32::MAX;

        let mut transp_flag: bool = false;
        let mut total_mtl_rs_num: u32 = 0;

        for i in 0..LW_MTL_RS_NUM {
            let rsa = rs_set[i as usize];

            if rsa.state == LW_INVALID_INDEX {
                break;
            }

            total_mtl_rs_num += 1;

            if rsa.state == D3DRenderStateType::DestBlend as u32
                && (rsa.value0 == D3DBlend::One as u32
                    || rsa.value0 == D3DBlend::InvSrcColor as u32)
            {
                transp_flag = true;
            }

            if rsa.state == D3DRenderStateType::Lighting as u32 && rsa.value0 == 0 {
                transp_flag = !transp_flag;
            }
        }

        if transp_flag && total_mtl_rs_num < (LW_MTL_RS_NUM - 1) {
            rs_set[total_mtl_rs_num as usize].state = D3DRenderStateType::Lighting as u32;
            rs_set[total_mtl_rs_num as usize].value0 = 0;
            rs_set[total_mtl_rs_num as usize].value1 = 0;
        }

        if transp_type == MaterialTextureInfoTransparencyType::Additive1 {
            transp_type = MaterialTextureInfoTransparencyType::Subtractive;
        }

        Ok(CharMaterialTextureInfo {
            opacity,
            material,
            rs_set,
            tex_seq,
            transp_type,
        })
    }
}

impl BinWrite for CharMaterialTextureInfo {
    type Args<'a> = ();

    fn write_options<W: std::io::Write + Seek>(
        &self,
        writer: &mut W,
        endian: binrw::Endian,
        args: Self::Args<'_>,
    ) -> binrw::BinResult<()> {
        f32::write_le(&self.opacity, writer)?;
        MaterialTextureInfoTransparencyType::write_le(&self.transp_type, writer)?;
        CharMaterial::write_le(&self.material, writer)?;
        for rs in self.rs_set.iter() {
            RenderStateAtom::write_le(rs, writer)?;
        }

        for tex in self.tex_seq.iter() {
            TextureInfo::write_le(tex, writer)?;
        }

        Ok(())
    }
}
