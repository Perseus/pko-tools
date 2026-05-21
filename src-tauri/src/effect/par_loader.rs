//! Hand-written .par binary parser following the pko_par.ksy specification.
//!
//! Reads .par files produced by CMPPartCtrl::SaveToFile in the PKO client engine.
//! Supports versions 2–15.

use anyhow::{ensure, Result};

use super::model::{ParChaModel, ParEffPath, ParFile, ParStrip, ParSystem};

const FIXED_STR_LEN: usize = 32;

/// Parse a .par binary buffer into a `ParFile`.
pub fn load_par(data: &[u8]) -> Result<ParFile> {
    let mut r = Reader::new(data);

    let version = r.u32()?;
    ensure!(
        (2..=15).contains(&version),
        "Unsupported .par version: {version}"
    );

    let name = r.fixed_string()?;
    let part_num = r.i32()?;

    let length = if version >= 3 { r.f32()? } else { 0.0 };

    let mut systems = Vec::with_capacity(part_num.max(0) as usize);
    for _ in 0..part_num {
        systems.push(read_par_system(&mut r, version)?);
    }

    let mut strips = Vec::new();
    if version >= 7 {
        let strip_num = r.i32()?;
        strips.reserve(strip_num.max(0) as usize);
        for _ in 0..strip_num {
            strips.push(read_strip(&mut r)?);
        }
    }

    let mut models = Vec::new();
    if version >= 8 {
        let model_num = r.i32()?;
        models.reserve(model_num.max(0) as usize);
        for _ in 0..model_num {
            models.push(read_cha_model(&mut r)?);
        }
    }

    Ok(ParFile {
        version,
        name,
        length,
        systems,
        strips,
        models,
    })
}

fn read_par_system(r: &mut Reader, version: u32) -> Result<ParSystem> {
    let r#type = r.i32()?;
    let name = r.fixed_string()?;
    let particle_count = r.i32()?;
    let texture_name = r.fixed_string()?;
    let model_name = r.fixed_string()?;
    let range = r.vec3()?;

    let frame_count = r.u16()?;

    let mut frame_sizes = Vec::with_capacity(frame_count as usize);
    for _ in 0..frame_count {
        frame_sizes.push(r.f32()?);
    }

    let mut frame_angles = Vec::with_capacity(frame_count as usize);
    for _ in 0..frame_count {
        frame_angles.push(r.vec3()?);
    }

    let mut frame_colors = Vec::with_capacity(frame_count as usize);
    for _ in 0..frame_count {
        frame_colors.push(r.color4f()?);
    }

    let billboard = r.u8()? != 0;
    let src_blend = r.i32()?;
    let dest_blend = r.i32()?;
    let min_filter = r.i32()?;
    let mag_filter = r.i32()?;
    let life = r.f32()?;
    let velocity = r.f32()?;
    let direction = r.vec3()?;
    let acceleration = r.vec3()?;
    let step = r.f32()?;

    // v4+
    let (model_range_flag, model_range_name) = if version > 3 {
        (r.u8()? != 0, r.fixed_string()?)
    } else {
        (false, String::new())
    };

    // v5+
    let offset = if version > 4 { r.vec3()? } else { [0.0; 3] };

    // v6+
    let (delay_time, play_time) = if version > 5 {
        (r.f32()?, r.f32()?)
    } else {
        (0.0, 0.0)
    };

    // v9+
    let (use_path, path) = if version > 8 {
        let flag = r.u8()? != 0;
        let path = if flag { Some(read_eff_path(r)?) } else { None };
        (flag, path)
    } else {
        (false, None)
    };

    // v10+
    let shade = if version > 9 { r.u8()? != 0 } else { false };

    // v11+
    let hit_effect = if version > 10 {
        r.fixed_string()?
    } else {
        String::new()
    };

    // v12+ (only when model_range_flag)
    let point_ranges = if version > 11 && model_range_flag {
        let count = r.u16()?;
        let mut ranges = Vec::with_capacity(count as usize);
        for _ in 0..count {
            ranges.push(r.vec3()?);
        }
        ranges
    } else {
        Vec::new()
    };

    // v13+
    let random_mode = if version > 12 { r.i32()? } else { 0 };

    // v14+
    let model_dir = if version > 13 { r.u8()? != 0 } else { false };

    // v15+
    let media_y = if version > 14 { r.u8()? != 0 } else { false };

    Ok(ParSystem {
        r#type,
        name,
        particle_count,
        texture_name,
        model_name,
        range,
        frame_count,
        frame_sizes,
        frame_angles,
        frame_colors,
        billboard,
        src_blend,
        dest_blend,
        min_filter,
        mag_filter,
        life,
        velocity,
        direction,
        acceleration,
        step,
        model_range_flag,
        model_range_name,
        offset,
        delay_time,
        play_time,
        use_path,
        path,
        shade,
        hit_effect,
        point_ranges,
        random_mode,
        model_dir,
        media_y,
    })
}

