use std::io::Write;

use anyhow::Result;
use serde::{Deserialize, Serialize};

use crate::d3d::D3DBlend;

const FIXED_NAME_LEN: usize = 32;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
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

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
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

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CylinderParams {
    pub segments: i32,
    pub height: f32,
    pub top_radius: f32,
    pub bot_radius: f32,
}

impl EffFile {
    pub fn from_bytes(bytes: &[u8]) -> Result<Self> {
        super::eff_loader::load_eff(bytes)
    }

    pub fn to_bytes(&self) -> Result<Vec<u8>> {
        let mut buffer = Vec::new();
        self.write_to(&mut buffer)?;
        Ok(buffer)
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

fn write_fixed_string<W: Write>(writer: &mut W, value: &str) -> Result<()> {
    let mut buffer = [0u8; FIXED_NAME_LEN];
    let bytes = value.as_bytes();
    let len = bytes.len().min(FIXED_NAME_LEN.saturating_sub(1));
    buffer[..len].copy_from_slice(&bytes[..len]);
    writer.write_all(&buffer)?;
    Ok(())
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

// ── .par domain types ────────────────────────────────────────────────────────

/// Parsed .par particle controller file.
/// Matches the frontend `ParticleController` TypeScript interface.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParFile {
    pub version: u32,
    pub name: String,
    pub length: f32,
    pub systems: Vec<ParSystem>,
    pub strips: Vec<ParStrip>,
    pub models: Vec<ParChaModel>,
}

/// A single particle emitter system within a .par file.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParSystem {
    pub r#type: i32,
    pub name: String,
    pub particle_count: i32,
    pub texture_name: String,
    pub model_name: String,
    pub range: [f32; 3],
    pub frame_count: u16,
    pub frame_sizes: Vec<f32>,
    pub frame_angles: Vec<[f32; 3]>,
    pub frame_colors: Vec<[f32; 4]>,
    pub billboard: bool,
    pub src_blend: i32,
    pub dest_blend: i32,
    pub min_filter: i32,
    pub mag_filter: i32,
    pub life: f32,
    pub velocity: f32,
    pub direction: [f32; 3],
    pub acceleration: [f32; 3],
    pub step: f32,
    // v4+
    pub model_range_flag: bool,
    pub model_range_name: String,
    // v5+
    pub offset: [f32; 3],
    // v6+
    pub delay_time: f32,
    pub play_time: f32,
    // v9+
    pub use_path: bool,
    pub path: Option<ParEffPath>,
    // v10+
    pub shade: bool,
    // v11+
    pub hit_effect: String,
    // v12+ (only when model_range_flag)
    pub point_ranges: Vec<[f32; 3]>,
    // v13+
    pub random_mode: i32,
    // v14+
    pub model_dir: bool,
    // v15+
    pub media_y: bool,
}

/// Spline path for path-following particles.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParEffPath {
    pub velocity: f32,
    pub points: Vec<[f32; 3]>,
    pub directions: Vec<[f32; 3]>,
    pub distances: Vec<f32>,
}

/// Strip/ribbon trail definition.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParStrip {
    pub max_len: i32,
    pub dummy: [i32; 2],
    pub color: [f32; 4],
    pub life: f32,
    pub step: f32,
    pub texture_name: String,
    pub src_blend: i32,
    pub dest_blend: i32,
}

/// Character model emitter.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParChaModel {
    pub id: i32,
    pub velocity: f32,
    pub play_type: i32,
    pub cur_pose: i32,
    pub src_blend: i32,
    pub dest_blend: i32,
    pub color: [f32; 4],
}

impl ParFile {
    pub fn from_bytes(bytes: &[u8]) -> Result<Self> {
        super::par_loader::load_par(bytes)
    }

    pub fn to_bytes(&self) -> Result<Vec<u8>> {
        let mut buffer = Vec::new();
        self.write_to(&mut buffer)?;
        Ok(buffer)
    }

    pub fn write_to<W: Write>(&self, writer: &mut W) -> Result<()> {
        write_u32(writer, self.version)?;
        write_fixed_string(writer, &self.name)?;
        write_i32(writer, self.systems.len() as i32)?;

        if self.version >= 3 {
            write_f32(writer, self.length)?;
        }

        for sys in &self.systems {
            sys.write_to(writer, self.version)?;
        }

        if self.version >= 7 {
            write_i32(writer, self.strips.len() as i32)?;
            for strip in &self.strips {
                strip.write_to(writer)?;
            }
        }

        if self.version >= 8 {
            write_i32(writer, self.models.len() as i32)?;
            for model in &self.models {
                model.write_to(writer)?;
            }
        }

        Ok(())
    }
}

