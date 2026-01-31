use std::io::{Read, Write};

use anyhow::Result;
use serde::{Deserialize, Serialize};

use crate::d3d::D3DBlend;

const FIXED_NAME_LEN: usize = 32;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EffFile {
    pub version: u32,
    pub idx_tech: i32,
    pub use_path: bool,
    pub path_name: String,
    pub use_sound: bool,
    pub sound_name: String,
    pub rotating: bool,
    pub rota_vec: [f32; 3],
    pub rota_vel: f32,
    pub eff_num: i32,
    pub sub_effects: Vec<SubEffect>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubEffect {
    pub effect_name: String,
    pub effect_type: i32,
    pub src_blend: D3DBlend,
    pub dest_blend: D3DBlend,
    pub length: f32,
    pub frame_count: u16,
    pub frame_times: Vec<f32>,
    pub frame_sizes: Vec<[f32; 3]>,
    pub frame_angles: Vec<[f32; 3]>,
    pub frame_positions: Vec<[f32; 3]>,
    pub frame_colors: Vec<[f32; 4]>,
    pub ver_count: u16,
    pub coord_count: u16,
    pub coord_frame_time: f32,
    pub coord_list: Vec<Vec<[f32; 2]>>,
    pub tex_count: u16,
    pub tex_frame_time: f32,
    pub tex_name: String,
    pub tex_list: Vec<Vec<[f32; 2]>>,
    pub model_name: String,
    pub billboard: bool,
    pub vs_index: i32,
    pub segments: i32,
    pub height: f32,
    pub top_radius: f32,
    pub bot_radius: f32,
    pub frame_tex_count: u16,
    pub frame_tex_time: f32,
    pub frame_tex_names: Vec<String>,
    pub frame_tex_time2: f32,
    pub use_param: i32,
    pub per_frame_cylinder: Vec<CylinderParams>,
    pub rota_loop: bool,
    pub rota_loop_vec: [f32; 4],
    pub alpha: bool,
    pub rota_board: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CylinderParams {
    pub segments: i32,
    pub height: f32,
    pub top_radius: f32,
    pub bot_radius: f32,
}

impl EffFile {
    pub fn from_bytes(bytes: &[u8]) -> Result<Self> {
        let mut reader = std::io::Cursor::new(bytes);
        Self::read_from(&mut reader)
    }

    pub fn to_bytes(&self) -> Result<Vec<u8>> {
        let mut buffer = Vec::new();
        self.write_to(&mut buffer)?;
        Ok(buffer)
    }

    pub fn read_from<R: Read>(reader: &mut R) -> Result<Self> {
        let version = read_u32(reader)?;
        let idx_tech = read_i32(reader)?;
        let use_path = read_bool(reader)?;
        let path_name = read_fixed_string(reader)?;
        let use_sound = read_bool(reader)?;
        let sound_name = read_fixed_string(reader)?;
        let rotating = read_bool(reader)?;
        let rota_vec = read_vec3(reader)?;
        let rota_vel = read_f32(reader)?;
        let eff_num = read_i32(reader)?;

        let mut sub_effects = Vec::with_capacity(eff_num.max(0) as usize);
        for _ in 0..eff_num.max(0) {
            sub_effects.push(SubEffect::read_from(reader, version)?);
        }

        Ok(Self {
            version,
            idx_tech,
            use_path,
            path_name,
            use_sound,
            sound_name,
            rotating,
            rota_vec,
            rota_vel,
            eff_num,
            sub_effects,
        })
    }

    pub fn write_to<W: Write>(&self, writer: &mut W) -> Result<()> {
        write_u32(writer, self.version)?;
        write_i32(writer, self.idx_tech)?;
        write_bool(writer, self.use_path)?;
        write_fixed_string(writer, &self.path_name)?;
        write_bool(writer, self.use_sound)?;
        write_fixed_string(writer, &self.sound_name)?;
        write_bool(writer, self.rotating)?;
        write_vec3(writer, self.rota_vec)?;
        write_f32(writer, self.rota_vel)?;
        write_i32(writer, self.sub_effects.len() as i32)?;

        for sub_effect in &self.sub_effects {
            sub_effect.write_to(writer, self.version)?;
        }

        Ok(())
    }
}

impl SubEffect {
    fn read_from<R: Read>(reader: &mut R, version: u32) -> Result<Self> {
        let effect_name = read_fixed_string(reader)?;
        let effect_type = read_i32(reader)?;
        let src_blend = read_blend(reader)?;
        let dest_blend = read_blend(reader)?;
        let length = read_f32(reader)?;
        let frame_count = read_u16(reader)?;

        let mut frame_times = Vec::with_capacity(frame_count as usize);
        for _ in 0..frame_count {
            frame_times.push(read_f32(reader)?);
        }

        let mut frame_sizes = Vec::with_capacity(frame_count as usize);
        let mut frame_angles = Vec::with_capacity(frame_count as usize);
        let mut frame_positions = Vec::with_capacity(frame_count as usize);
        let mut frame_colors = Vec::with_capacity(frame_count as usize);
        for _ in 0..frame_count {
            frame_sizes.push(read_vec3(reader)?);
        }
        for _ in 0..frame_count {
            frame_angles.push(read_vec3(reader)?);
        }
        for _ in 0..frame_count {
            frame_positions.push(read_vec3(reader)?);
        }
        for _ in 0..frame_count {
            frame_colors.push(read_vec4(reader)?);
        }

        let ver_count = read_u16(reader)?;
        let coord_count = read_u16(reader)?;
        let coord_frame_time = read_f32(reader)?;
        let coord_list = read_coord_list(reader, coord_count, ver_count)?;

        let tex_count = read_u16(reader)?;
        let tex_frame_time = read_f32(reader)?;
        let tex_name = read_fixed_string(reader)?;
        let tex_list = read_coord_list(reader, tex_count, ver_count)?;

        let model_name = read_fixed_string(reader)?;
        let billboard = read_bool(reader)?;
        let vs_index = read_i32(reader)?;

        let (segments, height, top_radius, bot_radius) = if version > 1 {
            (
                read_i32(reader)?,
                read_f32(reader)?,
                read_f32(reader)?,
                read_f32(reader)?,
            )
        } else {
            (0, 0.0, 0.0, 0.0)
        };

        let (frame_tex_count, frame_tex_time, frame_tex_names, frame_tex_time2) = if version > 2 {
            let frame_tex_count = read_u16(reader)?;
            let frame_tex_time = read_f32(reader)?;
            let mut frame_tex_names = Vec::with_capacity(frame_tex_count as usize);
            for _ in 0..frame_tex_count {
                frame_tex_names.push(read_fixed_string(reader)?);
            }
            let frame_tex_time2 = read_f32(reader)?;
            let _frame_tex_time_duplicate = read_f32(reader)?;

            (
                frame_tex_count,
                frame_tex_time,
                frame_tex_names,
                frame_tex_time2,
            )
        } else {
            (0, 0.0, Vec::new(), 0.0)
        };

        let (use_param, per_frame_cylinder) = if version > 3 {
            let use_param = read_i32(reader)?;
            let mut per_frame_cylinder = Vec::new();
            if use_param > 0 {
                per_frame_cylinder.reserve(frame_count as usize);
                for _ in 0..frame_count {
                    per_frame_cylinder.push(CylinderParams {
                        segments: read_i32(reader)?,
                        height: read_f32(reader)?,
                        top_radius: read_f32(reader)?,
                        bot_radius: read_f32(reader)?,
                    });
                }
            }

            (use_param, per_frame_cylinder)
        } else {
            (0, Vec::new())
        };

        let (rota_loop, rota_loop_vec) = if version > 4 {
            let rota_loop = read_bool(reader)?;
            let rota_loop_vec = read_vec4(reader)?;
            (rota_loop, rota_loop_vec)
        } else {
            (false, [0.0, 0.0, 0.0, 0.0])
        };

        let alpha = if version > 5 {
            read_bool(reader)?
        } else {
            false
        };
        let rota_board = if version > 6 {
            read_bool(reader)?
        } else {
            false
        };

        Ok(Self {
            effect_name,
            effect_type,
            src_blend,
            dest_blend,
            length,
            frame_count,
            frame_times,
            frame_sizes,
            frame_angles,
            frame_positions,
            frame_colors,
            ver_count,
            coord_count,
            coord_frame_time,
            coord_list,
            tex_count,
            tex_frame_time,
            tex_name,
            tex_list,
            model_name,
            billboard,
            vs_index,
            segments,
            height,
            top_radius,
            bot_radius,
            frame_tex_count,
            frame_tex_time,
            frame_tex_names,
            frame_tex_time2,
            use_param,
            per_frame_cylinder,
            rota_loop,
            rota_loop_vec,
            alpha,
            rota_board,
        })
    }

    fn write_to<W: Write>(&self, writer: &mut W, version: u32) -> Result<()> {
        write_fixed_string(writer, &self.effect_name)?;
        write_i32(writer, self.effect_type)?;
        write_u32(writer, u32::from(self.src_blend))?;
        write_u32(writer, u32::from(self.dest_blend))?;
        write_f32(writer, self.length)?;
        write_u16(writer, self.frame_count)?;

        for time in &self.frame_times {
            write_f32(writer, *time)?;
        }
        for value in &self.frame_sizes {
            write_vec3(writer, *value)?;
        }
        for value in &self.frame_angles {
            write_vec3(writer, *value)?;
        }
        for value in &self.frame_positions {
            write_vec3(writer, *value)?;
        }
        for value in &self.frame_colors {
            write_vec4(writer, *value)?;
        }

        write_u16(writer, self.ver_count)?;
        write_u16(writer, self.coord_count)?;
        write_f32(writer, self.coord_frame_time)?;
        write_coord_list(writer, &self.coord_list, self.coord_count, self.ver_count)?;

        write_u16(writer, self.tex_count)?;
        write_f32(writer, self.tex_frame_time)?;
        write_fixed_string(writer, &self.tex_name)?;
        write_coord_list(writer, &self.tex_list, self.tex_count, self.ver_count)?;

        write_fixed_string(writer, &self.model_name)?;
        write_bool(writer, self.billboard)?;
        write_i32(writer, self.vs_index)?;

        if version > 1 {
            write_i32(writer, self.segments)?;
            write_f32(writer, self.height)?;
            write_f32(writer, self.top_radius)?;
            write_f32(writer, self.bot_radius)?;
        }

        if version > 2 {
            write_u16(writer, self.frame_tex_count)?;
            write_f32(writer, self.frame_tex_time)?;
            for name in &self.frame_tex_names {
                write_fixed_string(writer, name)?;
            }
            write_f32(writer, self.frame_tex_time2)?;
            write_f32(writer, self.frame_tex_time2)?;
        }

        if version > 3 {
            write_i32(writer, self.use_param)?;
            if self.use_param > 0 {
                for params in &self.per_frame_cylinder {
                    write_i32(writer, params.segments)?;
                    write_f32(writer, params.height)?;
                    write_f32(writer, params.top_radius)?;
                    write_f32(writer, params.bot_radius)?;
                }
            }
        }

        if version > 4 {
            write_bool(writer, self.rota_loop)?;
            write_vec4(writer, self.rota_loop_vec)?;
        }

        if version > 5 {
            write_bool(writer, self.alpha)?;
        }

        if version > 6 {
            write_bool(writer, self.rota_board)?;
        }

        Ok(())
    }
}

fn read_coord_list<R: Read>(
    reader: &mut R,
    count: u16,
    ver_count: u16,
) -> Result<Vec<Vec<[f32; 2]>>> {
    let mut coord_list = Vec::with_capacity(count as usize);
    for _ in 0..count {
        let mut frame = Vec::with_capacity(ver_count as usize);
        for _ in 0..ver_count {
            frame.push(read_vec2(reader)?);
        }
        coord_list.push(frame);
    }

    Ok(coord_list)
}

fn write_coord_list<W: Write>(
    writer: &mut W,
    coord_list: &[Vec<[f32; 2]>],
    count: u16,
    ver_count: u16,
) -> Result<()> {
    for frame_index in 0..count as usize {
        if let Some(frame) = coord_list.get(frame_index) {
            for vert_index in 0..ver_count as usize {
                let coord = frame.get(vert_index).copied().unwrap_or([0.0, 0.0]);
                write_vec2(writer, coord)?;
            }
        } else {
            for _ in 0..ver_count {
                write_vec2(writer, [0.0, 0.0])?;
            }
        }
    }

    Ok(())
}

fn read_fixed_string<R: Read>(reader: &mut R) -> Result<String> {
    let mut buffer = [0u8; FIXED_NAME_LEN];
    reader.read_exact(&mut buffer)?;
    let end = buffer.iter().position(|b| *b == 0).unwrap_or(buffer.len());
    Ok(String::from_utf8_lossy(&buffer[..end]).to_string())
}

fn write_fixed_string<W: Write>(writer: &mut W, value: &str) -> Result<()> {
    let mut buffer = [0u8; FIXED_NAME_LEN];
    let bytes = value.as_bytes();
    let len = bytes.len().min(FIXED_NAME_LEN.saturating_sub(1));
    buffer[..len].copy_from_slice(&bytes[..len]);
    writer.write_all(&buffer)?;
    Ok(())
}

fn read_u8<R: Read>(reader: &mut R) -> Result<u8> {
    let mut buffer = [0u8; 1];
    reader.read_exact(&mut buffer)?;
    Ok(buffer[0])
}

fn read_u16<R: Read>(reader: &mut R) -> Result<u16> {
    let mut buffer = [0u8; 2];
    reader.read_exact(&mut buffer)?;
    Ok(u16::from_le_bytes(buffer))
}

fn read_u32<R: Read>(reader: &mut R) -> Result<u32> {
    let mut buffer = [0u8; 4];
    reader.read_exact(&mut buffer)?;
    Ok(u32::from_le_bytes(buffer))
}

fn read_i32<R: Read>(reader: &mut R) -> Result<i32> {
    let mut buffer = [0u8; 4];
    reader.read_exact(&mut buffer)?;
    Ok(i32::from_le_bytes(buffer))
}

fn read_f32<R: Read>(reader: &mut R) -> Result<f32> {
    let mut buffer = [0u8; 4];
    reader.read_exact(&mut buffer)?;
    Ok(f32::from_le_bytes(buffer))
}

fn read_bool<R: Read>(reader: &mut R) -> Result<bool> {
    Ok(read_u8(reader)? != 0)
}

fn read_vec2<R: Read>(reader: &mut R) -> Result<[f32; 2]> {
    Ok([read_f32(reader)?, read_f32(reader)?])
}

fn read_vec3<R: Read>(reader: &mut R) -> Result<[f32; 3]> {
    Ok([read_f32(reader)?, read_f32(reader)?, read_f32(reader)?])
}

fn read_vec4<R: Read>(reader: &mut R) -> Result<[f32; 4]> {
    Ok([
        read_f32(reader)?,
        read_f32(reader)?,
        read_f32(reader)?,
        read_f32(reader)?,
    ])
}

fn read_blend<R: Read>(reader: &mut R) -> Result<D3DBlend> {
    let value = read_u32(reader)?;
    D3DBlend::try_from(value).map_err(|e| anyhow::anyhow!(e))
}

fn write_u8<W: Write>(writer: &mut W, value: u8) -> Result<()> {
    writer.write_all(&[value])?;
    Ok(())
}

fn write_u16<W: Write>(writer: &mut W, value: u16) -> Result<()> {
    writer.write_all(&value.to_le_bytes())?;
    Ok(())
}

fn write_u32<W: Write>(writer: &mut W, value: u32) -> Result<()> {
    writer.write_all(&value.to_le_bytes())?;
    Ok(())
}

fn write_i32<W: Write>(writer: &mut W, value: i32) -> Result<()> {
    writer.write_all(&value.to_le_bytes())?;
    Ok(())
}

fn write_f32<W: Write>(writer: &mut W, value: f32) -> Result<()> {
    writer.write_all(&value.to_le_bytes())?;
    Ok(())
}

fn write_bool<W: Write>(writer: &mut W, value: bool) -> Result<()> {
    write_u8(writer, if value { 1 } else { 0 })
}

fn write_vec2<W: Write>(writer: &mut W, value: [f32; 2]) -> Result<()> {
    write_f32(writer, value[0])?;
    write_f32(writer, value[1])
}

fn write_vec3<W: Write>(writer: &mut W, value: [f32; 3]) -> Result<()> {
    write_f32(writer, value[0])?;
    write_f32(writer, value[1])?;
    write_f32(writer, value[2])
}

fn write_vec4<W: Write>(writer: &mut W, value: [f32; 4]) -> Result<()> {
    write_f32(writer, value[0])?;
    write_f32(writer, value[1])?;
    write_f32(writer, value[2])?;
    write_f32(writer, value[3])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn minimal_effect_roundtrip() {
        let effect = EffFile {
            version: 7,
            idx_tech: 0,
            use_path: false,
            path_name: String::new(),
            use_sound: false,
            sound_name: String::new(),
            rotating: false,
            rota_vec: [0.0, 0.0, 0.0],
            rota_vel: 0.0,
            eff_num: 0,
            sub_effects: Vec::new(),
        };

        let bytes = effect.to_bytes().expect("serialize effect");
        let parsed = EffFile::from_bytes(&bytes).expect("parse effect");

        assert_eq!(parsed.version, 7);
        assert_eq!(parsed.eff_num, 0);
        assert!(parsed.sub_effects.is_empty());
    }
}