fn read_eff_path(r: &mut Reader) -> Result<ParEffPath> {
    let frame_count = r.i32()?;
    let velocity = r.f32()?;

    let mut points = Vec::with_capacity(frame_count.max(0) as usize);
    for _ in 0..frame_count {
        points.push(r.vec3()?);
    }

    let segment_count = if frame_count > 0 {
        (frame_count - 1) as usize
    } else {
        0
    };

    let mut directions = Vec::with_capacity(segment_count);
    let mut distances = Vec::with_capacity(segment_count);
    for _ in 0..segment_count {
        directions.push(r.vec3()?);
        // CEffPath::SavePath writes each segment as dir vec3 followed by
        // sizeof(D3DXVECTOR3) bytes from &m_vecDist[n]. The first float is
        // the segment distance; the next two are overlapping distance slots.
        let value = r.f32()?;
        let _pad0 = r.f32()?;
        let _pad1 = r.f32()?;
        distances.push(value);
    }

    Ok(ParEffPath {
        velocity,
        points,
        directions,
        distances,
    })
}

fn read_strip(r: &mut Reader) -> Result<ParStrip> {
    let max_len = r.i32()?;
    let dummy = [r.i32()?, r.i32()?];
    let color = r.color4f()?;
    let life = r.f32()?;
    let step = r.f32()?;
    let texture_name = normalize_cmpstrip_texture_name(r.fixed_string()?);
    let src_blend = r.i32()?;
    let dest_blend = r.i32()?;

    Ok(ParStrip {
        max_len,
        dummy,
        color,
        life,
        step,
        texture_name,
        src_blend,
        dest_blend,
    })
}

fn normalize_cmpstrip_texture_name(mut name: String) -> String {
    if name.contains(".dds") || name.contains(".tga") {
        name.truncate(name.len().saturating_sub(4));
    }
    name
}

fn read_cha_model(r: &mut Reader) -> Result<ParChaModel> {
    Ok(ParChaModel {
        id: r.i32()?,
        velocity: r.f32()?,
        play_type: r.i32()?,
        cur_pose: r.i32()?,
        src_blend: r.i32()?,
        dest_blend: r.i32()?,
        color: r.color4f()?,
    })
}

// ── Minimal binary reader using from_le_bytes ────────────────────────────────

struct Reader<'a> {
    data: &'a [u8],
    pos: usize,
}

impl<'a> Reader<'a> {
    fn new(data: &'a [u8]) -> Self {
        Self { data, pos: 0 }
    }

