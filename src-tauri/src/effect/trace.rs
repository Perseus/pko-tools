use serde::Serialize;

use super::model::{EffFile, SubEffect};

const TRACE_SCHEMA: &str = "pko-effect-trace/v1";
const TRACE_COORDINATE_SYSTEM: &str = "pko-z-up";
const DEFAULT_FRAME_DURATION: f32 = 1.0 / 30.0;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EffectTraceArtifact {
    pub schema: &'static str,
    pub source: String,
    pub coordinate_system: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub effect_name: Option<String>,
    pub sample_times: Vec<f32>,
    pub frames: Vec<EffectTraceFrame>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EffectTraceFrame {
    pub time: f32,
    pub local_time: f32,
    pub idx_tech: i32,
    pub group_quaternion: [f32; 4],
    pub sub_effects: Vec<EffectTraceSubEffect>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EffectTraceSubEffect {
    pub index: usize,
    pub effect_name: String,
    pub model_name: String,
    pub texture_name: String,
    pub frame_index: usize,
    pub next_frame_index: usize,
    pub lerp: f32,
    pub tex_frame_index: usize,
    pub position: [f32; 3],
    pub scale: [f32; 3],
    pub angle: [f32; 3],
    pub color: [f32; 4],
    pub local_matrix: [[f32; 4]; 4],
    pub render_state: EffectTraceRenderState,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EffectTraceRenderState {
    pub src_blend: u32,
    pub dest_blend: u32,
}

pub fn sample_effect_trace_artifact(
    effect: &EffFile,
    sample_times: &[f32],
    loop_playback: bool,
    source: impl Into<String>,
    effect_name: Option<String>,
) -> EffectTraceArtifact {
    EffectTraceArtifact {
        schema: TRACE_SCHEMA,
        source: source.into(),
        coordinate_system: TRACE_COORDINATE_SYSTEM,
        effect_name,
        sample_times: sample_times.to_vec(),
        frames: sample_times
            .iter()
            .copied()
            .map(|time| sample_effect_trace_frame(effect, time, loop_playback))
            .collect(),
    }
}

pub fn sample_effect_trace_frame(
    effect: &EffFile,
    elapsed_time: f32,
    loop_playback: bool,
) -> EffectTraceFrame {
    let local_time = effect_local_time(effect, elapsed_time, loop_playback);
    EffectTraceFrame {
        time: elapsed_time,
        local_time,
        idx_tech: effect.idx_tech,
        group_quaternion: group_quaternion(effect, local_time),
        sub_effects: effect
            .sub_effects
            .iter()
            .enumerate()
            .map(|(index, sub)| sample_sub_effect(index, sub, local_time, loop_playback))
            .collect(),
    }
}

fn sample_sub_effect(
    index: usize,
    sub: &SubEffect,
    local_time: f32,
    loop_playback: bool,
) -> EffectTraceSubEffect {
    let sampled = interpolate_sub_effect(sub, local_time, loop_playback);
    let texture_name = if sub.effect_type == 1 {
        sub.frame_tex_names
            .get(sampled.tex_frame_index)
            .cloned()
            .unwrap_or_else(|| normalize_main_texture_name(&sub.tex_name))
    } else {
        normalize_main_texture_name(&sub.tex_name)
    };
    let angle = if sub.billboard && !sub.rota_board {
        [0.0, 0.0, 0.0]
    } else {
        sampled.angle
    };

    EffectTraceSubEffect {
        index,
        effect_name: sub.effect_name.clone(),
        model_name: sub.model_name.clone(),
        texture_name,
        frame_index: sampled.frame_index,
        next_frame_index: sampled.next_frame_index,
        lerp: sampled.lerp,
        tex_frame_index: sampled.tex_frame_index,
        position: sampled.position,
        scale: sampled.scale,
        angle,
        color: sampled.color,
        local_matrix: d3d_local_matrix(sampled.scale, angle, sampled.position),
        render_state: EffectTraceRenderState {
            src_blend: sub.src_blend.into(),
            dest_blend: sub.dest_blend.into(),
        },
    }
}

struct InterpolatedSubEffect {
    frame_index: usize,
    next_frame_index: usize,
    lerp: f32,
    tex_frame_index: usize,
    position: [f32; 3],
    scale: [f32; 3],
    angle: [f32; 3],
    color: [f32; 4],
}

fn interpolate_sub_effect(
    sub: &SubEffect,
    elapsed_time: f32,
    loop_playback: bool,
) -> InterpolatedSubEffect {
    let frame_count = sub.frame_count as usize;
    if frame_count == 0 {
        return InterpolatedSubEffect {
            frame_index: 0,
            next_frame_index: 0,
            lerp: 0.0,
            tex_frame_index: 0,
            position: [0.0, 0.0, 0.0],
            scale: [1.0, 1.0, 1.0],
            angle: [0.0, 0.0, 0.0],
            color: [1.0, 1.0, 1.0, 1.0],
        };
    }

    let total_duration = sub_total_duration(sub);
    let mut t = elapsed_time;
    if loop_playback && total_duration > 0.0 {
        t %= total_duration;
        if t < 0.0 {
            t += total_duration;
        }
    } else {
        t = t.clamp(0.0, total_duration);
    }

    let mut accumulator = 0.0;
    let mut frame_index = frame_count - 1;
    let mut lerp = 0.0;
    for i in 0..frame_count {
        let duration = frame_duration(sub, i);
        if t < accumulator + duration {
            frame_index = i;
            lerp = if duration > 0.0 {
                (t - accumulator) / duration
            } else {
                0.0
            };
            break;
        }
        accumulator += duration;
    }

    let next_frame_index = if frame_index >= frame_count - 1 {
        0
    } else {
        frame_index + 1
    };

    InterpolatedSubEffect {
        frame_index,
        next_frame_index,
        lerp,
        tex_frame_index: timed_frame_index(
            t,
            sub.frame_tex_time,
            sub.frame_tex_names.len(),
            loop_playback,
        ),
        position: lerp_vec3(
            sub.frame_positions
                .get(frame_index)
                .copied()
                .unwrap_or([0.0, 0.0, 0.0]),
            sub.frame_positions
                .get(next_frame_index)
                .copied()
                .unwrap_or([0.0, 0.0, 0.0]),
            lerp,
        ),
        scale: lerp_vec3(
            sub.frame_sizes
                .get(frame_index)
                .copied()
                .unwrap_or([1.0, 1.0, 1.0]),
            sub.frame_sizes
                .get(next_frame_index)
                .copied()
                .unwrap_or([1.0, 1.0, 1.0]),
            lerp,
        ),
        angle: lerp_vec3(
            sub.frame_angles
                .get(frame_index)
                .copied()
                .unwrap_or([0.0, 0.0, 0.0]),
            sub.frame_angles
                .get(next_frame_index)
                .copied()
                .unwrap_or([0.0, 0.0, 0.0]),
            lerp,
        ),
        color: lerp_vec4(
            sub.frame_colors
                .get(frame_index)
                .copied()
                .unwrap_or([1.0, 1.0, 1.0, 1.0]),
            sub.frame_colors
                .get(next_frame_index)
                .copied()
                .unwrap_or([1.0, 1.0, 1.0, 1.0]),
            lerp,
        ),
    }
}

fn effect_local_time(effect: &EffFile, elapsed_time: f32, loop_playback: bool) -> f32 {
    let total_duration = effect
        .sub_effects
        .iter()
        .map(sub_total_duration)
        .fold(0.0, f32::max);

    if total_duration <= 0.0 {
        return elapsed_time;
    }
    if loop_playback {
        let mut wrapped = elapsed_time % total_duration;
        if wrapped < 0.0 {
            wrapped += total_duration;
        }
        wrapped
    } else {
        elapsed_time.clamp(0.0, total_duration)
    }
}

fn sub_total_duration(sub: &SubEffect) -> f32 {
    (0..sub.frame_count as usize)
        .map(|i| frame_duration(sub, i))
        .sum()
}

fn frame_duration(sub: &SubEffect, index: usize) -> f32 {
    sub.frame_times
        .get(index)
        .copied()
        .unwrap_or(DEFAULT_FRAME_DURATION)
        .max(DEFAULT_FRAME_DURATION)
}

fn timed_frame_index(
    elapsed_time: f32,
    frame_time: f32,
    frame_count: usize,
    loop_playback: bool,
) -> usize {
    if frame_count <= 1 || frame_time <= 0.0 {
        return 0;
    }
    let raw_time = elapsed_time.max(0.0);
    if raw_time <= 0.0 {
        return 0;
    }
    let raw_index = ((raw_time / frame_time).ceil() as isize - 1).max(0) as usize;
    if loop_playback {
        raw_index % frame_count
    } else {
        raw_index.min(frame_count - 1)
    }
}

fn normalize_main_texture_name(name: &str) -> String {
    let mut normalized = name.to_ascii_lowercase();
    if normalized.ends_with(".dds") || normalized.ends_with(".tga") {
        normalized.truncate(normalized.len() - 4);
    }
    normalized
}

fn d3d_local_matrix(scale: [f32; 3], angle: [f32; 3], position: [f32; 3]) -> [[f32; 4]; 4] {
    let pitch = angle[0];
    let yaw = angle[1];
    let roll = angle[2];
    let rotation = multiply_matrix4(
        multiply_matrix4(rotation_z(roll), rotation_x(pitch)),
        rotation_y(yaw),
    );

    [
        [
            scale[0] * rotation[0][0],
            scale[0] * rotation[0][1],
            scale[0] * rotation[0][2],
            0.0,
        ],
        [
            scale[1] * rotation[1][0],
            scale[1] * rotation[1][1],
            scale[1] * rotation[1][2],
            0.0,
        ],
        [
            scale[2] * rotation[2][0],
            scale[2] * rotation[2][1],
            scale[2] * rotation[2][2],
            0.0,
        ],
        [position[0], position[1], position[2], 1.0],
    ]
}

fn rotation_x(angle: f32) -> [[f32; 4]; 4] {
    let (s, c) = angle.sin_cos();
    [
        [1.0, 0.0, 0.0, 0.0],
        [0.0, c, s, 0.0],
        [0.0, -s, c, 0.0],
        [0.0, 0.0, 0.0, 1.0],
    ]
}

fn rotation_y(angle: f32) -> [[f32; 4]; 4] {
    let (s, c) = angle.sin_cos();
    [
        [c, 0.0, -s, 0.0],
        [0.0, 1.0, 0.0, 0.0],
        [s, 0.0, c, 0.0],
        [0.0, 0.0, 0.0, 1.0],
    ]
}

fn rotation_z(angle: f32) -> [[f32; 4]; 4] {
    let (s, c) = angle.sin_cos();
    [
        [c, s, 0.0, 0.0],
        [-s, c, 0.0, 0.0],
        [0.0, 0.0, 1.0, 0.0],
        [0.0, 0.0, 0.0, 1.0],
    ]
}

fn multiply_matrix4(a: [[f32; 4]; 4], b: [[f32; 4]; 4]) -> [[f32; 4]; 4] {
    let mut out = [[0.0; 4]; 4];
    for row in 0..4 {
        for col in 0..4 {
            out[row][col] = a[row][0] * b[0][col]
                + a[row][1] * b[1][col]
                + a[row][2] * b[2][col]
                + a[row][3] * b[3][col];
        }
    }
    out
}

fn lerp_vec3(a: [f32; 3], b: [f32; 3], t: f32) -> [f32; 3] {
    [
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t,
        a[2] + (b[2] - a[2]) * t,
    ]
}

fn lerp_vec4(a: [f32; 4], b: [f32; 4], t: f32) -> [f32; 4] {
    [
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t,
        a[2] + (b[2] - a[2]) * t,
        a[3] + (b[3] - a[3]) * t,
    ]
}

fn group_quaternion(effect: &EffFile, local_time: f32) -> [f32; 4] {
    if !effect.rotating {
        return [0.0, 0.0, 0.0, 1.0];
    }

    let [x, y, z] = effect.rota_vec;
    let len = (x * x + y * y + z * z).sqrt();
    if len <= f32::EPSILON {
        return [0.0, 0.0, 0.0, 1.0];
    }

    let half = local_time * effect.rota_vel * 0.5;
    let s = half.sin();
    [x / len * s, y / len * s, z / len * s, half.cos()]
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::d3d::D3DBlend;
    use crate::effect::model::CylinderParams;

    fn sub_fixture() -> SubEffect {
        SubEffect {
            effect_name: "TestEffect".to_string(),
            effect_type: 0,
            src_blend: D3DBlend::SrcAlpha,
            dest_blend: D3DBlend::One,
            length: 1.0,
            frame_count: 2,
            frame_times: vec![0.0, 0.5],
            frame_sizes: vec![[1.0, 1.0, 1.0], [2.0, 2.0, 2.0]],
            frame_angles: vec![[1.0, 2.0, 3.0], [4.0, 5.0, 6.0]],
            frame_positions: vec![[0.0, 0.0, 0.0], [3.0, 0.0, 2.0]],
            frame_colors: vec![[1.0, 1.0, 1.0, 1.0], [1.0, 0.0, 0.0, 0.5]],
            ver_count: 4,
            coord_count: 0,
            coord_frame_time: 0.0,
            coord_list: vec![],
            tex_count: 1,
            tex_frame_time: 0.0,
            tex_name: "spark".to_string(),
            tex_list: vec![],
            model_name: "RectPlane".to_string(),
            billboard: true,
            vs_index: 0,
            segments: 0,
            height: 0.0,
            top_radius: 0.0,
            bot_radius: 0.0,
            frame_tex_count: 0,
            frame_tex_time: 0.0,
            frame_tex_names: vec![],
            frame_tex_time2: 0.0,
            use_param: 0,
            per_frame_cylinder: vec![CylinderParams {
                segments: 0,
                height: 0.0,
                top_radius: 0.0,
                bot_radius: 0.0,
            }],
            rota_loop: false,
            rota_loop_vec: [0.0, 0.0, 0.0, 0.0],
            alpha: true,
            rota_board: false,
        }
    }

    fn effect_fixture() -> EffFile {
        EffFile {
            version: 7,
            idx_tech: 0,
            use_path: false,
            path_name: String::new(),
            use_sound: false,
            sound_name: String::new(),
            rotating: false,
            rota_vec: [0.0, 0.0, 0.0],
            rota_vel: 0.0,
            eff_num: 1,
            sub_effects: vec![sub_fixture()],
        }
    }

    #[test]
    fn samples_billboard_runtime_angle_as_zero() {
        let frame = sample_effect_trace_frame(&effect_fixture(), 0.25, true);

        assert_eq!(frame.sub_effects[0].angle, [0.0, 0.0, 0.0]);
        assert_eq!(frame.sub_effects[0].render_state.src_blend, 5);
        assert_eq!(frame.sub_effects[0].render_state.dest_blend, 2);
        assert!((frame.sub_effects[0].local_matrix[0][0] - 1.5666666).abs() < 0.0001);
        assert!((frame.sub_effects[0].local_matrix[1][1] - 1.5666666).abs() < 0.0001);
        assert!((frame.sub_effects[0].local_matrix[2][2] - 1.5666666).abs() < 0.0001);
        assert!((frame.sub_effects[0].local_matrix[3][0] - 1.7).abs() < 0.0001);
        assert!((frame.sub_effects[0].local_matrix[3][2] - 1.1333333).abs() < 0.0001);
    }

    #[test]
    fn samples_model_effect_billboard_runtime_angle_as_zero() {
        let mut effect = effect_fixture();
        effect.sub_effects[0].effect_type = 4;

        let frame = sample_effect_trace_frame(&effect, 0.25, true);

        assert_eq!(frame.sub_effects[0].angle, [0.0, 0.0, 0.0]);
    }

    #[test]
    fn preserves_rota_board_billboard_runtime_angle() {
        let mut effect = effect_fixture();
        effect.sub_effects[0].effect_type = 4;
        effect.sub_effects[0].rota_board = true;

        let frame = sample_effect_trace_frame(&effect, 0.25, true);

        assert!((frame.sub_effects[0].angle[0] - 2.7).abs() < 0.0001);
        assert!((frame.sub_effects[0].angle[1] - 3.7).abs() < 0.0001);
        assert!((frame.sub_effects[0].angle[2] - 4.7).abs() < 0.0001);
    }

    #[test]
    fn samples_main_texture_as_cpp_runtime_key() {
        let mut effect = effect_fixture();
        effect.sub_effects[0].tex_name = "Spark.TGA".to_string();

        let frame = sample_effect_trace_frame(&effect, 0.0, true);

        assert_eq!(frame.sub_effects[0].texture_name, "spark");
    }

    #[test]
    fn preserves_authored_spaces_in_main_texture_key() {
        let mut effect = effect_fixture();
        effect.sub_effects[0].tex_name = "JJ1 .TGA".to_string();

        let frame = sample_effect_trace_frame(&effect, 0.0, true);

        assert_eq!(frame.sub_effects[0].texture_name, "jj1 ");
    }
}
