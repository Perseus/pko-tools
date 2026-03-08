use std::io::Seek;

use binrw::{binwrite, BinWrite};

use gltf::{buffer, Document};

use serde::{Deserialize, Serialize};

use crate::texture_pipeline::converter::{self, TextureConvertOptions};

use crate::{
    animation::character::{LW_INVALID_INDEX, LW_MAX_NAME},
    d3d::{D3DFormat, D3DPool},
};

fn serialize_fixed_cstr<const N: usize, S: serde::Serializer>(
    buf: &[u8; N],
    ser: S,
) -> Result<S::Ok, S::Error> {
    let end = buf.iter().position(|&b| b == 0).unwrap_or(N);
    let s = String::from_utf8_lossy(&buf[..end]);
    ser.serialize_str(&s)
}

#[derive(Debug, Copy, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(into = "u32", try_from = "u32")]
#[binwrite]
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
#[derive(Debug, Copy, Clone, PartialEq, Eq, Serialize)]
#[binwrite]
#[bw(repr = u32)]
pub enum ColorKeyType {
    None = 0,
    Color = 1,
    Pixel = 2,

    InvalidMax = 0xffffffff,
}

impl TryFrom<u32> for ColorKeyType {
    type Error = String;
    fn try_from(v: u32) -> Result<Self, Self::Error> {
        match v {
            0 => Ok(Self::None),
            1 => Ok(Self::Color),
            2 => Ok(Self::Pixel),
            0xffffffff => Ok(Self::InvalidMax),
            _ => Err(format!("Invalid ColorKeyType: {}", v)),
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Copy, BinWrite)]
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
#[derive(Debug, Copy, Clone, PartialEq, Eq, Serialize)]
#[binwrite]
#[bw(repr = u32)]
pub enum TextureType {
    File = 0,
    Size = 1,
    Data = 2,
    Invalid = 0x7FFFFFFF,

    InvalidMax = 0xffffffff,
}

impl TryFrom<u32> for TextureType {
    type Error = String;
    fn try_from(v: u32) -> Result<Self, Self::Error> {
        match v {
            0 => Ok(Self::File),
            1 => Ok(Self::Size),
            2 => Ok(Self::Data),
            0x7FFFFFFF => Ok(Self::Invalid),
            0xffffffff => Ok(Self::InvalidMax),
            _ => Err(format!("Invalid TextureType: {}", v)),
        }
    }
}

#[derive(Clone, Serialize, BinWrite)]
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
#[derive(Default, Copy, Clone, Debug, Serialize, Deserialize, BinWrite)]
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

#[derive(Debug, Copy, Clone, Serialize, BinWrite)]
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

#[derive(Debug, Clone, Serialize, BinWrite)]
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

    #[serde(serialize_with = "serialize_fixed_cstr::<64, _>")]
    pub file_name: [u8; 64],

    #[serde(skip)]
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

#[derive(Clone, Serialize)]
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