    fn read_bytes(&mut self, n: usize) -> Result<&'a [u8]> {
        ensure!(
            self.pos + n <= self.data.len(),
            "Unexpected EOF at offset {}, need {} more bytes",
            self.pos,
            n
        );
        let slice = &self.data[self.pos..self.pos + n];
        self.pos += n;
        Ok(slice)
    }

    fn u8(&mut self) -> Result<u8> {
        Ok(self.read_bytes(1)?[0])
    }

    fn u16(&mut self) -> Result<u16> {
        Ok(u16::from_le_bytes(self.read_bytes(2)?.try_into()?))
    }

    fn u32(&mut self) -> Result<u32> {
        Ok(u32::from_le_bytes(self.read_bytes(4)?.try_into()?))
    }

    fn i32(&mut self) -> Result<i32> {
        Ok(i32::from_le_bytes(self.read_bytes(4)?.try_into()?))
    }

    fn f32(&mut self) -> Result<f32> {
        Ok(f32::from_le_bytes(self.read_bytes(4)?.try_into()?))
    }

    fn vec3(&mut self) -> Result<[f32; 3]> {
        Ok([self.f32()?, self.f32()?, self.f32()?])
    }

    fn color4f(&mut self) -> Result<[f32; 4]> {
        Ok([self.f32()?, self.f32()?, self.f32()?, self.f32()?])
    }

    fn fixed_string(&mut self) -> Result<String> {
        let buf = self.read_bytes(FIXED_STR_LEN)?;
        let end = buf.iter().position(|b| *b == 0).unwrap_or(FIXED_STR_LEN);
        Ok(String::from_utf8_lossy(&buf[..end]).to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Default)]
    struct ParRegressionStats {
        files: usize,
        systems: usize,
        strips: usize,
        models: usize,
    }

    #[test]
    fn reads_eff_path_segments_interleaved_like_cpp_ceffpath() {
        let mut bytes = Vec::new();
        push_test_i32(&mut bytes, 3);
        push_test_f32(&mut bytes, 2.5);
        push_test_vec3(&mut bytes, [0.0, 0.0, 0.0]);
        push_test_vec3(&mut bytes, [10.0, 0.0, 0.0]);
        push_test_vec3(&mut bytes, [10.0, 20.0, 0.0]);

        push_test_vec3(&mut bytes, [1.0, 0.0, 0.0]);
        push_test_vec3(&mut bytes, [10.0, 20.0, 999.0]);
        push_test_vec3(&mut bytes, [0.0, 1.0, 0.0]);
        push_test_vec3(&mut bytes, [20.0, 0.0, 0.0]);

        let mut reader = Reader::new(&bytes);
        let path = read_eff_path(&mut reader).expect("parse path");

        assert_eq!(path.velocity, 2.5);
        assert_eq!(path.directions, vec![[1.0, 0.0, 0.0], [0.0, 1.0, 0.0]]);
        assert_eq!(path.distances, vec![10.0, 20.0]);
    }

    #[test]
    fn strip_texture_name_matches_cmpstrip_extension_stripping() {
        let mut data = Vec::new();
        data.extend_from_slice(&7u32.to_le_bytes());
        write_test_fixed_string(&mut data, "strip-par");
        data.extend_from_slice(&0i32.to_le_bytes());
        data.extend_from_slice(&0f32.to_le_bytes());
        data.extend_from_slice(&1i32.to_le_bytes());
        data.extend_from_slice(&256i32.to_le_bytes());
        data.extend_from_slice(&0i32.to_le_bytes());
        data.extend_from_slice(&1i32.to_le_bytes());
        for value in [1.0f32, 1.0, 1.0, 1.0] {
            data.extend_from_slice(&value.to_le_bytes());
        }
        data.extend_from_slice(&1.0f32.to_le_bytes());
        data.extend_from_slice(&0.05f32.to_le_bytes());
        write_test_fixed_string(&mut data, "trail.tga");
        data.extend_from_slice(&5i32.to_le_bytes());
        data.extend_from_slice(&2i32.to_le_bytes());

        let parsed = load_par(&data).unwrap();
        let reparsed = load_par(&parsed.to_bytes().unwrap()).unwrap();

        assert_eq!(parsed.strips[0].texture_name, "trail");
        assert_eq!(reparsed.strips[0].texture_name, "trail");
    }

    /// Regression test: parse every .par file and roundtrip through to_bytes.
    #[test]
    fn load_all_par_files() {
        let par_dir = std::path::Path::new("../top-client/effect");
        if !par_dir.exists() {
            eprintln!("Skipping PAR regression test: ../top-client/effect not found");
            return;
        }

        let mut par_files: Vec<_> = std::fs::read_dir(par_dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| {
                e.path()
                    .extension()
                    .map_or(false, |ext| ext.eq_ignore_ascii_case("par"))
            })
            .map(|e| e.path())
            .collect();
        par_files.sort();

        assert!(
            !par_files.is_empty(),
            "No .par files found in {}",
            par_dir.display()
        );

        let stats = assert_par_files_roundtrip(&par_files);

        eprintln!(
            "PAR regression: {} files, {} systems, {} strips, {} models — all parsed and roundtripped OK",
            stats.files,
            stats.systems,
            stats.strips,
            stats.models,
        );
    }

    /// Optional real-client regression: set PKO_PAR_FIXTURE_DIR to an effect/effects directory.
    #[test]
    fn load_all_par_files_from_env_fixture_dir() {
        let Ok(par_dir) = std::env::var("PKO_PAR_FIXTURE_DIR") else {
            eprintln!("Skipping PAR env regression test: PKO_PAR_FIXTURE_DIR not set");
            return;
        };
        let par_dir = std::path::Path::new(&par_dir);
        assert!(
            par_dir.exists(),
            "PKO_PAR_FIXTURE_DIR does not exist: {}",
            par_dir.display(),
        );

        let par_files = collect_par_files(par_dir);
        assert!(
            !par_files.is_empty(),
            "No .par files found in {}",
            par_dir.display()
        );

        let stats = assert_par_files_roundtrip(&par_files);
        assert!(
            stats.strips > 0 || stats.models > 0,
            "{}: expected at least one strip or character-model PAR record in real asset fixture set",
            par_dir.display(),
        );

        eprintln!(
            "PAR env regression: {} files, {} systems, {} strips, {} models — all parsed and roundtripped OK",
            stats.files,
            stats.systems,
            stats.strips,
            stats.models,
        );
    }

    /// Optional real-client corpus gate: every serialized CMPPartSys type id in
    /// the fixture directory must be one of the C++ source-defined ids 1..=18.
    ///
    /// This is intentionally environment-gated because the full client asset
    /// corpus is not checked into the repo. It complements the frontend dispatch
    /// test that verifies every source-defined id routes to a renderer.
    #[test]
    fn particle_type_ids_from_env_fixture_dir_are_source_defined() {
        let Ok(par_dir) = std::env::var("PKO_PAR_FIXTURE_DIR") else {
            eprintln!("Skipping PAR particle type inventory: PKO_PAR_FIXTURE_DIR not set");
            return;
        };
        let par_dir = std::path::Path::new(&par_dir);
        assert!(
            par_dir.exists(),
            "PKO_PAR_FIXTURE_DIR does not exist: {}",
            par_dir.display(),
        );

        let par_files = collect_par_files(par_dir);
        assert!(
            !par_files.is_empty(),
            "No .par files found in {}",
            par_dir.display()
        );

        let mut counts = std::collections::BTreeMap::<i32, usize>::new();
        let mut representatives = std::collections::BTreeMap::<i32, String>::new();

        for path in &par_files {
            let data = std::fs::read(path).unwrap();
            let parsed = load_par(&data).unwrap_or_else(|e| panic!("{}: {}", path.display(), e));

            for system in parsed.systems {
                assert!(
                    (1..=18).contains(&system.r#type),
                    "{}: unsupported CMPPartSys type id {}",
                    path.display(),
                    system.r#type,
                );
                *counts.entry(system.r#type).or_insert(0) += 1;
                representatives.entry(system.r#type).or_insert_with(|| {
                    format!(
                        "{} / {}",
                        path.file_name()
                            .and_then(|name| name.to_str())
                            .unwrap_or("<unknown>"),
                        system.name,
                    )
                });
            }
        }

        eprintln!(
            "PAR particle type inventory: {} files, {} represented type ids",
            par_files.len(),
            counts.len(),
        );
        for (type_id, count) in counts {
            eprintln!(
                "  type {:>2}: {:>4} systems, first {}",
                type_id,
                count,
                representatives.get(&type_id).unwrap(),
            );
        }
    }

    fn collect_par_files(par_dir: &std::path::Path) -> Vec<std::path::PathBuf> {
        let mut par_files: Vec<_> = std::fs::read_dir(par_dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| {
                e.path()
                    .extension()
                    .map_or(false, |ext| ext.eq_ignore_ascii_case("par"))
            })
            .map(|e| e.path())
            .collect();
        par_files.sort();
        par_files
    }

    fn write_test_fixed_string(buffer: &mut Vec<u8>, value: &str) {
        let mut fixed = [0u8; FIXED_STR_LEN];
        let bytes = value.as_bytes();
        let len = bytes.len().min(FIXED_STR_LEN.saturating_sub(1));
        fixed[..len].copy_from_slice(&bytes[..len]);
        buffer.extend_from_slice(&fixed);
    }

    fn push_test_i32(buffer: &mut Vec<u8>, value: i32) {
        buffer.extend_from_slice(&value.to_le_bytes());
    }

    fn push_test_f32(buffer: &mut Vec<u8>, value: f32) {
        buffer.extend_from_slice(&value.to_le_bytes());
    }

    fn push_test_vec3(buffer: &mut Vec<u8>, value: [f32; 3]) {
        for component in value {
            push_test_f32(buffer, component);
        }
    }

    fn assert_par_files_roundtrip(par_files: &[std::path::PathBuf]) -> ParRegressionStats {
        let mut stats = ParRegressionStats::default();
        stats.files = par_files.len();

        for path in par_files {
            let data = std::fs::read(path).unwrap();
            let parsed = load_par(&data).unwrap_or_else(|e| panic!("{}: {}", path.display(), e));

            assert!(
                (2..=15).contains(&parsed.version),
                "{}: version {}",
                path.display(),
                parsed.version
            );

            let bytes = parsed.to_bytes().unwrap();
            let reparsed = load_par(&bytes)
                .unwrap_or_else(|e| panic!("{}: roundtrip parse failed: {}", path.display(), e));
            let rebytes = reparsed.to_bytes().unwrap();
            assert_eq!(
                bytes,
                rebytes,
                "{}: roundtrip bytes mismatch",
                path.display()
            );

            stats.systems += parsed.systems.len();
            stats.strips += parsed.strips.len();
            stats.models += parsed.models.len();
        }

        stats
    }
}
