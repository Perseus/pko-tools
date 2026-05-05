use std::path::{Path, PathBuf};

use cgmath::{EuclideanSpace, InnerSpace, Matrix4, Point3, SquareMatrix, Transform, Vector3};
use pko_tools_lib::character::model::CharacterGeometricModel;
use pko_tools_lib::effect::model::EffFile;
use pko_tools_lib::item::{model::build_gltf_from_lgo, refine, sceneffect};

const DEFAULT_PROJECT_DIR: &str = r"E:\gamedev\mp-client-source\Client\client";
const DEFAULT_ITEM_ID: u32 = 5001;
const DEFAULT_MODEL_ID: &str = "01010027";
const DEFAULT_REFINE_LEVEL: u32 = 12;
const DEFAULT_CHAR_TYPE: u32 = 0;
const DEFAULT_EFFECT_CATEGORY: u32 = 7;

fn point(v: [f32; 3]) -> Point3<f32> {
    Point3::new(v[0], v[1], v[2])
}

fn vec(v: [f32; 3]) -> Vector3<f32> {
    Vector3::new(v[0], v[1], v[2])
}

fn format_vec3(v: Vector3<f32>) -> String {
    format!("[{:.4}, {:.4}, {:.4}]", v.x, v.y, v.z)
}

fn format_point3(v: Point3<f32>) -> String {
    format!("[{:.4}, {:.4}, {:.4}]", v.x, v.y, v.z)
}

fn yz_swap(v: Vector3<f32>) -> Vector3<f32> {
    Vector3::new(v.x, v.z, v.y)
}

fn values_to_matrix16(values: &[serde_json::Value]) -> Option<[f32; 16]> {
    if values.len() != 16 {
        return None;
    }
    let mut out = [0.0f32; 16];
    for (idx, value) in values.iter().enumerate() {
        out[idx] = value.as_f64()? as f32;
    }
    Some(out)
}

fn resolve_forge_particles(
    project_dir: &Path,
    item_id: u32,
    refine_level: u32,
    char_type: u32,
    effect_category: u32,
) -> anyhow::Result<Vec<(String, i32, f32)>> {
    let effect_level = if refine_level >= 1 {
        ((refine_level - 1) / 4).min(3)
    } else {
        0
    };

    let effect_idx = (effect_category.saturating_sub(1)) as usize;
    let refine_info_table = refine::load_item_refine_info(project_dir)?;
    let refine_effect_table = refine::load_refine_effects(project_dir)?;
    let scene_effects = sceneffect::load_scene_effect_info(project_dir)?;

    let refine_info = refine_info_table
        .entries
        .get(&(item_id as i32))
        .ok_or_else(|| anyhow::anyhow!("Item {} not found in ItemRefineInfo.bin", item_id))?;

    let refine_effect_id = *refine_info
        .values
        .get(effect_idx)
        .ok_or_else(|| anyhow::anyhow!("Effect category {} out of range", effect_category))?;

    let effect_entry = refine_effect_table
        .entries
        .iter()
        .find(|entry| entry.id == refine_effect_id as i32)
        .ok_or_else(|| anyhow::anyhow!("Refine effect {} not found", refine_effect_id))?;

    let char_idx = (char_type as usize).min(3);
    let cha_scale = refine_info
        .cha_effect_scale
        .get(char_idx)
        .copied()
        .unwrap_or(1.0);
    let cha_scale = if cha_scale <= 0.0 { 1.0 } else { cha_scale };

    let mut particles = Vec::new();
    for tier in 0..4 {
        let flat_idx = char_idx * 4 + tier;
        let base_id = effect_entry.effect_ids.get(flat_idx).copied().unwrap_or(0);
        if base_id == 0 {
            continue;
        }

        let scene_effect_id = (base_id as i32) * 10 + effect_level as i32;
        let dummy_id = effect_entry.dummy_ids.get(tier).copied().unwrap_or(0) as i32;

        if let Some(scene_eff) = scene_effects.get(&(scene_effect_id as u32)) {
            particles.push((scene_eff.filename.clone(), dummy_id, cha_scale));
        }
    }

    Ok(particles)
}