impl ParSystem {
    fn write_to<W: Write>(&self, writer: &mut W, version: u32) -> Result<()> {
        write_i32(writer, self.r#type)?;
        write_fixed_string(writer, &self.name)?;
        write_i32(writer, self.particle_count)?;
        write_fixed_string(writer, &self.texture_name)?;
        write_fixed_string(writer, &self.model_name)?;
        write_f32(writer, self.range[0])?;
        write_f32(writer, self.range[1])?;
        write_f32(writer, self.range[2])?;
        write_u16(writer, self.frame_count)?;

        for size in &self.frame_sizes {
            write_f32(writer, *size)?;
        }
        for angle in &self.frame_angles {
            write_vec3(writer, *angle)?;
        }
        for color in &self.frame_colors {
            write_vec4(writer, *color)?;
        }

        write_u8(writer, if self.billboard { 1 } else { 0 })?;
        write_i32(writer, self.src_blend)?;
        write_i32(writer, self.dest_blend)?;
        write_i32(writer, self.min_filter)?;
        write_i32(writer, self.mag_filter)?;
        write_f32(writer, self.life)?;
        write_f32(writer, self.velocity)?;
        write_vec3(writer, self.direction)?;
        write_vec3(writer, self.acceleration)?;
        write_f32(writer, self.step)?;

        if version > 3 {
            write_u8(writer, if self.model_range_flag { 1 } else { 0 })?;
            write_fixed_string(writer, &self.model_range_name)?;
        }
        if version > 4 {
            write_vec3(writer, self.offset)?;
        }
        if version > 5 {
            write_f32(writer, self.delay_time)?;
            write_f32(writer, self.play_time)?;
        }
        if version > 8 {
            write_u8(writer, if self.use_path { 1 } else { 0 })?;
            if self.use_path {
                if let Some(ref path) = self.path {
                    path.write_to(writer)?;
                }
            }
        }
        if version > 9 {
            write_u8(writer, if self.shade { 1 } else { 0 })?;
        }
        if version > 10 {
            write_fixed_string(writer, &self.hit_effect)?;
        }
        if version > 11 && self.model_range_flag {
            write_u16(writer, self.point_ranges.len() as u16)?;
            for pr in &self.point_ranges {
                write_vec3(writer, *pr)?;
            }
        }
        if version > 12 {
            write_i32(writer, self.random_mode)?;
        }
        if version > 13 {
            write_u8(writer, if self.model_dir { 1 } else { 0 })?;
        }
        if version > 14 {
            write_u8(writer, if self.media_y { 1 } else { 0 })?;
        }

        Ok(())
    }
}

impl ParEffPath {
    fn write_to<W: Write>(&self, writer: &mut W) -> Result<()> {
        let frame_count = self.points.len() as i32;
        write_i32(writer, frame_count)?;
        write_f32(writer, self.velocity)?;

        for p in &self.points {
            write_vec3(writer, *p)?;
        }

        let segment_count = if frame_count > 0 {
            (frame_count - 1) as usize
        } else {
            0
        };

        for i in 0..segment_count {
            write_vec3(writer, self.directions[i])?;
        }
        for i in 0..segment_count {
            // eff_path_dist_slot: value + 2 padding floats
            write_f32(writer, self.distances[i])?;
            write_f32(writer, 0.0)?;
            write_f32(writer, 0.0)?;
        }

        Ok(())
    }
}

impl ParStrip {
    fn write_to<W: Write>(&self, writer: &mut W) -> Result<()> {
        write_i32(writer, self.max_len)?;
        write_i32(writer, self.dummy[0])?;
        write_i32(writer, self.dummy[1])?;
        write_vec4(writer, self.color)?;
        write_f32(writer, self.life)?;
        write_f32(writer, self.step)?;
        write_fixed_string(writer, &self.texture_name)?;
        write_i32(writer, self.src_blend)?;
        write_i32(writer, self.dest_blend)?;
        Ok(())
    }
}

impl ParChaModel {
    fn write_to<W: Write>(&self, writer: &mut W) -> Result<()> {
        write_i32(writer, self.id)?;
        write_f32(writer, self.velocity)?;
        write_i32(writer, self.play_type)?;
        write_i32(writer, self.cur_pose)?;
        write_i32(writer, self.src_blend)?;
        write_i32(writer, self.dest_blend)?;
        write_vec4(writer, self.color)?;
        Ok(())
    }
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