fn choose_probe_effect(project_dir: &Path, resolved_particles: &[(String, i32, f32)]) -> (String, i32, f32) {
    if let Some(found) = resolved_particles
        .iter()
        .find(|(name, _, _)| name.eq_ignore_ascii_case("jjry03.par"))
    {
        return found.clone();
    }

    if let Some(first) = resolved_particles.first() {
        return first.clone();
    }

    let fallback = PathBuf::from(project_dir).join("effect").join("jjry03.eff");
    if fallback.exists() {
        return ("jjry03.par".to_string(), 1, 1.0);
    }

    ("jjyb03.par".to_string(), 1, 1.0)
}

fn dominant_weapon_axis(vertices_in_dummy: &[Point3<f32>]) -> (String, Vector3<f32>, f32, f32) {
    let axes = [
        ("+X", Vector3::unit_x()),
        ("-X", -Vector3::unit_x()),
        ("+Y", Vector3::unit_y()),
        ("-Y", -Vector3::unit_y()),
        ("+Z", Vector3::unit_z()),
        ("-Z", -Vector3::unit_z()),
    ];

    let mut best = ("+X".to_string(), Vector3::unit_x(), f32::MIN, f32::MIN);
    for (label, axis) in axes {
        let max_proj = vertices_in_dummy
            .iter()
            .map(|v| v.to_vec().dot(axis))
            .fold(f32::MIN, f32::max);
        let min_proj = vertices_in_dummy
            .iter()
            .map(|v| v.to_vec().dot(axis))
            .fold(f32::MAX, f32::min);
        let forward_span = max_proj.max(0.0);
        if forward_span > best.2 {
            best = (label.to_string(), axis, forward_span, min_proj);
        }
    }
    best
}

fn main() -> anyhow::Result<()> {
    let project_dir = PathBuf::from(DEFAULT_PROJECT_DIR);
    let model_path = project_dir
        .join("model")
        .join("item")
        .join(format!("{DEFAULT_MODEL_ID}.lgo"));

    let resolved_particles = resolve_forge_particles(
        &project_dir,
        DEFAULT_ITEM_ID,
        DEFAULT_REFINE_LEVEL,
        DEFAULT_CHAR_TYPE,
        DEFAULT_EFFECT_CATEGORY,
    )?;

    println!("Resolved forge particles for item {DEFAULT_ITEM_ID}, category {DEFAULT_EFFECT_CATEGORY}, refine {DEFAULT_REFINE_LEVEL}, char {DEFAULT_CHAR_TYPE}:");
    for (name, dummy_id, scale) in &resolved_particles {
        println!("  {name}  dummy={dummy_id}  scale={scale:.3}");
    }

    let (par_name, dummy_id, effect_scale) = choose_probe_effect(&project_dir, &resolved_particles);
    let eff_name = par_name.replace(".par", ".eff");
    let eff_path = project_dir.join("effect").join(&eff_name);
    println!("\nProbe effect: {eff_name}  dummy={dummy_id}  scale={effect_scale:.3}");

    let geom = CharacterGeometricModel::from_file(model_path.clone())?;
    let mesh = geom
        .mesh_info
        .as_ref()
        .ok_or_else(|| anyhow::anyhow!("Model has no mesh data: {}", model_path.display()))?;
    let helper = geom
        .helper_data
        .as_ref()
        .ok_or_else(|| anyhow::anyhow!("Model has no helper data: {}", model_path.display()))?;

    let dummy = helper
        .dummy_seq
        .iter()
        .find(|d| d.id == dummy_id as u32)
        .or_else(|| helper.dummy_seq.first())
        .ok_or_else(|| anyhow::anyhow!("Model has no dummy points"))?;

    let dummy_matrix = dummy.mat.0;
    let dummy_inverse = dummy_matrix
        .invert()
        .ok_or_else(|| anyhow::anyhow!("Dummy matrix is not invertible"))?;

    println!("\nWeapon model: {}", model_path.display());
    println!("Using dummy {} (requested dummy {})", dummy.id, dummy_id);
    println!("Dummy matrix columns:");
    println!("  X axis = {}", format_vec3(dummy_matrix.x.truncate()));
    println!("  Y axis = {}", format_vec3(dummy_matrix.y.truncate()));
    println!("  Z axis = {}", format_vec3(dummy_matrix.z.truncate()));
    println!("  origin = {}", format_vec3(dummy_matrix.w.truncate()));

    let gltf_json = build_gltf_from_lgo(&model_path, &project_dir)?;
    let gltf_value: serde_json::Value = serde_json::from_str(&gltf_json)?;
    let viewer_dummy_matrix = gltf_value["nodes"]
        .as_array()
        .and_then(|nodes| {
            nodes.iter().find_map(|node| {
                let extras = node.get("extras")?;
                if extras.get("type")?.as_str()? != "dummy" {
                    return None;
                }
                if extras.get("id")?.as_u64()? != dummy.id as u64 {
                    return None;
                }
                let matrix = node.get("matrix")?.as_array()?;
                values_to_matrix16(matrix)
            })
        })
        .ok_or_else(|| anyhow::anyhow!("Could not find dummy {} in exported glTF", dummy.id))?;
    let raw_dummy_matrix = dummy.mat.to_slice();
    let max_matrix_delta = raw_dummy_matrix
        .iter()
        .zip(viewer_dummy_matrix.iter())
        .map(|(a, b)| (a - b).abs())
        .fold(0.0f32, f32::max);
    println!(
        "Viewer glTF dummy matrix max delta from raw helper matrix = {:.6}",
        max_matrix_delta
    );

    let vertices_in_dummy: Vec<Point3<f32>> = mesh
        .vertex_seq
        .iter()
        .map(|v| dummy_inverse.transform_point(Point3::new(v.0.x, v.0.y, v.0.z)))
        .collect();

    let bounds = |f: fn(&Point3<f32>) -> f32| -> (f32, f32) {
        let min = vertices_in_dummy.iter().map(f).fold(f32::MAX, f32::min);
        let max = vertices_in_dummy.iter().map(f).fold(f32::MIN, f32::max);
        (min, max)
    };
    let (min_x, max_x) = bounds(|p| p.x);
    let (min_y, max_y) = bounds(|p| p.y);
    let (min_z, max_z) = bounds(|p| p.z);
    println!("\nWeapon mesh in dummy-local coordinates:");
    println!("  X extent = [{min_x:.4}, {max_x:.4}]");
    println!("  Y extent = [{min_y:.4}, {max_y:.4}]");
    println!("  Z extent = [{min_z:.4}, {max_z:.4}]");

    let (axis_label, axis_vec, forward_span, backward_min) = dominant_weapon_axis(&vertices_in_dummy);
    println!(
        "  Dominant forward axis from dummy = {}  forward_span={:.4}  backward_min={:.4}",
        axis_label, forward_span, backward_min
    );
    println!("  Axis vector = {}", format_vec3(axis_vec));

    let eff_bytes = std::fs::read(&eff_path)?;
    let eff = EffFile::from_bytes(&eff_bytes)?;
    println!("\nLoaded effect: {}  sub_effects={}", eff_path.display(), eff.sub_effects.len());

    let interesting = [
        ("smallest ring", 0usize),
        ("largest ring", 4usize),
        ("hilt core", 5usize),
        ("rect trail", 7usize),
    ];

    println!("\nRaw effect keyframes:");
    for (label, idx) in interesting {
        if let Some(sub) = eff.sub_effects.get(idx) {
            let pos = sub.frame_positions.first().copied().unwrap_or([0.0, 0.0, 0.0]);
            let ang = sub.frame_angles.first().copied().unwrap_or([0.0, 0.0, 0.0]);
            let size = sub.frame_sizes.first().copied().unwrap_or([1.0, 1.0, 1.0]);
            println!(
                "  sub[{idx}] {label}: model={} pos={} angle={} size={}",
                sub.model_name,
                format_vec3(vec(pos)),
                format_vec3(vec(ang)),
                format_vec3(vec(size))
            );
        }
    }

    let sample_positions = [
        ("smallest ring", eff.sub_effects.get(0).and_then(|s| s.frame_positions.first()).copied().unwrap_or([0.0, 0.0, 0.0])),
        ("largest ring", eff.sub_effects.get(4).and_then(|s| s.frame_positions.first()).copied().unwrap_or([0.0, 0.0, 0.0])),
        ("hilt core", eff.sub_effects.get(5).and_then(|s| s.frame_positions.first()).copied().unwrap_or([0.0, 0.0, 0.0])),
    ];

    println!("\nAttachment comparison in dummy-local weapon space:");
    println!("  Current viewer path   : dummy * effectPos");
    println!("  Proposed swapped path : dummy * swapYZ(effectPos)");
    for (label, pos) in sample_positions {
        let raw = vec(pos) * effect_scale;
        let swapped = yz_swap(raw);
        println!(
            "  {label:14} raw={}  swapped={}",
            format_vec3(raw),
            format_vec3(swapped)
        );
    }

    let smallest_raw = vec(sample_positions[0].1) * effect_scale;
    let largest_raw = vec(sample_positions[1].1) * effect_scale;
    let hilt_raw = vec(sample_positions[2].1) * effect_scale;
    let smallest_swapped = yz_swap(smallest_raw);
    let largest_swapped = yz_swap(largest_raw);
    let hilt_swapped = yz_swap(hilt_raw);

    let dist = |a: Vector3<f32>, b: Vector3<f32>| (a - b).magnitude();
    println!("\nRing ordering check:");
    println!(
        "  Current  dist(largest,hilt)={:.4}  dist(smallest,hilt)={:.4}",
        dist(largest_raw, hilt_raw),
        dist(smallest_raw, hilt_raw)
    );
    println!(
        "  Swapped  dist(largest,hilt)={:.4}  dist(smallest,hilt)={:.4}",
        dist(largest_swapped, hilt_swapped),
        dist(smallest_swapped, hilt_swapped)
    );

    let tip_raw = vertices_in_dummy
        .iter()
        .max_by(|a, b| a.to_vec().dot(axis_vec).partial_cmp(&b.to_vec().dot(axis_vec)).unwrap())
        .copied()
        .unwrap_or_else(|| point([0.0, 0.0, 0.0]));
    let tip_proj = tip_raw.to_vec().dot(axis_vec);
    let hilt_proj_current = hilt_raw.dot(axis_vec);
    let ring_proj_current = smallest_raw.dot(axis_vec);
    let hilt_proj_swapped = hilt_swapped.dot(axis_vec);
    let ring_proj_swapped = smallest_swapped.dot(axis_vec);

    println!("\nBlade-axis projection against actual weapon mesh:");
    println!("  Weapon tip projection on {} = {:.4}", axis_label, tip_proj);
    println!(
        "  Current  hilt={:.4}  smallest-ring={:.4}  delta={:.4}",
        hilt_proj_current,
        ring_proj_current,
        ring_proj_current - hilt_proj_current
    );
    println!(
        "  Swapped  hilt={:.4}  smallest-ring={:.4}  delta={:.4}",
        hilt_proj_swapped,
        ring_proj_swapped,
        ring_proj_swapped - hilt_proj_swapped
    );

    let sub7 = eff
        .sub_effects
        .get(7)
        .ok_or_else(|| anyhow::anyhow!("Effect has no sub[7] for rect trail probe"))?;
    let sub7_pos = vec(sub7.frame_positions.first().copied().unwrap_or([0.0, 0.0, 0.0])) * effect_scale;
    let rect_local_vertices = [
        point([-0.5, 0.0, 0.0]),
        point([-0.5, 0.0, 1.0]),
        point([0.5, 0.0, 1.0]),
        point([0.5, 0.0, 0.0]),
    ];
    let size = sub7.frame_sizes.first().copied().unwrap_or([1.0, 1.0, 1.0]);
    let scale = Matrix4::from_nonuniform_scale(size[0] * effect_scale, size[1] * effect_scale, size[2] * effect_scale);
    let angle = sub7.frame_angles.first().copied().unwrap_or([0.0, 0.0, 0.0]);
    let rot_x = Matrix4::from_angle_x(cgmath::Rad(angle[0]));
    let rot_y = Matrix4::from_angle_y(cgmath::Rad(angle[1]));
    let rot_z = Matrix4::from_angle_z(cgmath::Rad(angle[2]));
    let local = Matrix4::from_translation(sub7_pos) * rot_y * rot_x * rot_z * scale;
    let swap = Matrix4::new(
        1.0, 0.0, 0.0, 0.0,
        0.0, 0.0, 1.0, 0.0,
        0.0, 1.0, 0.0, 0.0,
        0.0, 0.0, 0.0, 1.0,
    );
    println!("\nSub[7] rect trail vertices in dummy-local space:");
    for (idx, v) in rect_local_vertices.iter().enumerate() {
        let cur = local.transform_point(*v);
        let swp = (swap * local).transform_point(*v);
        println!(
            "  v{idx}: current={}  swapped={}",
            format_point3(cur),
            format_point3(swp)
        );
    }

    Ok(())
}
